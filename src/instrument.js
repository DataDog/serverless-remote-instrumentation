const datadogCi = require("@datadog/datadog-ci/dist/cli.js");
const {
  INSTRUMENT,
  PYTHON,
  NODE,
  UNINSTRUMENT,
  IN_PROGRESS,
  SUCCEEDED,
  FAILED,
} = require("./consts");
const { logger } = require("./logger");
const { filterFunctionsToChangeInstrumentation } = require("./functions");
const { tagResourcesWithSlsTag, untagResourcesOfSlsTag } = require("./tag");
const {
  REMOTE_INSTRUMENTATION_STARTED,
  REMOTE_INSTRUMENTATION_ENDED,
} = require("./consts");

function getExtensionAndRuntimeLayerVersion(runtime, config) {
  const result = {
    runtimeLayerVersion: undefined,
    extensionVersion: config.extensionVersion,
  };

  if (runtime.includes(NODE)) {
    result.runtimeLayerVersion = config.nodeLayerVersion;
  } else if (runtime.includes(PYTHON)) {
    result.runtimeLayerVersion = config.pythonLayerVersion;
  }

  return result;
}
exports.getExtensionAndRuntimeLayerVersion = getExtensionAndRuntimeLayerVersion;

async function instrumentWithDatadogCi(
  functionToInstrument,
  instrument,
  config,
  instrumentOutcome,
) {
  const functionName = functionToInstrument.FunctionName;
  const functionArn = functionToInstrument.FunctionArn;
  const runtime = functionToInstrument.Runtime;

  const cli = datadogCi.cli;
  const layerVersionObj = getExtensionAndRuntimeLayerVersion(runtime, config);

  const operationName = instrument ? INSTRUMENT : UNINSTRUMENT;
  const operation = instrument ? "instrument" : "uninstrument";

  // Construct datadog-ci command
  let command = ["lambda", operation, "-f", functionArn];
  if (instrument) {
    if (layerVersionObj.runtimeLayerVersion) {
      command.push("-v", layerVersionObj.runtimeLayerVersion.toString());
    }
    if (layerVersionObj.extensionVersion) {
      command.push("-e", layerVersionObj.extensionVersion.toString());
    }
  } else {
    command.push("-r", config.awsRegion);
  }

  logger.logInstrumentOutcome({
    ddSlsEventName: operationName,
    outcome: IN_PROGRESS,
    targetFunctionName: functionName,
    targetFunctionArn: functionArn,
    expectedExtensionVersion: layerVersionObj.extensionVersion.toString(),
    runtime,
  });
  logger.log(`Sending datadog-ci command: ${JSON.stringify(command)}`);

  const commandExitCode = await cli.run(command);
  const outcome = commandExitCode === 0 ? SUCCEEDED : FAILED;

  logger.logInstrumentOutcome({
    ddSlsEventName: operationName,
    outcome: outcome,
    targetFunctionName: functionName,
    targetFunctionArn: functionArn,
    expectedExtensionVersion: layerVersionObj.extensionVersion.toString(),
    runtime: runtime,
  });
  if (instrument) {
    instrumentOutcome.instrument[outcome][functionName] = { functionArn };
  } else {
    instrumentOutcome.uninstrument[outcome][functionName] = { functionArn };
  }
}
exports.instrumentWithDatadogCi = instrumentWithDatadogCi;

async function instrumentFunctions(
  configs,
  functionsToCheck,
  instrumentOutcome,
  taggingClient,
  triggeredBy,
) {
  logger.emitFrontEndEvent(
    REMOTE_INSTRUMENTATION_STARTED,
    triggeredBy,
    null,
    configs,
  );
  for (const config of configs) {
    let {
      functionsToInstrument,
      functionsToUninstrument,
      functionsToTag,
      functionsToUntag,
    } = filterFunctionsToChangeInstrumentation(
      functionsToCheck,
      config,
      instrumentOutcome,
    );
    logger.log(
      `Functions to instrument: ${functionsToInstrument.map((f) => f.FunctionName)}`,
    );
    logger.log(
      `Functions to uninstrument: ${functionsToUninstrument.map((f) => f.FunctionName)}`,
    );
    logger.log(
      `Functions to tag: ${functionsToTag.map((f) => f.FunctionName)}`,
    );
    logger.log(
      `Functions to untag: ${functionsToUntag.map((f) => f.FunctionName)}`,
    );

    // Instrument and tag the functions that need to be instrumented
    for (const functionToInstrument of functionsToInstrument) {
      await instrumentWithDatadogCi(
        functionToInstrument,
        true,
        config,
        instrumentOutcome,
      );
    }
    await tagResourcesWithSlsTag(
      taggingClient,
      functionsToTag.flatMap((f) =>
        !(f.FunctionName in instrumentOutcome.instrument[FAILED])
          ? f.FunctionArn
          : [],
      ),
    );

    // Uninstrument and untag the functions that need to be uninstrumented
    for (const functionToUninstrument of functionsToUninstrument) {
      await instrumentWithDatadogCi(
        functionToUninstrument,
        false,
        config,
        instrumentOutcome,
      );
    }
    await untagResourcesOfSlsTag(
      taggingClient,
      functionsToTag.flatMap((f) =>
        !(f.FunctionName in instrumentOutcome.uninstrument[FAILED])
          ? f.FunctionArn
          : [],
      ),
    );
  }
  logger.emitFrontEndEvent(
    REMOTE_INSTRUMENTATION_ENDED,
    triggeredBy,
    instrumentOutcome,
    configs,
  );
}
exports.instrumentFunctions = instrumentFunctions;
