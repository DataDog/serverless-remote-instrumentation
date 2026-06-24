import { createRequire } from "module";
// eslint-disable-next-line no-underscore-dangle
const _require = createRequire(import.meta.url);
const cfnResponse = _require("cfn-response"); // file will be auto-injected by CloudFormation, so it must use `require`

import {
  deleteConfigHash,
  getConfigsWithRetry,
  updateConfigHash,
  RcConfig,
} from "./config";
import { logger } from "./logger";
import {
  isLambdaManagementEvent,
  isStackDeletedEvent,
  isStackCreatedEvent,
  isScheduledInvocationEvent,
  getFunctionFromLambdaEvent,
  selectEventFieldsForLogging,
  type InstrumenterEvent,
} from "./lambda-event";
import {
  deleteError,
  identifyNewErrorsAndResolvedErrors,
  putError,
  listErrors,
  emptyBucket,
} from "./error-storage";
import { ResourceNotFoundException } from "@aws-sdk/client-lambda";
import {
  getLambdaFunction,
  getAllFunctions,
  enrichFunctionsWithTags,
  getFunctionCount,
} from "./functions";
import {
  getLambdaClient,
  getS3Client,
  getTaggingClient,
  getEdgeLambdaFunctionNames,
} from "./aws-resources";
import { instrumentFunctions } from "./instrument";
import { submitInstrumentationMetrics } from "./metrics";
import {
  LAMBDA_EVENT,
  SCHEDULED_INVOCATION_EVENT,
  CLOUDFORMATION_CREATE_EVENT,
  CLOUDFORMATION_DELETE_EVENT,
  FUNCTION_NOT_FOUND,
  INSTRUMENT,
  SKIPPED,
  DD_INTERNAL_SEND_DEBUG_INFORMATION,
  type LambdaFunction,
  type UnenrichedLambdaFunction,
  type InstrumentOutcome,
} from "./consts";
import type { Context } from "aws-lambda";

const lambdaClient = getLambdaClient();
const taggingClient = getTaggingClient();
const s3Client = getS3Client();

export const handler = async (
  event: InstrumenterEvent,
  context: Context,
): Promise<InstrumentOutcome> => {
  const invocationStartedAt = new Date();
  logger.logObject(selectEventFieldsForLogging(event));
  const instrumentOutcome: InstrumentOutcome = {
    instrument: { succeeded: {}, failed: {}, skipped: {} },
    uninstrument: { succeeded: {}, failed: {}, skipped: {} },
  };

  // In us-east-1, Lambda@Edge functions appear in ListFunctions but cannot be
  // instrumented (no env vars, read-only replicas). Start fetching their names
  // now so the network call overlaps with the event-specific setup below.
  const edgeFunctionNamesPromise: Promise<Set<string> | undefined> =
    process.env.AWS_REGION === "us-east-1"
      ? getEdgeLambdaFunctionNames().catch((error) => {
          logger.warn(
            `Failed to list CloudFront distributions for Lambda@Edge detection: ${error}`,
          );
          return undefined;
        })
      : Promise.resolve(undefined);

  // Alias so call sites read clearly — awaiting the same promise multiple times
  // is safe and returns the cached result immediately after the first resolution.
  const resolveEdgeFunctionNames = () => edgeFunctionNamesPromise;

  // If it's a stack event, send a response to CloudFormation for custom resource management
  if (isStackCreatedEvent(event)) {
    try {
      const configResult = await getConfigsWithRetry(s3Client, context);
      const configs = configResult.configs;
      const allFunctions = await getAllFunctions(lambdaClient);
      const functionsToCheck = await enrichFunctionsWithTags(
        lambdaClient,
        allFunctions,
      );
      await instrumentFunctions(
        s3Client,
        configs,
        functionsToCheck,
        instrumentOutcome,
        taggingClient,
        CLOUDFORMATION_CREATE_EVENT,
        await resolveEdgeFunctionNames(),
      );
    } catch (e) {
      logger.error(e instanceof Error ? e.message : String(e));
    }
    // Any failure should be and we should still send a CFN SUCCESS response since failing stack
    // creation will be painful for a user, and the functions that didn't succeed will be retried
    // on the next scheduled invocation
    await cfnResponse.send(event, context, "SUCCESS");
  } else if (isStackDeletedEvent(event)) {
    const emptyBucketResponsePromise = emptyBucket(s3Client);
    logger.log(`Received a CloudFormation '${event.RequestType}' event.`);
    const allFunctions = await getAllFunctions(lambdaClient);
    const enrichedFunctions = await enrichFunctionsWithTags(
      lambdaClient,
      allFunctions,
    );
    await instrumentFunctions(
      s3Client,
      [],
      enrichedFunctions,
      instrumentOutcome,
      taggingClient,
      CLOUDFORMATION_DELETE_EVENT,
      await resolveEdgeFunctionNames(),
    );
    const failedToUninstrument = Object.keys(
      instrumentOutcome.uninstrument.failed,
    );

    // Wait for the bucket to be empty before sending the CFN response
    await emptyBucketResponsePromise;

    if (failedToUninstrument.length) {
      await cfnResponse.send(event, context, "FAILED", {
        failed: failedToUninstrument,
      });
    } else {
      await cfnResponse.send(event, context, "SUCCESS");
    }
  }

  // Else if it's a Lambda Management event, validate the event and instrument the function
  else if (isLambdaManagementEvent(event)) {
    logger.log(`Received a Lambda Management event.`);
    const functionFromEvent = await getFunctionFromLambdaEvent(
      lambdaClient,
      event,
    );
    if (!functionFromEvent) {
      return instrumentOutcome;
    }

    const functionsToCheck = await enrichFunctionsWithTags(lambdaClient, [
      functionFromEvent,
    ]);

    let configs: RcConfig[];
    try {
      const configResult = await getConfigsWithRetry(s3Client, context);
      configs = configResult.configs;
    } catch (error: unknown) {
      // This pulls the reason from the error, just stringifying it does not return the message
      const errorDetails = JSON.parse(
        JSON.stringify(error, Object.getOwnPropertyNames(error)),
      );
      await putError(s3Client, functionFromEvent.FunctionName!, errorDetails);
      throw error;
    }

    await instrumentFunctions(
      s3Client,
      configs,
      functionsToCheck,
      instrumentOutcome,
      taggingClient,
      LAMBDA_EVENT,
      await resolveEdgeFunctionNames(),
    );

    if (process.env[DD_INTERNAL_SEND_DEBUG_INFORMATION] === "true") {
      const instrumentedAt = new Date();
      const eventTime = event.time ? new Date(event.time) : null;
      const anySucceeded =
        Object.keys(instrumentOutcome.instrument.succeeded).length > 0;
      if (eventTime && anySucceeded) {
        const instrumentationLatencyMs =
          instrumentedAt.getTime() - eventTime.getTime();
        const eventbridgeDelayMs =
          invocationStartedAt.getTime() - eventTime.getTime();
        const lambdaProcessingLatencyMs =
          instrumentedAt.getTime() - invocationStartedAt.getTime();
        await submitInstrumentationMetrics(
          instrumentationLatencyMs,
          eventbridgeDelayMs,
          lambdaProcessingLatencyMs,
          context.invokedFunctionArn,
        );
      }
    }
  }

  // Else if it's a scheduled event, check if the config has changed and instrument all functions
  else if (isScheduledInvocationEvent(event)) {
    logger.log("Received an invocation from the scheduler.");
    const errors = await listErrors(s3Client);
    const { configs, configChanged } = await getConfigsWithRetry(
      s3Client,
      context,
    );

    if (configChanged) {
      await deleteConfigHash(s3Client);
      // If the config has changed, check all functions for instrumentation
      // Get all functions in the customer's account
      const allFunctions = await getAllFunctions(lambdaClient);
      const deletedErrorFunctions = errors.filter(
        (functionName: string) =>
          !allFunctions.some(
            (element) => element.FunctionName === functionName,
          ),
      );

      deletedErrorFunctions.forEach((functionName: string) => {
        const reasonCode = FUNCTION_NOT_FOUND;
        const reason = `The function '${functionName}' does not exist`;
        instrumentOutcome.instrument.skipped[functionName] = {
          reason,
          reasonCode,
        };
        logger.logInstrumentOutcome({
          ddSlsEventName: INSTRUMENT,
          outcome: SKIPPED,
          targetFunctionName: functionName,
          reason,
          reasonCode,
        });
      });

      const functionsToCheck = await enrichFunctionsWithTags(
        lambdaClient,
        allFunctions,
      );

      await instrumentFunctions(
        s3Client,
        configs,
        functionsToCheck,
        instrumentOutcome,
        taggingClient,
        SCHEDULED_INVOCATION_EVENT,
        await resolveEdgeFunctionNames(),
      );

      await updateConfigHash(s3Client, configs);
    } else if (errors.length) {
      logger.log(
        `Found previous errors in ${errors.length} functions.  ${JSON.stringify(errors)}`,
      );
      const functionsToCheck = (
        await Promise.all(
          errors.map(async (lambdaFunctionName: string) => {
            try {
              const lambdaFunction = await getLambdaFunction(
                lambdaClient,
                lambdaFunctionName,
              );
              return {
                ...lambdaFunction.Configuration,
                Tags: lambdaFunction.Tags,
              } as UnenrichedLambdaFunction;
            } catch (e) {
              if (e instanceof ResourceNotFoundException) {
                // Function no longer exists, add it to skipped to get cleaned up
                const reasonCode = FUNCTION_NOT_FOUND;
                const reason = `The function '${lambdaFunctionName}' does not exist`;
                instrumentOutcome.instrument.skipped[lambdaFunctionName] = {
                  reason,
                  reasonCode,
                };
                logger.logInstrumentOutcome({
                  ddSlsEventName: INSTRUMENT,
                  outcome: SKIPPED,
                  targetFunctionName: lambdaFunctionName,
                  reason,
                  reasonCode,
                });
                return undefined;
              }
              throw e;
            }
          }),
        )
      ).filter((item): item is UnenrichedLambdaFunction => item !== undefined);

      const enrichedFunctions = await enrichFunctionsWithTags(
        lambdaClient,
        functionsToCheck,
      );
      await instrumentFunctions(
        s3Client,
        configs,
        enrichedFunctions,
        instrumentOutcome,
        taggingClient,
        undefined,
        await resolveEdgeFunctionNames(),
      );
    } else {
      logger.log("Configuration has not changed. Skipping instrumentation.");
    }

    // Clear the errors that have been handled, including skipped functions that no longer exist
    const { newErrors, resolvedErrors } = identifyNewErrorsAndResolvedErrors(
      instrumentOutcome,
      errors,
    );

    await Promise.all(
      [
        newErrors.map(async ({ functionName, reason }) =>
          putError(s3Client, functionName, reason),
        ),
        resolvedErrors.map(async (functionName: string) =>
          deleteError(s3Client, functionName),
        ),
      ].flat(),
    );

    const functionCount = await getFunctionCount(lambdaClient);
    logger.emitFrontendAccountStateEvent({ functionCount });
  }

  // If it's a different event type, log an error
  else {
    console.error("Received unexpected event type");
  }

  return instrumentOutcome;
};
