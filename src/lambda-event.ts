import { LambdaClient } from "@aws-sdk/client-lambda";
import { ResourceNotFoundException } from "@aws-sdk/client-lambda";
import { FunctionConfiguration } from "@aws-sdk/client-lambda";
import { getLambdaFunction } from "./functions";
import {
  DD_SLS_REMOTE_INSTRUMENTER_VERSION,
  type UnenrichedLambdaFunction,
} from "./consts";
import { logger } from "./logger";

const UPDATE_FUNCTION_CONFIGURATION_EVENT_NAME =
  "UpdateFunctionConfiguration20150331v2";
const CREATE_FUNCTION_EVENT_NAME = "CreateFunction20150331";
const UNTAG_RESOURCE_EVENT_NAME = "UntagResource20170331v2";
const TAG_RESOURCE_EVENT_NAME = "TagResource20170331v2";

export interface ScheduledInvocationEvent {
  "event-type": string;
}

export interface CloudFormationEvent {
  RequestType: string;
  [key: string]: unknown;
}

export interface LambdaManagementEvent {
  "detail-type": string;
  source: string;
  time?: string;
  detail: {
    eventName: string;
    requestParameters?: {
      functionName?: string;
      resource?: string;
      tags?: Record<string, string>;
      tagKeys?: string[];
    };
    responseElements?: {
      functionName?: string;
    };
    errorCode?: string;
    errorMessage?: string;
    userIdentity?: {
      arn?: string;
      principalId: string;
    };
  };
}

export type InstrumenterEvent =
  | ScheduledInvocationEvent
  | CloudFormationEvent
  | LambdaManagementEvent;

export function isScheduledInvocationEvent(
  event: unknown,
): event is ScheduledInvocationEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "event-type" in event &&
    (event as ScheduledInvocationEvent)["event-type"] ===
      "Scheduled Instrumenter Invocation"
  );
}

export function isStackDeletedEvent(
  event: unknown,
): event is CloudFormationEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "RequestType" in event &&
    (event as CloudFormationEvent).RequestType === "Delete"
  );
}

export function isStackCreatedEvent(
  event: unknown,
): event is CloudFormationEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "RequestType" in event &&
    (event as CloudFormationEvent).RequestType === "Create"
  );
}

export function isStackUpdatedEvent(
  event: unknown,
): event is CloudFormationEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "RequestType" in event &&
    (event as CloudFormationEvent).RequestType === "Update"
  );
}

export function isLambdaManagementEvent(
  event: unknown,
): event is LambdaManagementEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "detail-type" in event &&
    (event as LambdaManagementEvent)["detail-type"] ===
      "AWS API Call via CloudTrail" &&
    "source" in event &&
    (event as LambdaManagementEvent).source === "aws.lambda"
  );
}

export function isUpdateConfigurationEvent(
  event: LambdaManagementEvent,
): boolean {
  // TODO: [Followup] Do additional checks to only reinstrument if the important fields have changed
  // (e.g. reinstrument if layers, memory size, env vars, runtime, handler have changed,
  //       don't reinstrument if description changed)
  return event.detail?.eventName === UPDATE_FUNCTION_CONFIGURATION_EVENT_NAME;
}

export function isCreateFunctionEvent(event: LambdaManagementEvent): boolean {
  return event.detail?.eventName === CREATE_FUNCTION_EVENT_NAME;
}

export function isTagResourceEvent(event: LambdaManagementEvent): boolean {
  return event.detail?.eventName === TAG_RESOURCE_EVENT_NAME;
}

export function isUntagResourceEvent(event: LambdaManagementEvent): boolean {
  return event.detail?.eventName === UNTAG_RESOURCE_EVENT_NAME;
}

function shouldSkipEvent(event: LambdaManagementEvent): boolean {
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

  if (event.detail?.errorCode) {
    logger.log(
      `Skipping '${event.detail.eventName}' event because the lambda update failed: ${event.detail?.errorCode}: ${event.detail?.errorMessage}.`,
    );
    return true;
  }

  if (
    event.detail?.userIdentity?.principalId.includes(instrumenterFunctionName!)
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
  lambdaClient: LambdaClient,
  event: LambdaManagementEvent,
): Promise<UnenrichedLambdaFunction | undefined> {
  // If it's not a supported event type, skip it
  if (shouldSkipEvent(event)) {
    return;
  }

  let functionName = event.detail.requestParameters?.functionName;

  // If it's an update configuration event, adjust the function name
  if (isUpdateConfigurationEvent(event)) {
    functionName = event.detail.responseElements?.functionName;
  }

  // Handle tag and untag resource events
  if (isTagResourceEvent(event) || isUntagResourceEvent(event)) {
    let tagKeys = isTagResourceEvent(event)
      ? new Set(Object.keys(event.detail.requestParameters!.tags!))
      : new Set(event.detail.requestParameters!.tagKeys!);
    functionName = event.detail.requestParameters!.resource!.split(":")[6];
    tagKeys.delete(DD_SLS_REMOTE_INSTRUMENTER_VERSION);
    if (tagKeys.size === 0) {
      logger.log(
        `Skipping event '${event.detail.eventName}' because the modified tags are caused by the remote instrumenter.`,
      );
      return;
    }
  }

  logger.emitFrontendProcessingEvent(
    functionName!,
    `Received function name '${functionName}' from event '${event.detail.eventName}'`,
  );

  try {
    const functionFromEvent = await getLambdaFunction(
      lambdaClient,
      functionName!,
    );
    // getLambdaFunction (GetFunction) already returns the resource tags, so
    // thread them through here. Defaulting to {} (rather than leaving it
    // undefined) ensures enrichFunctionsWithTags uses these tags instead of
    // issuing a second GetFunction call for the same function.
    return {
      ...functionFromEvent.Configuration,
      Tags: functionFromEvent.Tags ?? {},
    };
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      return;
    }
    throw e;
  }
}

export function selectEventFieldsForLogging(
  event: InstrumenterEvent,
): Record<string, unknown> {
  const mgmtEvent = event as Partial<LambdaManagementEvent>;
  const cfnEvent = event as Partial<CloudFormationEvent>;
  return {
    eventName: mgmtEvent.detail?.eventName,
    requestType: cfnEvent.RequestType,
    source: mgmtEvent.source,
    detailType: (event as Record<string, unknown>)["detail-type"],
    functionName:
      mgmtEvent.detail?.requestParameters?.functionName ??
      mgmtEvent.detail?.responseElements?.functionName,
    errorCode: mgmtEvent.detail?.errorCode,
    userIdentity: mgmtEvent.detail?.userIdentity?.arn,
    tags: mgmtEvent.detail?.requestParameters?.tags,
  };
}
