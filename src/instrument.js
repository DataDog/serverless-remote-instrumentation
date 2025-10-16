const { Cli } = require("clipanion");
const {
  InstrumentCommand,
} = require("@datadog/datadog-ci-base/commands/lambda/instrument");
const {
  UninstrumentCommand,
} = require("@datadog/datadog-ci-base/commands/lambda/uninstrument");
const {
  INSTRUMENT,
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
  getRuntimeConfig,
} = require("./consts");
const {
  putApplyState,
  createApplyStateObject,
  deleteApplyState,
} = require("./apply-state");

// Create a CLI instance with the instrument and uninstrument commands
const cli = new Cli({
  binaryName: "datadog-ci",
});
cli.register(InstrumentCommand);
cli.register(UninstrumentCommand);
exports.cli = cli;

function getExtensionAndRuntimeLayerVersion(runtime, config) {
  const result = {
    runtimeLayerVersion: undefined,
    extensionVersion: config.extensionVersion,
  };

  const runtimeConfig = getRuntimeConfig(runtime);
  if (runtimeConfig) {
    result.runtimeLayerVersion = config[runtimeConfig.configField];
  }

  return result;
}
exports.getExtensionAndRuntimeLayerVersion = getExtensionAndRuntimeLayerVersion;

function createFunctionBatches(functions, batchSize = 50) {
  const batches = [];
  for (let i = 0; i < functions.length; i += batchSize) {
    batches.push(functions.slice(i, i + batchSize));
  }
  return batches;
}
exports.createFunctionBatches = createFunctionBatches;

async function instrumentWithDatadogCi(
  functionToInstrument,
  instrument,
  config,
  instrumentOutcome,
) {
  const functionName = functionToInstrument.FunctionName;
  const functionArn = functionToInstrument.FunctionArn;
  const runtime = functionToInstrument.Runtime;

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
    const { functionsToInstrumentOrTag, functionsToUninstrumentOrUntag } =
      filterFunctionsToChangeInstrumentation(
        functionsToCheck,
        config,
        instrumentOutcome,
      );
    logger.log(
      `Functions to instrument: ${functionsToInstrumentOrTag.map((f) => f.FunctionName)}`,
    );
    logger.log(
      `Functions to uninstrument: ${functionsToUninstrumentOrUntag.map((f) => f.FunctionName)}`,
    );
    const batchSize = 50;
    const batches = createFunctionBatches(
      functionsToInstrumentOrTag,
      batchSize,
    );
    logger.log(
      `Processing ${functionsToInstrumentOrTag.length} functions in ${batches.length} batches of ${batchSize}`,
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.log(
        `Processing batch ${i + 1}/${batches.length} with ${batch.length} functions`,
      );

      // First, tag all functions in this batch that need tagging
      const functionsToTagInBatch = batch.filter((func) => func.needsTagging);

      await tagResourcesWithSlsTag(
        taggingClient,
        functionsToTagInBatch.map((f) => f.FunctionArn),
      );

      // Then, instrument all functions in this batch that need instrumentation
      const functionsToInstrumentInBatch = batch.filter(
        (func) => func.needsInstrumentation,
      );
      for (const functionToInstrument of functionsToInstrumentInBatch) {
        await instrumentWithDatadogCi(
          functionToInstrument,
          true,
          config,
          instrumentOutcome,
        );
      }
    }

    const unprocessBatches = createFunctionBatches(
      functionsToUninstrumentOrUntag,
    );
    logger.log(
      `Unprocessing ${functionsToUninstrumentOrUntag.length} functions in ${unprocessBatches.length} batches of 20`,
    );

    for (let i = 0; i < unprocessBatches.length; i++) {
      const batch = unprocessBatches[i];
      logger.log(
        `Unprocessing batch ${i + 1}/${unprocessBatches.length} with ${batch.length} functions`,
      );

      // First, uninstrument all functions in this batch that need uninstrumentation
      const functionsToUninstrumentInBatch = batch.filter(
        (func) => func.needsUninstrumentation,
      );
      for (const functionToUninstrument of functionsToUninstrumentInBatch) {
        await instrumentWithDatadogCi(
          functionToUninstrument,
          false,
          config,
          instrumentOutcome,
        );
      }

      // Then, untag all functions in this batch that need untagging (but only if uninstrumentation didn't fail)
      const functionsToUntagInBatch = batch.filter(
        (func) =>
          func.needsUntagging &&
          !(func.FunctionName in instrumentOutcome.uninstrument[FAILED]),
      );

      await untagResourcesOfSlsTag(
        taggingClient,
        functionsToUntagInBatch.map((f) => f.FunctionArn),
      );
    }
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
