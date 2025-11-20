import { FunctionConfiguration } from "@aws-sdk/client-lambda";

// Runtimes
export const NODE = "node";
export const PYTHON = "python";
const RUBY = "ruby";
exports.RUBY = RUBY;
const JAVA = "java";
exports.JAVA = JAVA;
const DOTNET = "dotnet";
exports.DOTNET = DOTNET;
const PROVIDED_AL2 = "provided.al2";
exports.PROVIDED_AL2 = PROVIDED_AL2;
const PROVIDED_AL2023 = "provided.al2023";
exports.PROVIDED_AL2023 = PROVIDED_AL2023;

interface RuntimeConfiguration {
  layerName?: string;
  configField?: string;
  getFromJsonConfig: (configJSON: any) => any;
  isSupportedRuntime: (runtime: string) => boolean;
}

export const SUPPORTED_RUNTIME_CONFIGURATIONS: Record<
  string,
  RuntimeConfiguration
> = {
  [NODE]: {
    layerName: "Datadog-Node",
    configField: "nodeLayerVersion",
    getFromJsonConfig: (configJSON: any) =>
      configJSON.instrumentation_settings?.node_layer_version,
    isSupportedRuntime: (runtime: string) =>
      runtime.toLowerCase().includes(NODE),
  },
  [PYTHON]: {
    layerName: "Datadog-Python",
    configField: "pythonLayerVersion",
    getFromJsonConfig: (configJSON: any) =>
      configJSON.instrumentation_settings?.python_layer_version,
    isSupportedRuntime: (runtime: string) =>
      runtime.toLowerCase().includes(PYTHON),
  },
  [RUBY]: {
    layerName: "Datadog-Ruby",
    configField: "rubyLayerVersion",
    getFromJsonConfig: (configJSON: any) =>
      configJSON.instrumentation_settings?.ruby_layer_version,
    isSupportedRuntime: (runtime: string) => runtime.toLowerCase().includes(RUBY),
  },
  [JAVA]: {
    layerName: "dd-trace-java",
    configField: "javaLayerVersion",
    getFromJsonConfig: (configJSON: any) =>
      configJSON.instrumentation_settings?.java_layer_version,
    isSupportedRuntime: (runtime: string) => runtime.toLowerCase().includes(JAVA),
  },
  [DOTNET]: {
    layerName: "dd-trace-dotnet",
    configField: "dotnetLayerVersion",
    getFromJsonConfig: (configJSON: any) =>
      configJSON.instrumentation_settings?.dotnet_layer_version,
    isSupportedRuntime: (runtime: string) => runtime.toLowerCase().includes(DOTNET),
  },
  [PROVIDED_AL2]: {
    getFromJsonConfig: () => undefined,
    isSupportedRuntime: (runtime: string) =>
      runtime.toLowerCase().includes(PROVIDED_AL2),
  },
  [PROVIDED_AL2023]: {
    getFromJsonConfig: () => undefined,
    isSupportedRuntime: (runtime: string) =>
      runtime.toLowerCase().includes(PROVIDED_AL2023),
  },
};

export const getRuntimeConfig = (
  runtime: string,
): RuntimeConfiguration | undefined =>
  Object.entries(SUPPORTED_RUNTIME_CONFIGURATIONS).find(([, config]) =>
    config.isSupportedRuntime(runtime),
  )?.[1];

// Event Types
export const LAMBDA_EVENT = "LambdaEvent";
export const SCHEDULED_INVOCATION_EVENT = "ScheduledInvocationEvent";
export const CLOUDFORMATION_CREATE_EVENT = "CloudformationCreateEvent";
export const CLOUDFORMATION_DELETE_EVENT = "CloudformationDeleteEvent";

// Config Enums
export const ENTITY_TYPES = new Set(["lambda"]);
export const TAG = "tag";
export const FUNCTION_NAME = "function_name";
export const FILTER_TYPES = new Set([TAG, FUNCTION_NAME]);

// Operation Names
export const INSTRUMENT = "Instrument";
export const UNINSTRUMENT = "Uninstrument";

// Instrumentation statuses and outcomes
export const REMOTE_INSTRUMENTATION_STARTED = "RemoteInstrumentationStarted";
export const REMOTE_INSTRUMENTATION_ENDED = "RemoteInstrumentationEnded";
export const FAILED = "failed";
export const SUCCEEDED = "succeeded";
export const IN_PROGRESS = "in_progress";
export const PROCESSING = "processing";
export const SKIPPED = "skipped";

// Instrumentation skipped reasons
export const ALREADY_CORRECT_EXTENSION_AND_LAYER =
  "already-correct-extension-and-layer";
export const UNSUPPORTED_RUNTIME = "unsupported-runtime";
export const NOT_SATISFYING_TARGETING_RULES = "not-satisfying-targeting-rules";
export const ALREADY_MANUALLY_INSTRUMENTED = "already-manually-instrumented";
export const REMOTE_INSTRUMENTER_FUNCTION = "remote-instrumenter-function";
export const FUNCTION_NOT_FOUND = "function-not-found";
export const DATADOG_CI_ERROR = "datadog-ci-error";

// Remote instrumentation tag values and environment variable key names
export const VERSION = process.env.DD_INSTRUMENTER_VERSION;
export const DD_SLS_REMOTE_INSTRUMENTER_VERSION =
  "dd_sls_remote_instrumenter_version";
export const DD_TRACE_ENABLED = "DD_TRACE_ENABLED";
export const DD_SERVERLESS_LOGS_ENABLED = "DD_SERVERLESS_LOGS_ENABLED";
export const DD_API_KEY = "DD_API_KEY";
export const DD_KMS_API_KEY = "DD_KMS_API_KEY";
export const DD_API_KEY_SECRET_ARN = "DD_API_KEY_SECRET_ARN";
export const DD_SITE = "DD_SITE";

// Remote config constants
export const RC_PRODUCT = "SERVERLESS_REMOTE_INSTRUMENTATION";
export const RC_ACKNOWLEDGED = 2;
export const RC_ERROR = 3;
export const REMOTE_CONFIG_URL = "http://localhost:8126/v0.7/config";
export const CONFIG_HASH_KEY = "datadog_remote_instrumentation_config.txt";
export const APPLY_STATE_KEY = "apply_state.json";
export const CONFIG_STATUS_EXPIRED = 1;
export const CONFIG_STATUS_OK = 0;

// Config cache constants
export const CONFIG_CACHE_TTL_MS = 6000;

export interface LambdaFunction extends FunctionConfiguration {
  FunctionName: string;
  Tags?: Set<string>;
  needsInstrumentation?: boolean;
  needsUninstrumentation?: boolean;
  needsTagging?: boolean;
  needsUntagging?: boolean;
}
