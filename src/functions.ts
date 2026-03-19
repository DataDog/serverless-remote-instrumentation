import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from "@aws-sdk/client-resource-groups-tagging-api";
import type { GetResourcesCommandOutput } from "@aws-sdk/client-resource-groups-tagging-api";
import { sleep } from "./sleep";
import {
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  ListFunctionsCommand,
  GetAccountSettingsCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import type {
  FunctionConfiguration,
  GetFunctionCommandOutput,
  ListFunctionsCommandOutput,
} from "@aws-sdk/client-lambda";
import { getLambdaClient } from "./aws-resources";
import { logger } from "./logger";
import {
  DD_SLS_REMOTE_INSTRUMENTER_VERSION,
  ALREADY_MANUALLY_INSTRUMENTED,
  DD_API_KEY,
  DD_KMS_API_KEY,
  DD_API_KEY_SECRET_ARN,
  DD_API_KEY_SSM_ARN,
  DD_SITE,
  VERSION,
  INSTRUMENT,
  TAG,
  FUNCTION_NAME,
  NOT_SATISFYING_TARGETING_RULES,
  SKIPPED,
  REMOTE_INSTRUMENTER_FUNCTION,
  UNSUPPORTED_RUNTIME,
  ALREADY_CORRECT_EXTENSION_AND_LAYER,
  SUPPORTED_RUNTIME_CONFIGURATIONS,
  getRuntimeConfig,
  type LambdaFunction,
  type UnenrichedLambdaFunction,
  type RuleFilter,
  type InstrumentOutcome,
} from "./consts";

interface Config {
  ruleFilters: RuleFilter[];
  instrumenterFunctionName?: string;
  extensionVersion?: number;
  ddTraceEnabled?: boolean;
  ddServerlessLogsEnabled?: boolean;
  [key: string]: unknown;
}

/**
 * Get the ARNs of all functions that have been remotely instrumented.
 * (i.e. functions that have the DD_SLS_REMOTE_INSTRUMENTER_VERSION tag)
 */
export async function getRemotelyInstrumentedFunctionArns(
  client: ResourceGroupsTaggingAPIClient,
): Promise<string[]> {
  const input = {
    TagFilters: [
      { Key: DD_SLS_REMOTE_INSTRUMENTER_VERSION, Values: [VERSION!] },
    ],
    ResourceTypeFilters: ["lambda:function"],
  };
  const getResourcesCommand = new GetResourcesCommand(input);
  let getResourcesCommandOutput: GetResourcesCommandOutput = {
    $metadata: {},
    ResourceTagMappingList: [],
  };
  try {
    getResourcesCommandOutput = await client.send(getResourcesCommand);
  } catch (error) {
    logger.error(`Error retrieving remotely instrumented functions: ${error}`);
    return [];
  }

  const functionArns: string[] = [];
  for (const resourceTagMapping of getResourcesCommandOutput.ResourceTagMappingList ??
    []) {
    functionArns.push(resourceTagMapping.ResourceARN!);
  }
  logger.log(`Found remotely instrumented function ARNs: '${functionArns}'`);
  return functionArns;
}

export async function getAllFunctions(
  client: LambdaClient,
): Promise<FunctionConfiguration[]> {
  let allFunctions: FunctionConfiguration[] = [];
  const listFunctionsCommand = new ListFunctionsCommand({});
  let listFunctionsCommandOutput: ListFunctionsCommandOutput;

  listFunctionsCommandOutput = await client.send(listFunctionsCommand);
  allFunctions.push(...(listFunctionsCommandOutput.Functions ?? []));

  let nextMarker = listFunctionsCommandOutput.NextMarker;
  while (nextMarker) {
    const listFunctionsCommand = new ListFunctionsCommand({
      Marker: nextMarker,
    });
    try {
      const listFunctionsCommandOutput =
        await client.send(listFunctionsCommand);
      allFunctions.push(...(listFunctionsCommandOutput.Functions ?? []));
      nextMarker = listFunctionsCommandOutput.NextMarker;
    } catch (error) {
      logger.error(`Error retrieving functions: ${error}`);
      throw error;
    }
  }
  logger.log(
    `Retrieved all lambda functions in the account: ${JSON.stringify(allFunctions.map((f) => selectFunctionFieldsForLogging(f)))}`,
  );
  return allFunctions;
}

async function getAWSResourceTagsForFunction(
  client: LambdaClient,
  lambdaFunctionName: string,
): Promise<Record<string, string>> {
  const getFunctionCommandOutput = await getLambdaFunction(
    client,
    lambdaFunctionName,
  );
  const awsResourceTags = getFunctionCommandOutput.Tags ?? {};
  return awsResourceTags;
}

export async function getLambdaFunction(
  client: LambdaClient,
  lambdaFunctionName: string,
): Promise<GetFunctionCommandOutput> {
  const params = {
    FunctionName: lambdaFunctionName,
  };
  const getFunctionCommand = new GetFunctionCommand(params);
  const getFunctionCommandOutput = await client.send(getFunctionCommand);
  return getFunctionCommandOutput;
}

async function enrichFunctionsWithTags(
  client: LambdaClient,
  functions: UnenrichedLambdaFunction[],
): Promise<LambdaFunction[]> {
  // Loop through the functions and collect each one's tags
  const enrichedFunctions: LambdaFunction[] = [];
  for (const lambdaFunc of functions) {
    const functionTagArray =
      lambdaFunc.Environment?.Variables?.DD_TAGS?.split(" ") || [];
    let functionTags = functionTagArray.map((functionTag) =>
      functionTag?.replace(/"/g, ""),
    );

    // Tags may be a Record<string, string> from the AWS SDK's GetFunctionCommandOutput
    const awsResourceTags: Record<string, string> =
      lambdaFunc.Tags ??
      (await getAWSResourceTagsForFunction(client, lambdaFunc.FunctionName!)) ??
      {};
    for (const [key, value] of Object.entries(awsResourceTags)) {
      functionTags.push(key + ":" + value);
    }

    // Also add the runtime as a tag
    functionTags.push("runtime:" + lambdaFunc.Runtime);

    const functionTagsSet = new Set(functionTags);
    enrichedFunctions.push({
      ...lambdaFunc,
      FunctionName: lambdaFunc.FunctionName!,
      Tags: functionTagsSet,
    });
  }
  logger.log(
    `Enriched the following functions with tags: '${JSON.stringify(
      enrichedFunctions.map((f) => selectFunctionFieldsForLogging(f)),
    )}'`,
  );
  return enrichedFunctions;
}
export { enrichFunctionsWithTags };

export function satisfiesTargetingRules(
  functionName: string,
  functionTags: Set<string>,
  ruleFilters: RuleFilter[],
): boolean {
  functionTags = new Set(
    Array.from(functionTags).map((tag) => tag.toLowerCase()),
  );

  // If there are no rule filters, nothing matches
  if (ruleFilters.length === 0) {
    return false;
  }

  for (const ruleFilter of ruleFilters) {
    if (ruleFilter.filterType === TAG) {
      const ruleFilterKey = ruleFilter.key.toLowerCase();
      const ruleFilterValues = ruleFilter.values.map((value: string) =>
        value.toLowerCase(),
      );
      if (ruleFilter.allow) {
        let hasAllowedTag = false;
        for (const value of ruleFilterValues) {
          if (functionTags.has(ruleFilterKey + ":" + value)) {
            hasAllowedTag = true;
          }
        }
        if (!hasAllowedTag) {
          return false;
        }
      } else {
        for (const value of ruleFilterValues) {
          if (functionTags.has(ruleFilterKey + ":" + value)) {
            return false;
          }
        }
      }
    } else if (ruleFilter.filterType === FUNCTION_NAME) {
      const ruleFilterFunctionNames = new Set(ruleFilter.values);
      if (ruleFilter.allow) {
        if (
          !ruleFilterFunctionNames.has(functionName) &&
          !ruleFilterFunctionNames.has("*")
        ) {
          return false;
        }
      } else if (ruleFilterFunctionNames.has(functionName)) {
        return false;
      }
    }
  }
  return true;
}

export function isRemoteInstrumenter(
  functionName: string,
  instrumenterName?: string,
): boolean {
  return functionName === instrumenterName;
}

export function filterFunctionsToChangeInstrumentation(
  functions: LambdaFunction[],
  config: Config,
  instrumentOutcome: InstrumentOutcome,
): {
  functionsToInstrumentOrTag: LambdaFunction[];
  functionsToUninstrumentOrUntag: LambdaFunction[];
} {
  const functionsToInstrumentOrTag: LambdaFunction[] = [];
  const functionsToUninstrumentOrUntag: LambdaFunction[] = [];
  const emitProcessingLogs = functions.length === 1;
  for (const lambdaFunc of functions) {
    const { instrument, uninstrument, tag, untag } = needsInstrumentationUpdate(
      lambdaFunc,
      config,
      instrumentOutcome,
      emitProcessingLogs,
    );
    if (instrument || tag) {
      lambdaFunc.needsInstrumentation = instrument;
      lambdaFunc.needsTagging = tag;
      functionsToInstrumentOrTag.push(lambdaFunc);
    } else if (uninstrument || untag) {
      lambdaFunc.needsUninstrumentation = uninstrument;
      lambdaFunc.needsUntagging = untag;
      functionsToUninstrumentOrUntag.push(lambdaFunc);
    }
  }
  return {
    functionsToInstrumentOrTag,
    functionsToUninstrumentOrUntag,
  };
}

export function isRemotelyInstrumented(lambdaFunc: LambdaFunction): boolean {
  const tagKeys = new Set(
    Array.from(lambdaFunc.Tags as Set<string>).map((tag) => tag.split(":")[0]),
  );
  return tagKeys.has(DD_SLS_REMOTE_INSTRUMENTER_VERSION);
}

const hasLayerMatching = (l: LambdaFunction, matcher: string): boolean =>
  l?.Layers?.some((layer) => layer.Arn!.includes(matcher))!;

export function isInstrumented(lambdaFunc: LambdaFunction): boolean {
  const envVars = new Set(
    Object.keys(lambdaFunc?.Environment?.Variables || {}),
  );
  // If there is a key and the dd site is configured
  if (
    (envVars.has(DD_API_KEY) ||
      envVars.has(DD_API_KEY_SECRET_ARN) ||
      envVars.has(DD_API_KEY_SSM_ARN) ||
      envVars.has(DD_KMS_API_KEY)) &&
    envVars.has(DD_SITE)
  ) {
    return true;
  }
  // Since the above environment variables can be configured
  // in a datadog.yaml file, check if a datadog layer is present
  const hasDatadogLayer =
    Object.values(SUPPORTED_RUNTIME_CONFIGURATIONS).some((runtimeConfig) =>
      runtimeConfig.layerName
        ? hasLayerMatching(lambdaFunc, runtimeConfig.layerName)
        : false,
    ) || hasLayerMatching(lambdaFunc, "Datadog-Extension");

  if (hasDatadogLayer) {
    return true;
  }
  return false;
}

export function isCorrectlyInstrumented({
  layers,
  config,
  targetLambdaRuntime,
  ddTraceEnabledValue,
  ddServerlessLogsEnabledValue,
}: {
  layers: { Arn?: string }[];
  config: Config;
  targetLambdaRuntime: string;
  ddTraceEnabledValue?: string;
  ddServerlessLogsEnabledValue?: string;
}): boolean {
  // Check if the extension is correct
  let targetLambdaExtensionLayerVersion = -1;
  for (const layer of layers) {
    if (layer?.Arn?.includes("464622532012:layer:Datadog-Extension")) {
      const parts = layer.Arn.split(":");
      targetLambdaExtensionLayerVersion = parseInt(parts[parts.length - 1], 10);
      break;
    }
  }

  if (
    config.extensionVersion &&
    targetLambdaExtensionLayerVersion !== config.extensionVersion
  ) {
    return false;
  } else if (
    !config.extensionVersion &&
    targetLambdaExtensionLayerVersion !== -1
  ) {
    return false;
  }

  // Check if the lambda layer version is correct
  const runtimeConfig = getRuntimeConfig(targetLambdaRuntime);
  const expectedLayerName = runtimeConfig?.layerName;
  const expectedLayerVersion = runtimeConfig?.configField
    ? (config[runtimeConfig.configField] as number | undefined)
    : undefined;

  let foundLayerVersion;
  for (const layer of layers) {
    logger.log(`Checking runtime layer: ${JSON.stringify(layer)}`);
    if (layer?.Arn?.includes(`464622532012:layer:${expectedLayerName}`)) {
      const layerParts = layer.Arn.split(":");
      foundLayerVersion = parseInt(layerParts[layerParts.length - 1], 10);
      break;
    }
  }
  if (expectedLayerVersion !== foundLayerVersion) {
    return false;
  }

  // Check the tracing and logging settings
  const newTracingEnabled = (config.ddTraceEnabled !== false).toString();
  const newLoggingEnabled = (
    config.ddServerlessLogsEnabled !== false
  ).toString();
  if (ddTraceEnabledValue !== newTracingEnabled) {
    return false;
  }
  if (ddServerlessLogsEnabledValue !== newLoggingEnabled) {
    return false;
  }
  return true;
}

export function needsInstrumentationUpdate(
  lambdaFunc: LambdaFunction,
  config: Config,
  instrumentOutcome: InstrumentOutcome,
  emitProcessingLogs: boolean,
): {
  instrument: boolean;
  uninstrument: boolean;
  tag: boolean;
  untag: boolean;
} {
  const functionName = lambdaFunc.FunctionName;
  const tags = lambdaFunc.Tags as Set<string>;
  const functionArn = lambdaFunc.FunctionArn;
  const isCurrentlyRemotelyInstrumented = isRemotelyInstrumented(lambdaFunc);
  const runtime = lambdaFunc.Runtime!;
  const isCurrentlyInstrumented = isInstrumented(lambdaFunc);

  // If it is instrumented but not by the remote instrumenter
  if (isCurrentlyInstrumented && !isCurrentlyRemotelyInstrumented) {
    if (emitProcessingLogs) {
      logger.emitFrontendProcessingEvent(
        functionName,
        `Skipping function '${functionName}' because it is manually instrumented.`,
      );
    }
    const reason = `Function '${functionName}' is manually instrumented.`;
    const reasonCode = ALREADY_MANUALLY_INSTRUMENTED;
    instrumentOutcome.instrument.skipped[functionName] = {
      functionArn,
      reason,
      reasonCode,
    };
    logger.logInstrumentOutcome({
      ddSlsEventName: INSTRUMENT,
      outcome: SKIPPED,
      targetFunctionName: functionName,
      targetFunctionArn: functionArn,
      runtime,
      reason,
      reasonCode,
    });
    return {
      instrument: false,
      uninstrument: false,
      tag: false,
      untag: false,
    };
  }

  // If it doesn't satisfy the targeting rules...
  if (!satisfiesTargetingRules(functionName, tags, config.ruleFilters)) {
    // ... and isn't instrumented, skip it
    if (!isCurrentlyRemotelyInstrumented) {
      if (emitProcessingLogs) {
        logger.emitFrontendProcessingEvent(
          functionName,
          `Skipping function '${functionName}' because it does not satisfy targeting rules.`,
        );
      }
      const reason = `Function '${functionName}' does not satisfy targeting rules.`;
      instrumentOutcome.instrument.skipped[functionName] = {
        functionArn,
        reason: reason,
        reasonCode: NOT_SATISFYING_TARGETING_RULES,
      };

      logger.logInstrumentOutcome({
        ddSlsEventName: INSTRUMENT,
        outcome: SKIPPED,
        targetFunctionName: functionName,
        targetFunctionArn: functionArn,
        runtime: runtime,
        reason: reason,
        reasonCode: NOT_SATISFYING_TARGETING_RULES,
      });
      return {
        instrument: false,
        uninstrument: false,
        tag: false,
        untag: false,
      };
    } // ...and it is instrumented, uninstrument it
    else {
      if (emitProcessingLogs) {
        logger.emitFrontendProcessingEvent(
          functionName,
          `Uninstrumenting function '${functionName}' because it does not satisfy targeting rules.`,
        );
      }
      return {
        instrument: false,
        uninstrument: true,
        tag: false,
        untag: true,
      };
    }
  }

  // If it's the remote instrumenter lambda itself, skip it
  if (isRemoteInstrumenter(functionName, config.instrumenterFunctionName)) {
    if (emitProcessingLogs) {
      logger.emitFrontendProcessingEvent(
        functionName,
        `Skipping function '${functionName}' because it is the remote instrumenter function.`,
      );
    }
    const reason = `Function '${functionName}' is the remote instrumenter function.`;
    instrumentOutcome.instrument.skipped[functionName] = {
      functionArn,
      reason: reason,
      reasonCode: REMOTE_INSTRUMENTER_FUNCTION,
    };
    logger.logInstrumentOutcome({
      ddSlsEventName: INSTRUMENT,
      outcome: SKIPPED,
      targetFunctionName: functionName,
      targetFunctionArn: functionArn,
      runtime: runtime,
      reason: reason,
      reasonCode: REMOTE_INSTRUMENTER_FUNCTION,
    });
    return { instrument: false, uninstrument: false, tag: false, untag: false };
  }

  // If it's an unsupported runtime, skip it
  if (!getRuntimeConfig(runtime)) {
    if (emitProcessingLogs) {
      logger.emitFrontendProcessingEvent(
        functionName,
        `Skipping function '${functionName}' because it has an unsupported runtime.`,
      );
    }
    const reason = `Function's runtime '${runtime}' not supported.`;
    instrumentOutcome.instrument.skipped[functionName] = {
      functionArn,
      reason: reason,
      reasonCode: UNSUPPORTED_RUNTIME,
    };
    logger.logInstrumentOutcome({
      ddSlsEventName: INSTRUMENT,
      outcome: SKIPPED,
      targetFunctionName: functionName,
      targetFunctionArn: functionArn,
      runtime: runtime,
      reason: reason,
      reasonCode: UNSUPPORTED_RUNTIME,
    });
    return { instrument: false, uninstrument: false, tag: false, untag: false };
  }

  // If it's already instrumented correctly, don't reinstrument but tag if necessary
  const layers = lambdaFunc.Layers || [];
  if (
    isCorrectlyInstrumented({
      layers: layers,
      config: config,
      targetLambdaRuntime: runtime,
      ddTraceEnabledValue: lambdaFunc.Environment?.Variables?.DD_TRACE_ENABLED,
      ddServerlessLogsEnabledValue:
        lambdaFunc.Environment?.Variables?.DD_SERVERLESS_LOGS_ENABLED,
    })
  ) {
    if (emitProcessingLogs) {
      logger.emitFrontendProcessingEvent(
        functionName,
        `Skipping function '${functionName}' because it is already correctly instrumented.`,
      );
    }
    const reason = `Function '${functionName}' is already instrumented with correct extension and tracer layer versions.`;
    logger.logInstrumentOutcome({
      ddSlsEventName: INSTRUMENT,
      outcome: SKIPPED,
      targetFunctionName: functionName,
      targetFunctionArn: functionArn,
      runtime: runtime,
      reason: reason,
      reasonCode: ALREADY_CORRECT_EXTENSION_AND_LAYER,
    });
    instrumentOutcome.instrument.skipped[functionName] = {
      functionArn,
      reason: reason,
      reasonCode: ALREADY_CORRECT_EXTENSION_AND_LAYER,
    };
    return { instrument: false, uninstrument: false, tag: false, untag: false };
  }

  // Otherwise, instrument it
  return { instrument: true, uninstrument: false, tag: true, untag: false };
}

export const waitUntilFunctionIsActive = async (
  functionName: string,
): Promise<boolean> => {
  // Attempting to edit a function that is in a pending state will cause
  // a resource conflict exception to be thrown, and they usually exit that
  // state after a few seconds
  const lambdaClient = getLambdaClient();
  let isFunctionReady = false;
  let count = 0;
  while (!isFunctionReady && count < 10) {
    count += 1;
    const functionStatus = await lambdaClient.send(
      new GetFunctionConfigurationCommand({
        FunctionName: functionName,
      }),
    );
    const { State } = functionStatus;
    if (State !== "Pending") {
      isFunctionReady = true;
    } else {
      await sleep(1000);
    }
  }
  return isFunctionReady;
};

export function selectFunctionFieldsForLogging(
  lambdaFunction: FunctionConfiguration & { Tags?: Set<string> },
): Record<string, unknown> {
  return {
    FunctionName: lambdaFunction.FunctionName,
    FunctionArn: lambdaFunction.FunctionArn,
    Tags: Array.from(lambdaFunction.Tags ?? new Set<string>()),
    Runtime: lambdaFunction.Runtime,
    Layers: lambdaFunction.Layers,
    Architectures: lambdaFunction.Architectures,
  };
}

export async function getFunctionCount(client: LambdaClient): Promise<number> {
  const command = new GetAccountSettingsCommand({});
  const response = await client.send(command);
  return response.AccountUsage!.FunctionCount!;
}
