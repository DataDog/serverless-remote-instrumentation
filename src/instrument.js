const datadogCi = require("@datadog/datadog-ci/dist/cli.js");
const {
  INSTRUMENT,
  PYTHON,
  NODE,
  UNINSTRUMENT,
  IN_PROGRESS,
  SUCCEEDED,
  FAILED,
  LAMBDA_EVENT,
  CLOUDFORMATION_DELETE_EVENT,
  DATADOG_CI_ERROR,
} = require("./consts");
const { logger } = require("./logger");
const {
  filterFunctionsToChangeInstrumentation,
  isRemotelyInstrumented,
  waitUntilFunctionIsActive,
} = require("./functions");
const { tagResourcesWithSlsTag, untagResourcesOfSlsTag } = require("./tag");
const {
  REMOTE_INSTRUMENTATION_STARTED,
  REMOTE_INSTRUMENTATION_ENDED,
} = require("./consts");
const {
  putApplyState,
  createApplyStateObject,
  deleteApplyState,
} = require("./apply-state");

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
    if (config.ddTraceEnabled !== undefined) {
      command.push("--tracing", config.ddTraceEnabled.toString());
    }
    if (config.ddServerlessLogsEnabled !== undefined) {
      command.push("--logging", config.ddServerlessLogsEnabled.toString());
    }
  } else {
    command.push("-r", config.awsRegion);
  }

  await waitUntilFunctionIsActive(functionName);

  logger.logInstrumentOutcome({
    ddSlsEventName: operationName,
    outcome: IN_PROGRESS,
    targetFunctionName: functionName,
    targetFunctionArn: functionArn,
    expectedExtensionVersion: layerVersionObj.extensionVersion?.toString(),
    runtime,
  });
  logger.log(`Sending datadog-ci command: ${JSON.stringify(command)}`);

  let out = "";
  const commandExitCode = await cli.run(command, {
    // Override stdout to capture the output of the command
    stdout: {
      write: (data) => {
        out += data;
      },
    },
  });

  let outcome = SUCCEEDED;
  let reason, reasonCode;
  if (commandExitCode !== 0) {
    outcome = FAILED;
    reason = out?.split("[Error] ")[1]?.replace(/\n$/, "");
    reasonCode = DATADOG_CI_ERROR;
  }

  logger.logInstrumentOutcome({
    ddSlsEventName: operationName,
    outcome: outcome,
    targetFunctionName: functionName,
    targetFunctionArn: functionArn,
    expectedExtensionVersion: layerVersionObj.extensionVersion?.toString(),
    runtime: runtime,
    reason: reason,
    reasonCode: reasonCode,
  });
  instrumentOutcome[operation][outcome][functionName] = {
    functionArn,
    ...(reason ? { reason } : {}),
    ...(reasonCode ? { reasonCode } : {}),
  };
}
exports.instrumentWithDatadogCi = instrumentWithDatadogCi;

async function instrumentFunctions(
  s3Client,
  configs,
  functionsToCheck,
  instrumentOutcome,
  taggingClient,
  triggeredBy,
) {
  logger.emitFrontendStartOrEndEvent(
    REMOTE_INSTRUMENTATION_STARTED,
    triggeredBy,
    null,
    configs,
  );
  const configApplyStates = [];

  // If there are no configs, uninstrument anything that is remotely instrumented
  if (configs.length === 0) {
    logger.warn(
      `No configs found on '${triggeredBy}' event. Uninstrumenting functions '${functionsToCheck
        .map((f) => f.FunctionName)
        .join(", ")}'`,
    );
    await removeRemoteInstrumentation(
      s3Client,
      functionsToCheck,
      instrumentOutcome,
      taggingClient,
    );
  }

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
      functionsToUntag.flatMap((f) =>
        !(f.FunctionName in instrumentOutcome.uninstrument[FAILED])
          ? f.FunctionArn
          : [],
      ),
    );
    // Add the config apply state to the list
    configApplyStates.push(createApplyStateObject(instrumentOutcome, config));
  }
  // Write the config apply states to S3 or skip for some events
  if (![LAMBDA_EVENT, CLOUDFORMATION_DELETE_EVENT].includes(triggeredBy)) {
    await putApplyState(s3Client, configApplyStates);
  }
  logger.emitFrontendStartOrEndEvent(
    REMOTE_INSTRUMENTATION_ENDED,
    triggeredBy,
    instrumentOutcome,
    configs,
  );
}
exports.instrumentFunctions = instrumentFunctions;

async function removeRemoteInstrumentation(
  s3Client,
  functionsToCheck,
  instrumentOutcome,
  taggingClient,
) {
  const remotelyInstrumentedFunctions = functionsToCheck.filter((lambdaFunc) =>
    isRemotelyInstrumented(lambdaFunc),
  );
  for (const lambdaFunc of remotelyInstrumentedFunctions) {
    await instrumentWithDatadogCi(
      lambdaFunc,
      false,
      { awsRegion: process.env.AWS_REGION },
      instrumentOutcome,
    );
  }
  await untagResourcesOfSlsTag(
    taggingClient,
    remotelyInstrumentedFunctions.flatMap((f) =>
      !(f.FunctionName in instrumentOutcome.uninstrument[FAILED])
        ? f.FunctionArn
        : [],
    ),
  );
  await deleteApplyState(s3Client);
}
exports.removeRemoteInstrumentation = removeRemoteInstrumentation;
