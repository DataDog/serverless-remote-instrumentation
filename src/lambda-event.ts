import { getLambdaFunction } from "./functions";
import { DD_SLS_REMOTE_INSTRUMENTER_VERSION } from "./consts";
import { logger } from "./logger";
import { ResourceNotFoundException } from "@aws-sdk/client-lambda";

const UPDATE_FUNCTION_CONFIGURATION_EVENT_NAME =
  "UpdateFunctionConfiguration20150331v2";
const CREATE_FUNCTION_EVENT_NAME = "CreateFunction20150331";
const UNTAG_RESOURCE_EVENT_NAME = "UntagResource20170331v2";
const TAG_RESOURCE_EVENT_NAME = "TagResource20170331v2";

export function isScheduledInvocationEvent(event: any): boolean {
  return (
    Object.prototype.hasOwnProperty.call(event, "event-type") &&
    event["event-type"] === "Scheduled Instrumenter Invocation"
  );
}

export function isStackDeletedEvent(event: any): boolean {
  return (
    Object.prototype.hasOwnProperty.call(event, "RequestType") &&
    event.RequestType === "Delete"
  );
}

export function isStackCreatedEvent(event: any): boolean {
  return (
    Object.prototype.hasOwnProperty.call(event, "RequestType") &&
    event.RequestType === "Create"
  );
}

export function isLambdaManagementEvent(event: any): boolean {
  return (
    Object.prototype.hasOwnProperty.call(event, "detail-type") &&
    event["detail-type"] === "AWS API Call via CloudTrail" &&
    Object.prototype.hasOwnProperty.call(event, "source") &&
    event.source === "aws.lambda"
  );
}

export function isUpdateEvent(event: any): boolean {
  return (
    Object.prototype.hasOwnProperty.call(event, "event-type") &&
    event["event-type"] === "UpdateEvent"
  );
}

export function isUpdateConfigurationEvent(event: any): boolean {
  // TODO: [Followup] Do additional checks to only reinstrument if the important fields have changed
  // (e.g. reinstrument if layers, memory size, env vars, runtime, handler have changed,
  //       don't reinstrument if description changed)
  return event.detail?.eventName === UPDATE_FUNCTION_CONFIGURATION_EVENT_NAME;
}

export function isCreateFunctionEvent(event: any): boolean {
  return event.detail?.eventName === CREATE_FUNCTION_EVENT_NAME;
}

export function isTagResourceEvent(event: any): boolean {
  return event.detail?.eventName === TAG_RESOURCE_EVENT_NAME;
}

export function isUntagResourceEvent(event: any): boolean {
  return event.detail?.eventName === UNTAG_RESOURCE_EVENT_NAME;
}

function shouldSkipEvent(event: any): boolean {
  // Skip any events for the remote instrumenter itself
  const instrumenterFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
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

  if (
    event?.detail?.userIdentity?.principalId.includes(instrumenterFunctionName)
  ) {
    logger.log(
      `Skipping '${event.detail.eventName}' event because its source is the remote instrumenter.`,
    );
    return true;
  }

  return false;
}
export { shouldSkipEvent };

export async function getFunctionFromLambdaEvent(
  lambdaClient: any,
  event: any,
): Promise<any> {
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
    if (tagKeys.size === 0) {
      logger.log(
        `Skipping event '${event.detail.eventName}' because the modified tags are caused by the remote instrumenter.`,
      );
      return;
    }
  }

  logger.emitFrontendProcessingEvent(
    functionName,
    `Received function name '${functionName}' from event '${event.detail.eventName}'`,
  );

  try {
    const functionFromEvent = await getLambdaFunction(
      lambdaClient,
      functionName,
    );
    return functionFromEvent.Configuration;
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      return;
    }
    throw e;
  }
}

export function selectEventFieldsForLogging(event: any): any {
  return {
    eventName: event.detail?.eventName,
    requestType: event.RequestType,
    source: event.source,
    detailType: event["detail-type"],
    functionName:
      event.detail?.requestParameters?.functionName ??
      event.detail?.responseElements?.functionName,
    errorCode: event.detail?.errorCode,
    userIdentity: event.detail?.userIdentity?.arn,
    tags: event.detail?.requestParameters?.tags,
  };
}
