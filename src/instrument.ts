import { getInstrumentedFunctionConfig } from "@datadog/datadog-ci-plugin-lambda/functions/instrument";
import { getUninstrumentedFunctionConfig } from "@datadog/datadog-ci-plugin-lambda/functions/uninstrument";
import { updateLambdaFunctionConfig } from "@datadog/datadog-ci-plugin-lambda/functions/commons";
import { S3Client } from "@aws-sdk/client-s3";
import { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
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
  type LambdaFunction,
  type RuleFilter,
  type InstrumentOutcome,
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
import { getCloudWatchLogsClient, getLambdaClient } from "./aws-resources";

// Types are currently not exported from datadog-ci-plugin-lambda
type DatadogCiFunctionConfiguration = Parameters<
  typeof updateLambdaFunctionConfig
>[2];

interface Config {
  ruleFilters?: RuleFilter[];
  extensionVersion?: number;
  ddTraceEnabled?: boolean;
  ddServerlessLogsEnabled?: boolean;
  awsRegion?: string;
  configID?: string;
  rcConfigVersion?: number;
  instrumenterFunctionName?: string;
  nodeLayerVersion?: number;
  pythonLayerVersion?: number;
  rubyLayerVersion?: number;
  javaLayerVersion?: number;
  dotnetLayerVersion?: number;
  flushMetricsToLogs?: boolean;
  mergeXrayTraces?: boolean;
  [key: string]: unknown;
}

export function getExtensionAndRuntimeLayerVersion(
  runtime: string,
  config: Config,
): {
  runtimeLayerVersion: number | undefined;
  extensionVersion: number | undefined;
} {
  const result: {
    runtimeLayerVersion: number | undefined;
    extensionVersion: number | undefined;
  } = {
    runtimeLayerVersion: undefined,
    extensionVersion: config.extensionVersion,
  };

  const runtimeConfig = getRuntimeConfig(runtime);
  if (runtimeConfig?.configField) {
    result.runtimeLayerVersion = config[runtimeConfig.configField] as
      | number
      | undefined;
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

  const { extensionVersion, runtimeLayerVersion } =
    getExtensionAndRuntimeLayerVersion(runtime ?? "", config);

  const operationName = instrument ? INSTRUMENT : UNINSTRUMENT;
  const operation = instrument ? "instrument" : "uninstrument";

  logger.logInstrumentOutcome({
    ddSlsEventName: operationName,
    outcome: IN_PROGRESS,
    targetFunctionName: functionName,
    targetFunctionArn: functionArn,
    expectedExtensionVersion: extensionVersion?.toString(),
    runtime,
  });

  const lambdaClient = getLambdaClient();
  const cloudWatchLogsClient = getCloudWatchLogsClient();

  let outcome = SUCCEEDED;
  let reason, reasonCode;

  try {
    // Wait inside the try so that a failure here (e.g. a throttle or
    // ResourceNotFound from the GetFunctionConfiguration poll) is recorded as a
    // per-function FAILED outcome rather than rejecting the surrounding
    // Promise.all and taking down the rest of the batch.
    await waitUntilFunctionIsActive(functionName);

    let functionConfig: DatadogCiFunctionConfiguration;

    if (instrument) {
      const settings = {
        ...config,
        loggingEnabled: config.ddServerlessLogsEnabled,
        flushMetricsToLogs: config.flushMetricsToLogs !== false,
        tracingEnabled: config.ddTraceEnabled !== false,
        mergeXrayTraces: config.mergeXrayTraces !== false,
        extensionVersion: (extensionVersion ?? "none") as
          | number
          | "latest"
          | "none",
        layerVersion: (runtimeLayerVersion ?? "none") as
          | number
          | "latest"
          | "none",
      };
      functionConfig = await getInstrumentedFunctionConfig(
        lambdaClient,
        cloudWatchLogsClient,
        functionToInstrument,
        process.env.AWS_REGION!,
        settings,
      );
    } else {
      functionConfig = await getUninstrumentedFunctionConfig(
        lambdaClient,
        cloudWatchLogsClient,
        functionToInstrument,
        undefined, // forwarderARN
      );
    }

    await updateLambdaFunctionConfig(
      lambdaClient,
      cloudWatchLogsClient,
      functionConfig,
    );
  } catch (error) {
    outcome = FAILED;
    reason = error instanceof Error ? error.message : String(error);
    reasonCode = DATADOG_CI_ERROR;
  }

  logger.logInstrumentOutcome({
    ddSlsEventName: operationName,
    outcome: outcome,
    targetFunctionName: functionName,
    targetFunctionArn: functionArn,
    expectedExtensionVersion: extensionVersion?.toString(),
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

export async function instrumentFunctions(
  s3Client: S3Client,
  configs: RcConfig[],
  functionsToCheck: LambdaFunction[],
  instrumentOutcome: InstrumentOutcome,
  taggingClient: ResourceGroupsTaggingAPIClient,
  triggeredBy?: string,
  edgeFunctionNames?: Set<string>,
): Promise<void> {
  logger.emitFrontendStartOrEndEvent(
    REMOTE_INSTRUMENTATION_STARTED,
    triggeredBy ?? "",
    null,
    configs,
  );
  const configApplyStates: ReturnType<typeof createApplyStateObject>[] = [];

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
        edgeFunctionNames,
      );
    logger.log(
      `Functions to instrument: ${functionsToInstrumentOrTag.map((f) => f.FunctionName)}`,
    );
    logger.log(
      `Functions to uninstrument: ${functionsToUninstrumentOrUntag.map((f) => f.FunctionName)}`,
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
        functionsToTagInBatch.map((f) => f.FunctionArn!),
      );

      // Then, instrument all functions in this batch that need instrumentation.
      // Functions within a batch are processed concurrently; the batch size
      // bounds how many Lambda API calls are in flight at once.
      const functionsToInstrumentInBatch = batch.filter(
        (func) => func.needsInstrumentation,
      );
      await Promise.all(
        functionsToInstrumentInBatch.map((functionToInstrument) =>
          instrumentWithDatadogCi(
            functionToInstrument,
            true,
            config,
            instrumentOutcome,
          ),
        ),
      );
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

      // First, uninstrument all functions in this batch that need
      // uninstrumentation. Functions within a batch are processed concurrently.
      const functionsToUninstrumentInBatch = batch.filter(
        (func) => func.needsUninstrumentation,
      );
      await Promise.all(
        functionsToUninstrumentInBatch.map((functionToUninstrument) =>
          instrumentWithDatadogCi(
            functionToUninstrument,
            false,
            config,
            instrumentOutcome,
          ),
        ),
      );

      // Then, untag all functions in this batch that need untagging (but only if uninstrumentation didn't fail)
      const functionsToUntagInBatch = batch.filter(
        (func) =>
          func.needsUntagging &&
          !(func.FunctionName in instrumentOutcome.uninstrument[FAILED]),
      );

      await untagResourcesOfSlsTag(
        taggingClient,
        functionsToUntagInBatch.map((f) => f.FunctionArn!),
      );
    }
    // Add the config apply state to the list
    configApplyStates.push(createApplyStateObject(instrumentOutcome, config));
  }
  // Write the config apply states to S3 or skip for some events
  if (
    triggeredBy &&
    ![LAMBDA_EVENT, CLOUDFORMATION_DELETE_EVENT].includes(triggeredBy)
  ) {
    await putApplyState(s3Client, configApplyStates);
  }
  logger.emitFrontendStartOrEndEvent(
    REMOTE_INSTRUMENTATION_ENDED,
    triggeredBy ?? "",
    instrumentOutcome,
    configs,
  );
}

export async function removeRemoteInstrumentation(
  s3Client: S3Client,
  functionsToCheck: LambdaFunction[],
  instrumentOutcome: InstrumentOutcome,
  taggingClient: ResourceGroupsTaggingAPIClient,
): Promise<void> {
  const remotelyInstrumentedFunctions = functionsToCheck.filter((lambdaFunc) =>
    isRemotelyInstrumented(lambdaFunc),
  );
  for (const lambdaFunc of remotelyInstrumentedFunctions) {
    await instrumentWithDatadogCi(
      lambdaFunc,
      false,
      { awsRegion: process.env.AWS_REGION } as Config,
      instrumentOutcome,
    );
  }
  await untagResourcesOfSlsTag(
    taggingClient,
    remotelyInstrumentedFunctions.flatMap((f) =>
      !(f.FunctionName in instrumentOutcome.uninstrument[FAILED])
        ? [f.FunctionArn!]
        : [],
    ),
  );
  await deleteApplyState(s3Client);
}
