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
const { putError, listErrors } = require("./error-storage")
const { LambdaClient } = require("@aws-sdk/client-lambda");
const {
  ResourceGroupsTaggingAPIClient,
} = require("@aws-sdk/client-resource-groups-tagging-api");
const { S3Client } = require("@aws-sdk/client-s3");
const { getLambdaFunction, getAllFunctions, enrichFunctionsWithTags } = require("./functions");
const { instrumentFunctions } = require("./instrument");
const {
  LAMBDA_EVENT,
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
    /**
     * TODO: [Followup] Do one of two things:
     * 1. On Stack Created, check all functions for instrumentation like we do for the scheduled event
     * 2. Remove the lambda custom resource from the template and handler code
     */
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

    let configs;
    try {
      configs = await getConfigs(context);
    } catch (error) {
      // This pulls the reason from the error, just stringifying it does not return the message
      const errorDetails = JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)))
      await putError(s3Client, functionFromEvent.FunctionName, errorDetails);
      throw error;
    }

    await instrumentFunctions(
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

      await instrumentFunctions(
        configs,
        functionsToCheck,
        instrumentOutcome,
        taggingClient,
        SCHEDULED_INVOCATION_EVENT,
      );

      await updateConfigHash(s3Client, configs);
    } else if (errors.length) {
      logger.log(`Found previous errors in ${errors.length} functions.  ${JSON.stringify(errors)}`);
      const functionsToCheck = await Promise.all(errors.map(async (lambdaFunctionName) => {
        const lambdaFunction = await getLambdaFunction(lambdaClient, lambdaFunctionName)
        return {
          ...lambdaFunction.Configuration,
          Tags: lambdaFunction.Tags,
        };
      }));
      const enrichedFunctions = await enrichFunctionsWithTags(lambdaClient, functionsToCheck);
      await instrumentFunctions(
        configs,
        enrichedFunctions,
        instrumentOutcome,
        taggingClient,
      );
    } else {
      logger.log("Configuration has not changed. Skipping instrumentation.");
    }
  }

  // If it's a different event type, log an error
  else {
    console.error("Received unexpected event type");
  }
};
