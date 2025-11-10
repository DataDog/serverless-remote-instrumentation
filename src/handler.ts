const cfnResponse =
  typeof require !== "undefined" ? require("cfn-response") : ({} as any);

import {
  deleteConfigHash,
  getConfigsWithRetry,
  updateConfigHash,
} from "./config";
import { logger } from "./logger";
import {
  isLambdaManagementEvent,
  isStackDeletedEvent,
  isStackCreatedEvent,
  isScheduledInvocationEvent,
  getFunctionFromLambdaEvent,
  selectEventFieldsForLogging,
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
} from "./aws-resources";
import { instrumentFunctions } from "./instrument";
import {
  LAMBDA_EVENT,
  SCHEDULED_INVOCATION_EVENT,
  CLOUDFORMATION_CREATE_EVENT,
  CLOUDFORMATION_DELETE_EVENT,
  FUNCTION_NOT_FOUND,
  INSTRUMENT,
  SKIPPED,
} from "./consts";

interface InstrumentOutcome {
  instrument: {
    succeeded: Record<string, any>;
    failed: Record<string, any>;
    skipped: Record<string, any>;
  };
  uninstrument: {
    succeeded: Record<string, any>;
    failed: Record<string, any>;
    skipped: Record<string, any>;
  };
}

const lambdaClient = getLambdaClient();
const taggingClient = getTaggingClient();
const s3Client = getS3Client();

export const handler = async (
  event: any,
  context: any,
): Promise<InstrumentOutcome> => {
  logger.logObject(selectEventFieldsForLogging(event));
  const instrumentOutcome: InstrumentOutcome = {
    instrument: { succeeded: {}, failed: {}, skipped: {} },
    uninstrument: { succeeded: {}, failed: {}, skipped: {} },
  };

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
      );
    } catch (e) {
      logger.error(e as any);
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

    let configs: any;
    try {
      const configResult = await getConfigsWithRetry(s3Client, context);
      configs = configResult.configs;
    } catch (error: any) {
      // This pulls the reason from the error, just stringifying it does not return the message
      const errorDetails = JSON.parse(
        JSON.stringify(error, Object.getOwnPropertyNames(error)),
      );
      await putError(s3Client, functionFromEvent.FunctionName, errorDetails);
      throw error;
    }

    await instrumentFunctions(
      s3Client,
      configs,
      functionsToCheck,
      instrumentOutcome,
      taggingClient,
      LAMBDA_EVENT,
    );
  }

  // Else if it's a scheduled event, check if the config has changed and instrument all functions
  else if (isScheduledInvocationEvent(event)) {
    logger.log("Received an invocation from the scheduler.");
    const errors = await listErrors(s3Client);
    const { configs, configChanged } = await getConfigsWithRetry(
      s3Client,
      context,
    );

    let functionsToCheck: any[] = [];
    if (configChanged) {
      await deleteConfigHash(s3Client);
      // If the config has changed, check all functions for instrumentation
      // Get all functions in the customer's account
      const allFunctions = await getAllFunctions(lambdaClient);
      const deletedErrorFunctions = errors.filter(
        (functionName: string) =>
          !allFunctions.some(
            (element: any) => element.FunctionName === functionName,
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

      functionsToCheck = await enrichFunctionsWithTags(
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
              };
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
            }
          }),
        )
      ).filter((item) => item);

      const enrichedFunctions = await enrichFunctionsWithTags(
        lambdaClient,
        functionsToCheck,
      );
      // @ts-expect-error Need to fix later
      await instrumentFunctions(
        s3Client,
        configs,
        enrichedFunctions,
        instrumentOutcome,
        taggingClient,
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
        newErrors.map(async ({ functionName, reason }: any) =>
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
