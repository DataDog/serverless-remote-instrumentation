const {
  GetResourcesCommand,
} = require("@aws-sdk/client-resource-groups-tagging-api");
const { sleep } = require("./sleep");
const {
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  ListFunctionsCommand,
  GetAccountSettingsCommand,
} = require("@aws-sdk/client-lambda");
const { getLambdaClient } = require("./aws-resources");
const { logger } = require("./logger");
const {
  DD_SLS_REMOTE_INSTRUMENTER_VERSION,
  ALREADY_MANUALLY_INSTRUMENTED,
  DD_API_KEY,
  DD_KMS_API_KEY,
  DD_API_KEY_SECRET_ARN,
  DD_SITE,
  VERSION,
  SUPPORTED_RUNTIMES,
  NODE,
  PYTHON,
  INSTRUMENT,
  TAG,
  FUNCTION_NAME,
  NOT_SATISFYING_TARGETING_RULES,
  SKIPPED,
  REMOTE_INSTRUMENTER_FUNCTION,
  UNSUPPORTED_RUNTIME,
  ALREADY_CORRECT_EXTENSION_AND_LAYER,
  DD_TRACE_ENABLED,
  DD_SERVERLESS_LOGS_ENABLED,
} = require("./consts");

/**
 * Get the ARNs of all functions that have been remotely instrumented.
 * (i.e. functions that have the DD_SLS_REMOTE_INSTRUMENTER_VERSION tag)
 */
async function getRemotelyInstrumentedFunctionArns(client) {
  const input = {
    TagFilters: [
      { Key: DD_SLS_REMOTE_INSTRUMENTER_VERSION, Values: [VERSION] },
    ],
    ResourceTypeFilters: ["lambda:function"],
  };
  const getResourcesCommand = new GetResourcesCommand(input);
  let getResourcesCommandOutput = { ResourceTagMappingList: [] };
  try {
    getResourcesCommandOutput = await client.send(getResourcesCommand);
  } catch (error) {
    logger.error(`Error retrieving remotely instrumented functions: ${error}`);
    return [];
  }

  const functionArns = [];
  for (const resourceTagMapping of getResourcesCommandOutput.ResourceTagMappingList) {
    functionArns.push(resourceTagMapping.ResourceARN);
  }
  logger.log(`Found remotely instrumented function ARNs: '${functionArns}'`);
  return functionArns;
}
exports.getRemotelyInstrumentedFunctionArns =
  getRemotelyInstrumentedFunctionArns;

async function getAllFunctions(client) {
  let allFunctions = [];
  const listFunctionsCommand = new ListFunctionsCommand({});
  let listFunctionsCommandOutput = {};

  listFunctionsCommandOutput = await client.send(listFunctionsCommand);
  allFunctions.push(...listFunctionsCommandOutput.Functions);

  let nextMarker = listFunctionsCommandOutput.NextMarker;
  while (nextMarker) {
    const listFunctionsCommand = new ListFunctionsCommand({
      Marker: nextMarker,
    });
    try {
      const listFunctionsCommandOutput =
        await client.send(listFunctionsCommand);
      allFunctions.push(...listFunctionsCommandOutput.Functions);
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
exports.getAllFunctions = getAllFunctions;

async function getAWSResourceTagsForFunction(client, lambdaFunctionName) {
  const getFunctionCommandOutput = await getLambdaFunction(
    client,
    lambdaFunctionName,
  );
  const awsResourceTags = getFunctionCommandOutput.Tags;
  return awsResourceTags;
}

async function getLambdaFunction(client, lambdaFunctionName) {
  const params = {
    FunctionName: lambdaFunctionName,
  };
  const getFunctionCommand = new GetFunctionCommand(params);
  let getFunctionCommandOutput = {};
  getFunctionCommandOutput = await client.send(getFunctionCommand);
  return getFunctionCommandOutput;
}
exports.getLambdaFunction = getLambdaFunction;

async function enrichFunctionsWithTags(client, functions) {
  // Loop through the functions and collect each one's tags
  const enrichedFunctions = [];
  for (const lambdaFunc of functions) {
    const functionTagArray =
      lambdaFunc.Environment?.Variables?.DD_TAGS?.split(" ") || [];
    let functionTags = functionTagArray.map((functionTag) =>
      functionTag?.replace(/"/g, ""),
    );

    let awsResourceTags = lambdaFunc.Tags;
    if (!awsResourceTags) {
      awsResourceTags =
        (await getAWSResourceTagsForFunction(
          client,
          lambdaFunc.FunctionName,
        )) ?? {};
    }
    for (const [key, value] of Object.entries(awsResourceTags)) {
      functionTags.push(key + ":" + value);
    }
    const functionTagsSet = new Set(functionTags);
    lambdaFunc.Tags = functionTagsSet;
    enrichedFunctions.push(lambdaFunc);
  }
  logger.log(
    `Enriched the following functions with tags: '${JSON.stringify(
      enrichedFunctions.map((f) => selectFunctionFieldsForLogging(f)),
    )}'`,
  );
  return enrichedFunctions;
}
exports.enrichFunctionsWithTags = enrichFunctionsWithTags;

function satisfiesTargetingRules(functionName, functionTags, ruleFilters) {
  // If there are no rule filters, nothing matches
  if (ruleFilters.length === 0) {
    return false;
  }

  for (const ruleFilter of ruleFilters) {
    if (ruleFilter.filterType === TAG) {
      if (ruleFilter.allow) {
        let hasAllowedTag = false;
        for (const value of ruleFilter.values) {
          if (functionTags.has(ruleFilter.key + ":" + value)) {
            hasAllowedTag = true;
          }
        }
        if (!hasAllowedTag) {
          return false;
        }
      } else {
        for (const value of ruleFilter.values) {
          if (functionTags.has(ruleFilter.key + ":" + value)) {
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
exports.satisfiesTargetingRules = satisfiesTargetingRules;

function isRemoteInstrumenter(functionName, instrumenterName) {
  return functionName === instrumenterName;
}
exports.isRemoteInstrumenter = isRemoteInstrumenter;

function filterFunctionsToChangeInstrumentation(
  functions,
  config,
  instrumentOutcome,
) {
  const functionsToInstrument = [];
  const functionsToUninstrument = [];
  const functionsToTag = [];
  const functionsToUntag = [];
  const emitProcessingLogs = functions.length === 1;
  for (const lambdaFunc of functions) {
    const { instrument, uninstrument, tag, untag } = needsInstrumentationUpdate(
      lambdaFunc,
      config,
      instrumentOutcome,
      emitProcessingLogs,
    );
    if (instrument) {
      functionsToInstrument.push(lambdaFunc);
    } else if (uninstrument) {
      functionsToUninstrument.push(lambdaFunc);
    }

    if (tag) {
      functionsToTag.push(lambdaFunc);
    } else if (untag) {
      functionsToUntag.push(lambdaFunc);
    }
  }
  return {
    functionsToInstrument: functionsToInstrument,
    functionsToUninstrument: functionsToUninstrument,
    functionsToTag: functionsToTag,
    functionsToUntag: functionsToUntag,
  };
}
exports.filterFunctionsToChangeInstrumentation =
  filterFunctionsToChangeInstrumentation;

function isRemotelyInstrumented(lambdaFunc) {
  const tagKeys = new Set(
    Array.from(lambdaFunc.Tags).map((tag) => tag.split(":")[0]),
  );
  return tagKeys.has(DD_SLS_REMOTE_INSTRUMENTER_VERSION);
}
exports.isRemotelyInstrumented = isRemotelyInstrumented;

const hasLayerMatching = (l, matcher) =>
  l?.Layers?.some((layer) => layer.Arn.includes(matcher));

function isInstrumented(lambdaFunc) {
  const envVars = new Set(
    Object.keys(lambdaFunc?.Environment?.Variables || {}),
  );
  // If there is a key and the dd site is configured
  if (
    (envVars.has(DD_API_KEY) ||
      envVars.has(DD_API_KEY_SECRET_ARN) ||
      envVars.has(DD_KMS_API_KEY)) &&
    envVars.has(DD_SITE)
  ) {
    return true;
  }
  // Since the above environment variables can be configured
  // in a datadog.yaml file, check if a datadog layer is present
  const hasDatadogLayer =
    hasLayerMatching(lambdaFunc, "Datadog-Python") ||
    hasLayerMatching(lambdaFunc, "Datadog-Node") ||
    hasLayerMatching(lambdaFunc, "Datadog-Extension");

  if (hasDatadogLayer) {
    return true;
  }
  return false;
}
exports.isInstrumented = isInstrumented;

function isCorrectlyInstrumented({
  layers,
  config,
  targetLambdaRuntime,
  tracingEnabled,
  loggingEnabled,
}) {
  // Check if the extension is correct
  let targetLambdaExtensionLayerVersion = -1;
  for (const layer of layers) {
    if (layer?.Arn?.includes("464622532012:layer:Datadog-Extension")) {
      targetLambdaExtensionLayerVersion = parseInt(
        layer.Arn.split(":").at(-1),
        10,
      );
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
  let expectedLayerName;
  let expectedLayerVersion;
  if (targetLambdaRuntime.toLowerCase().includes(PYTHON)) {
    expectedLayerName = "Datadog-Python";
    expectedLayerVersion = config.pythonLayerVersion;
  } else if (targetLambdaRuntime.toLowerCase().includes(NODE)) {
    expectedLayerName = "Datadog-Node";
    expectedLayerVersion = config.nodeLayerVersion;
  }
  for (const layer of layers) {
    logger.log(`Checking runtime layer: ${JSON.stringify(layer)}`);
    if (layer?.Arn?.includes(`464622532012:layer:${expectedLayerName}`)) {
      return parseInt(layer.Arn.split(":").at(-1), 10) === expectedLayerVersion;
    }
  }

  if (expectedLayerVersion !== undefined) {
    return false;
  }

  // Check the tracing and logging settings
  const expectedTracingEnabled = config.ddTraceEnabled !== false;
  const expectedLoggingEnabled = config.ddServerlessLogsEnabled !== false;
  if (tracingEnabled !== expectedTracingEnabled) {
    return false;
  }
  if (loggingEnabled !== expectedLoggingEnabled) {
    return false;
  }
  return true;
}
exports.isCorrectlyInstrumented = isCorrectlyInstrumented;

function needsInstrumentationUpdate(
  lambdaFunc,
  config,
  instrumentOutcome,
  emitProcessingLogs,
) {
  const functionName = lambdaFunc.FunctionName;
  const tags = lambdaFunc.Tags;
  const functionArn = lambdaFunc.FunctionArn;
  const isCurrentlyRemotelyInstrumented = isRemotelyInstrumented(lambdaFunc);
  const runtime = lambdaFunc.Runtime;
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
  let isSupportedRuntime = false;
  for (const supportedRuntime of SUPPORTED_RUNTIMES) {
    if (runtime.includes(supportedRuntime)) {
      isSupportedRuntime = true;
      break;
    }
  }
  if (!isSupportedRuntime) {
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
  const tracingEnabled =
    lambdaFunc.Environment?.Variables?.[DD_TRACE_ENABLED] === "true";
  const loggingEnabled =
    lambdaFunc.Environment?.Variables?.[DD_SERVERLESS_LOGS_ENABLED] === "true";
  if (
    isCorrectlyInstrumented({
      layers: layers,
      config: config,
      targetLambdaRuntime: runtime,
      tracingEnabled: tracingEnabled,
      loggingEnabled: loggingEnabled,
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
exports.needsInstrumentationUpdate = needsInstrumentationUpdate;

const waitUntilFunctionIsActive = async (functionName) => {
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

exports.waitUntilFunctionIsActive = waitUntilFunctionIsActive;

function selectFunctionFieldsForLogging(lambdaFunction) {
  return {
    FunctionName: lambdaFunction.FunctionName,
    FunctionArn: lambdaFunction.FunctionArn,
    Tags: Array.from(lambdaFunction.Tags ?? {}),
    Runtime: lambdaFunction.Runtime,
    Layers: lambdaFunction.Layers,
    Architectures: lambdaFunction.Architectures,
  };
}
exports.selectFunctionFieldsForLogging = selectFunctionFieldsForLogging;

async function getFunctionCount(client) {
  const command = new GetAccountSettingsCommand({});
  const response = await client.send(command);
  return response.AccountUsage.FunctionCount;
}
exports.getFunctionCount = getFunctionCount;
