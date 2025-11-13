import { Cli } from "clipanion";
import { InstrumentCommand } from "@datadog/datadog-ci-base/commands/lambda/instrument";
import { UninstrumentCommand } from "@datadog/datadog-ci-base/commands/lambda/uninstrument";
import {
  INSTRUMENT,
  UNINSTRUMENT,
  IN_PROGRESS,
  SUCCEEDED,
  FAILED,
  LAMBDA_EVENT,
  CLOUDFORMATION_DELETE_EVENT,
  DATADOG_CI_ERROR,
  REMOTE_INSTRUMENTATION_STARTED,
  REMOTE_INSTRUMENTATION_ENDED,
  getRuntimeConfig,
} from "./consts";
import { RcConfig } from "./config";
import { logger } from "./logger";
import {
  filterFunctionsToChangeInstrumentation,
  isRemotelyInstrumented,
  waitUntilFunctionIsActive,
} from "./functions";
import { tagResourcesWithSlsTag, untagResourcesOfSlsTag } from "./tag";
import {
  putApplyState,
  createApplyStateObject,
  deleteApplyState,
} from "./apply-state";

interface LayerVersionObj {
  runtimeLayerVersion?: number;
  extensionVersion?: number;
}

interface LambdaFunction {
  FunctionName: string;
  FunctionArn: string;
  Runtime: string;
  needsInstrumentation?: boolean;
  needsTagging?: boolean;
  needsUninstrumentation?: boolean;
  needsUntagging?: boolean;
}

interface Config {
  ruleFilters?: any[];
  extensionVersion?: number;
  ddTraceEnabled?: boolean;
  ddServerlessLogsEnabled?: boolean;
  awsRegion?: string;
  configID?: string;
  rcConfigVersion?: number;
  [key: string]: any;
}

interface InstrumentOutcome {
  instrument: {
    succeeded: Record<string, any>;
    failed: Record<string, any>;
    skipped: Record<string, any>;
  };
  uninstrument: {
    succeeded: Record<string, any>;
    failed: Record<string, any>;
    skipped: Record<string, any>;
  };
}

// Create a CLI instance with the instrument and uninstrument commands
export const cli = new Cli({
  binaryName: "datadog-ci",
});
cli.register(InstrumentCommand);
cli.register(UninstrumentCommand);

export function getExtensionAndRuntimeLayerVersion(
  runtime: string,
  config: Config,
): LayerVersionObj {
  const result: LayerVersionObj = {
    runtimeLayerVersion: undefined,
    extensionVersion: config.extensionVersion,
  };

  const runtimeConfig = getRuntimeConfig(runtime);
  if (runtimeConfig) {
    result.runtimeLayerVersion = config[runtimeConfig.configField];
  }

  return result;
}

export function createFunctionBatches(
  functions: LambdaFunction[],
  batchSize = 50,
): LambdaFunction[][] {
  const batches: LambdaFunction[][] = [];
  for (let i = 0; i < functions.length; i += batchSize) {
    batches.push(functions.slice(i, i + batchSize));
  }
  return batches;
}

export async function instrumentWithDatadogCi(
  functionToInstrument: LambdaFunction,
  instrument: boolean,
  config: Config,
  instrumentOutcome: InstrumentOutcome,
): Promise<void> {
  const functionName = functionToInstrument.FunctionName;
  const functionArn = functionToInstrument.FunctionArn;
  const runtime = functionToInstrument.Runtime;

  const layerVersionObj = getExtensionAndRuntimeLayerVersion(runtime, config);

  const operationName = instrument ? INSTRUMENT : UNINSTRUMENT;
  const operation = instrument ? "instrument" : "uninstrument";

  // Construct datadog-ci command
  let command: any[] = ["lambda", operation, "-f", functionArn];
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
      write: (data: string) => {
        out += data;
      },
    },
  } as any);

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
  (instrumentOutcome as any)[operation][outcome][functionName] = {
    functionArn,
    ...(reason ? { reason } : {}),
    ...(reasonCode ? { reasonCode } : {}),
  };
}

export async function instrumentFunctions(
  s3Client: any,
  configs: RcConfig[],
  functionsToCheck: LambdaFunction[],
  instrumentOutcome: InstrumentOutcome,
  taggingClient: any,
  triggeredBy: string,
): Promise<void> {
  logger.emitFrontendStartOrEndEvent(
    REMOTE_INSTRUMENTATION_STARTED,
    triggeredBy,
    null as any,
    configs,
  );
  const configApplyStates: any[] = [];

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
      `Functions to instrument: ${functionsToInstrumentOrTag.map((f: any) => f.FunctionName)}`,
    );
    logger.log(
      `Functions to uninstrument: ${functionsToUninstrumentOrUntag.map((f: any) => f.FunctionName)}`,
    );
    const batchSize = 50;
    const instrumentBatches = createFunctionBatches(
      functionsToInstrumentOrTag,
      batchSize,
    );
    logger.log(
      `Instrumenting ${functionsToInstrumentOrTag.length} functions in ${instrumentBatches.length} batches of ${batchSize}`,
    );

    for (let i = 0; i < instrumentBatches.length; i++) {
      const batch = instrumentBatches[i];
      logger.log(
        `Instrumenting batch ${i + 1}/${instrumentBatches.length} with ${batch.length} functions`,
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

    const uninstrumentBatches = createFunctionBatches(
      functionsToUninstrumentOrUntag,
    );
    logger.log(
      `Uninstrumenting ${functionsToUninstrumentOrUntag.length} functions in ${uninstrumentBatches.length} batches of 20`,
    );

    for (let i = 0; i < uninstrumentBatches.length; i++) {
      const batch = uninstrumentBatches[i];
      logger.log(
        `Uninstrumenting batch ${i + 1}/${uninstrumentBatches.length} with ${batch.length} functions`,
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
        (func: any) =>
          func.needsUntagging &&
          !(
            func.FunctionName in (instrumentOutcome.uninstrument as any)[FAILED]
          ),
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
    instrumentOutcome as any,
    configs,
  );
}

export async function removeRemoteInstrumentation(
  s3Client: any,
  functionsToCheck: LambdaFunction[],
  instrumentOutcome: InstrumentOutcome,
  taggingClient: any,
): Promise<void> {
  const remotelyInstrumentedFunctions = functionsToCheck.filter((lambdaFunc) =>
    isRemotelyInstrumented(lambdaFunc),
  );
  for (const lambdaFunc of remotelyInstrumentedFunctions) {
    await instrumentWithDatadogCi(
      lambdaFunc,
      false,
      { awsRegion: process.env.AWS_REGION } as any,
      instrumentOutcome,
    );
  }
  await untagResourcesOfSlsTag(
    taggingClient,
    remotelyInstrumentedFunctions.flatMap((f: any) =>
      !(f.FunctionName in (instrumentOutcome.uninstrument as any)[FAILED])
        ? f.FunctionArn
        : [],
    ),
  );
  await deleteApplyState(s3Client);
}
