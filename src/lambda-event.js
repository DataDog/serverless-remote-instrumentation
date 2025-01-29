const { getLambdaFunction } = require("./functions");
const { DD_SLS_REMOTE_INSTRUMENTER_CHECK } = require("./tag");
const { DD_SLS_REMOTE_INSTRUMENTER_VERSION } = require("./consts");
const { logger } = require("./logger");
const { PROCESSING } = require("./consts");

const UPDATE_FUNCTION_CONFIGURATION_EVENT_NAME =
  "UpdateFunctionConfiguration20150331v2";
const CREATE_FUNCTION_EVENT_NAME = "CreateFunction20150331";
const UNTAG_RESOURCE_EVENT_NAME = "UntagResource20170331v2";
const TAG_RESOURCE_EVENT_NAME = "TagResource20170331v2";

function isScheduledInvocationEvent(event) {
  return (
    Object.prototype.hasOwnProperty.call(event, "event-type") &&
    event["event-type"] === "Scheduled Instrumenter Invocation"
  );
}
exports.isScheduledInvocationEvent = isScheduledInvocationEvent;

function isStackDeletedEvent(event) {
  return (
    Object.prototype.hasOwnProperty.call(event, "RequestType") &&
    event.RequestType === "Delete"
  );
}
exports.isStackDeletedEvent = isStackDeletedEvent;

function isStackCreatedEvent(event) {
  return (
    Object.prototype.hasOwnProperty.call(event, "RequestType") &&
    event.RequestType === "Create"
  );
}
exports.isStackCreatedEvent = isStackCreatedEvent;

function isLambdaManagementEvent(event) {
  return (
    Object.prototype.hasOwnProperty.call(event, "detail-type") &&
    event["detail-type"] === "AWS API Call via CloudTrail" &&
    Object.prototype.hasOwnProperty.call(event, "source") &&
    event.source === "aws.lambda"
  );
}
exports.isLambdaManagementEvent = isLambdaManagementEvent;

function isUpdateConfigurationEvent(event) {
  // TODO: [Followup] Do additional checks to only reinstrument if the important fields have changed
  // (e.g. reinstrument if layers, memory size, env vars, runtime, handler have changed,
  //       don't reinstrument if description changed)
  return event.detail?.eventName === UPDATE_FUNCTION_CONFIGURATION_EVENT_NAME;
}
exports.isUpdateConfigurationEvent = isUpdateConfigurationEvent;

function isCreateFunctionEvent(event) {
  return event.detail?.eventName === CREATE_FUNCTION_EVENT_NAME;
}
exports.isCreateFunctionEvent = isCreateFunctionEvent;

function isTagResourceEvent(event) {
  return event.detail?.eventName === TAG_RESOURCE_EVENT_NAME;
}
exports.isTagResourceEvent = isTagResourceEvent;

function isUntagResourceEvent(event) {
  return event.detail?.eventName === UNTAG_RESOURCE_EVENT_NAME;
}
exports.isUntagResourceEvent = isUntagResourceEvent;

function shouldSkipEvent(event) {
  // Skip any events for the remote instrumenter itself
  const instrumenterFunctionName = process.env.DD_INSTRUMENTER_FUNCTION_NAME;
  if (
    event.detail.requestParameters?.functionName === instrumenterFunctionName
  ) {
    logger.log(
      `Skipping Lambda event for remote instrumenter '${instrumenterFunctionName}'`,
    );
    return true;
  }

  /* 
  Ensure event name is supported.
  Not supported events include:
    - AddPermission20150331
    - AddPermission20150331v2
    - DeleteFunction20150331
    - PublishLayerVersion20181031
    - RemovePermission20150331
    - PutFunctionConcurrency20171031
    - RemovePermission20150331v2
    - UpdateFunctionCode20150331v2
    - DeleteLayerVersion20181031
  */
  const expectedEventNameSet = new Set([
    UPDATE_FUNCTION_CONFIGURATION_EVENT_NAME,
    CREATE_FUNCTION_EVENT_NAME,
    TAG_RESOURCE_EVENT_NAME,
    UNTAG_RESOURCE_EVENT_NAME,
  ]);
  if (!expectedEventNameSet.has(event.detail.eventName)) {
    logger.log(
      `Skipping event '${event.detail.eventName}' because it is not supported.`,
    );
    return true;
  }

  if (event?.detail?.errorCode) {
    logger.log(
      `Skipping '${event.detail.eventName}' event because the lambda update failed: ${event?.detail?.errorCode}: ${event?.detail?.errorMessage}.`,
    );
    return true;
  }

  return false;
}
exports.shouldSkipEvent = shouldSkipEvent;

async function getFunctionFromLambdaEvent(lambdaClient, event) {
  // If it's not a supported event type, skip it
  if (shouldSkipEvent(event)) {
    return;
  }

  let functionName = event.detail.requestParameters?.functionName;

  // If it's an update configuration event, adjust the function name
  if (isUpdateConfigurationEvent(event)) {
    functionName = event.detail.responseElements.functionName;
  }

  // Handle tag and untag resource events
  if (isTagResourceEvent(event) || isUntagResourceEvent(event)) {
    let tagKeys = isTagResourceEvent(event)
      ? new Set(Object.keys(event.detail.requestParameters.tags))
      : new Set(event.detail.requestParameters.tagKeys);
    functionName = event.detail.requestParameters.resource.split(":")[6];
    tagKeys.delete(DD_SLS_REMOTE_INSTRUMENTER_VERSION);
    tagKeys.delete(DD_SLS_REMOTE_INSTRUMENTER_CHECK);
    if (tagKeys.size === 0) {
      logger.log(
        `Skipping event '${event.detail.eventName}' because the modified tags are caused by the remote instrumenter.`,
      );
      return;
    }
  }

  logger.frontendLambdaEvents(
    PROCESSING,
    functionName,
    `Received function name '${functionName}' from event '${event.detail.eventName}'`,
  );

  const functionFromEvent = await getLambdaFunction(lambdaClient, functionName);
  return functionFromEvent.Configuration;
}
exports.getFunctionFromLambdaEvent = getFunctionFromLambdaEvent;
