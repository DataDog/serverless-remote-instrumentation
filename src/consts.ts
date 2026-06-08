import { FunctionConfiguration } from "@aws-sdk/client-lambda";

// Runtimes
export const NODE = "node";
export const PYTHON = "python";
export const RUBY = "ruby";
export const JAVA = "java";
export const DOTNET = "dotnet";
export const PROVIDED_AL2 = "provided.al2";
export const PROVIDED_AL2023 = "provided.al2023";

export interface ConfigJSON {
  config_version: number;
  entity_type: string;
  instrumentation_settings?: {
    node_layer_version?: number;
    python_layer_version?: number;
    ruby_layer_version?: number;
    java_layer_version?: number;
    dotnet_layer_version?: number;
    extension_version?: number;
    dd_trace_enabled?: boolean;
    dd_serverless_logs_enabled?: boolean;
  };
  priority: number;
  rule_filters: Array<{
    key: string;
    values: string[];
    allow: boolean;
    filter_type: string;
  }>;
}

export interface InstrumentationResult {
  functionArn?: string;
  reason?: string;
  reasonCode?: string;
}

export interface InstrumentOutcomeEntry {
  succeeded: Record<string, InstrumentationResult>;
  failed: Record<string, InstrumentationResult>;
  skipped: Record<string, InstrumentationResult>;
  [key: string]: Record<string, InstrumentationResult>;
}

export interface InstrumentOutcome {
  instrument: InstrumentOutcomeEntry;
  uninstrument: InstrumentOutcomeEntry;
  [key: string]: InstrumentOutcomeEntry;
}

interface RuntimeConfiguration {
  layerName?: string;
  configField?: string;
  getFromJsonConfig: (configJSON: ConfigJSON) => number | undefined;
  isSupportedRuntime: (runtime: string) => boolean;
}

export const SUPPORTED_RUNTIME_CONFIGURATIONS: Record<
  string,
  RuntimeConfiguration
> = {
  [NODE]: {
    layerName: "Datadog-Node",
    configField: "nodeLayerVersion",
    getFromJsonConfig: (configJSON) =>
      configJSON.instrumentation_settings?.node_layer_version,
    isSupportedRuntime: (runtime: string) =>
      runtime.toLowerCase().includes(NODE),
  },
  [PYTHON]: {
    layerName: "Datadog-Python",
    configField: "pythonLayerVersion",
    getFromJsonConfig: (configJSON) =>
      configJSON.instrumentation_settings?.python_layer_version,
    isSupportedRuntime: (runtime: string) =>
      runtime.toLowerCase().includes(PYTHON),
  },
  [RUBY]: {
    layerName: "Datadog-Ruby",
    configField: "rubyLayerVersion",
    getFromJsonConfig: (configJSON) =>
      configJSON.instrumentation_settings?.ruby_layer_version,
    isSupportedRuntime: (runtime: string) =>
      runtime.toLowerCase().includes(RUBY),
  },
  [JAVA]: {
    layerName: "dd-trace-java",
    configField: "javaLayerVersion",
    getFromJsonConfig: (configJSON) =>
      configJSON.instrumentation_settings?.java_layer_version,
    isSupportedRuntime: (runtime: string) =>
      runtime.toLowerCase().includes(JAVA),
  },
  [DOTNET]: {
    layerName: "dd-trace-dotnet",
    configField: "dotnetLayerVersion",
    getFromJsonConfig: (configJSON) =>
      configJSON.instrumentation_settings?.dotnet_layer_version,
    isSupportedRuntime: (runtime: string) =>
      runtime.toLowerCase().includes(DOTNET),
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
export const DD_API_KEY_SSM_ARN = "DD_API_KEY_SSM_ARN";
export const DD_SITE = "DD_SITE";
export const DD_INTERNAL_SEND_DEBUG_INFORMATION =
  "DD_INTERNAL_SEND_DEBUG_INFORMATION";
export const INSTRUMENTATION_LATENCY_METRIC =
  "datadog.remote_instrumenter.lambda_management_event.instrumentation_latency";

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

export interface RuleFilter {
  key: string;
  values: string[];
  allow: boolean;
  filterType: string;
}

/**
 * A Lambda function before tag enrichment. Tags may be a Record<string, string>
 * from the AWS SDK's GetFunctionCommandOutput, or undefined.
 */
export type UnenrichedLambdaFunction = FunctionConfiguration & {
  Tags?: Record<string, string>;
};

export interface LambdaFunction extends FunctionConfiguration {
  FunctionName: string;
  Tags?: Set<string>;
  needsInstrumentation?: boolean;
  needsUninstrumentation?: boolean;
  needsTagging?: boolean;
  needsUntagging?: boolean;
}
