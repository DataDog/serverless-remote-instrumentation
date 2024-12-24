const cfnResponse = require("cfn-response"); // file will be auto-injected by CloudFormation
const { getConfigs, configHasChanged, updateConfigHash } = require("./config");
const { logger } = require("./logger");
const {
  isLambdaManagementEvent,
  isStackDeletedEvent,
  isStackCreatedEvent,
  isScheduledInvocationEvent,
  getFunctionFromLambdaEvent,
} = require("./lambda-event");
const { LambdaClient } = require("@aws-sdk/client-lambda");
const {
  ResourceGroupsTaggingAPIClient,
} = require("@aws-sdk/client-resource-groups-tagging-api");
const { S3Client } = require("@aws-sdk/client-s3");
const { getAllFunctions, enrichFunctionsWithTags } = require("./functions");
const { instrumentFunctions } = require("./instrument");
const {
  LAMBDA_EVENT,
  REMOTE_INSTRUMENTATION_STARTED,
  REMOTE_INSTRUMENTATION_ENDED,
  SCHEDULED_INVOCATION_EVENT,
} = require("./consts");

const awsRegion = process.env.AWS_REGION;
const lambdaClient = new LambdaClient({
  region: awsRegion,
});
const taggingClient = new ResourceGroupsTaggingAPIClient({
  region: awsRegion,
});
const s3Client = new S3Client({ region: awsRegion });

exports.handler = async (event, context) => {
  logger.logObject(event);
  const instrumentOutcome = {
    instrument: { succeeded: {}, failed: {}, skipped: {} },
    uninstrument: { succeeded: {}, failed: {}, skipped: {} },
  };

  // If it's a stack event, send a response to CloudFormation for custom resource management
  if (isStackDeletedEvent(event) || isStackCreatedEvent(event)) {
    logger.log(`Received a CloudFormation '${event.RequestType}' event.`);
    await cfnResponse.send(event, context, "SUCCESS");
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

    // TODO: [Followup] Handle error retrieving config by writing the function name to s3 and reinstrumenting on scheduled invocation
    const configs = await getConfigs(context);
    logger.emitFrontEndEvent(
      REMOTE_INSTRUMENTATION_STARTED,
      LAMBDA_EVENT,
      null,
      configs,
    );

    await instrumentFunctions(
      configs,
      functionsToCheck,
      instrumentOutcome,
      taggingClient,
    );

    logger.emitFrontEndEvent(
      REMOTE_INSTRUMENTATION_ENDED,
      LAMBDA_EVENT,
      instrumentOutcome,
      configs,
    );
  }

  // Else if it's a scheduled event, check if the config has changed and instrument all functions
  else if (isScheduledInvocationEvent(event)) {
    logger.log("Received an invocation from the scheduler.");
    const configs = await getConfigs(context);
    const configChanged = await configHasChanged(s3Client, configs);
    let functionsToCheck = [];
    if (configChanged) {
      // If the config has changed, check all functions for instrumentation
      // Get all functions in the customer's account
      const allFunctions = await getAllFunctions(lambdaClient);
      functionsToCheck = await enrichFunctionsWithTags(
        lambdaClient,
        allFunctions,
      );

      logger.emitFrontEndEvent(
        REMOTE_INSTRUMENTATION_STARTED,
        SCHEDULED_INVOCATION_EVENT,
        null,
        configs,
      );
      await instrumentFunctions(
        configs,
        functionsToCheck,
        instrumentOutcome,
        taggingClient,
      );

      logger.emitFrontEndEvent(
        REMOTE_INSTRUMENTATION_ENDED,
        SCHEDULED_INVOCATION_EVENT,
        instrumentOutcome,
        configs,
      );

      await updateConfigHash(s3Client, configs);
      // TODO: [Followup] Check if any functions failed to instrument or uninstrument and add them to a retry list in s3
    } else {
      logger.log("Configuration has not changed. Skipping instrumentation.");
    }
  }

  // If it's a different event type, log an error
  else {
    console.error("Received unexpected event type");
  }
};
