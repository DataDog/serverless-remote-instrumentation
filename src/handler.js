const cfnResponse = require("cfn-response"); // file will be auto-injected by CloudFormation
const { getConfigs, configHasChanged, updateConfigHash } = require("./config");
const { logger } = require("./logger");
const {
  isLambdaManagementEvent,
  isStackDeletedEvent,
  isStackCreatedEvent,
  isScheduledInvocationEvent,
  getFunctionFromLambdaEvent,
  selectEventFieldsForLogging,
} = require("./lambda-event");
const {
  deleteError,
  identifyNewErrorsAndResolvedErrors,
  putError,
  listErrors,
  emptyBucket,
} = require("./error-storage");
const { ResourceNotFoundException } = require("@aws-sdk/client-lambda");
const {
  ResourceGroupsTaggingAPIClient,
} = require("@aws-sdk/client-resource-groups-tagging-api");
const { S3Client } = require("@aws-sdk/client-s3");
const {
  getLambdaFunction,
  getAllFunctions,
  enrichFunctionsWithTags,
  getFunctionCount,
} = require("./functions");
const { getLambdaClient } = require("./aws-resources");
const { instrumentFunctions } = require("./instrument");
const {
  LAMBDA_EVENT,
  SCHEDULED_INVOCATION_EVENT,
  CLOUDFORMATION_CREATE_EVENT,
  CLOUDFORMATION_DELETE_EVENT,
  FUNCTION_NOT_FOUND,
  INSTRUMENT,
  SKIPPED,
} = require("./consts");

const awsRegion = process.env.AWS_REGION;
const lambdaClient = getLambdaClient();
const taggingClient = new ResourceGroupsTaggingAPIClient({
  region: awsRegion,
});
const s3Client = new S3Client({ region: awsRegion });

exports.handler = async (event, context) => {
  logger.logObject(selectEventFieldsForLogging(event));
  const instrumentOutcome = {
    instrument: { succeeded: {}, failed: {}, skipped: {} },
    uninstrument: { succeeded: {}, failed: {}, skipped: {} },
  };

  // If it's a stack event, send a response to CloudFormation for custom resource management
  if (isStackCreatedEvent(event)) {
    try {
      const configs = await getConfigs(s3Client, context);
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
      logger.error(e);
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
      return;
    }

    const functionsToCheck = await enrichFunctionsWithTags(lambdaClient, [
      functionFromEvent,
    ]);

    let configs;
    try {
      configs = await getConfigs(s3Client, context);
    } catch (error) {
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
    const configs = await getConfigs(s3Client, context);
    const configChanged = await configHasChanged(s3Client, configs);
    let functionsToCheck = [];
    if (configChanged) {
      // If the config has changed, check all functions for instrumentation
      // Get all functions in the customer's account
      const allFunctions = await getAllFunctions(lambdaClient);
      const deletedErrorFunctions = errors.filter(
        (functionName) =>
          !allFunctions.some(
            (element) => element.FunctionName === functionName,
          ),
      );

      deletedErrorFunctions.forEach((functionName) => {
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
          errors.map(async (lambdaFunctionName) => {
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
        newErrors.map(async ({ functionName, reason }) =>
          putError(s3Client, functionName, reason),
        ),
        resolvedErrors.map(async (functionName) =>
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
