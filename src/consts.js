// Runtimes
const NODE = "node";
exports.NODE = NODE;
const PYTHON = "python";
exports.PYTHON = PYTHON;
exports.SUPPORTED_RUNTIMES = [NODE, PYTHON];

// Event Types
exports.LAMBDA_EVENT = "LambdaEvent";
exports.SCHEDULED_INVOCATION_EVENT = "ScheduledInvocationEvent";

// Config Enums
exports.ENTITY_TYPES = new Set(["lambda"]);
const TAG = "tag";
exports.TAG = TAG;
const FUNCTION_NAME = "function_name";
exports.FUNCTION_NAME = FUNCTION_NAME;
exports.FILTER_TYPES = new Set([TAG, FUNCTION_NAME]);

// Operation Names
exports.INSTRUMENT = "Instrument";
exports.UNINSTRUMENT = "Uninstrument";

// Instrumentation statuses and outcomes
exports.REMOTE_INSTRUMENTATION_STARTED = "RemoteInstrumentationStarted";
exports.REMOTE_INSTRUMENTATION_ENDED = "RemoteInstrumentationEnded";
exports.FAILED = "failed";
exports.SUCCEEDED = "succeeded";
exports.IN_PROGRESS = "in_progress";
exports.PROCESSING = "processing";
exports.SKIPPED = "skipped";

// Instrumentation skipped reasons
exports.INSUFFICIENT_MEMORY = "insufficient-memory";
exports.ALREADY_CORRECT_EXTENSION_AND_LAYER =
  "already-correct-extension-and-layer";
exports.UNSUPPORTED_RUNTIME = "unsupported-runtime";
exports.NOT_SATISFYING_TARGETING_RULES = "not-satisfying-targeting-rules";
exports.ALREADY_MANUALLY_INSTRUMENTED = "already-manually-instrumented";
exports.REMOTE_INSTRUMENTER_FUNCTION = "remote-instrumenter-function";

// Remote instrumentation tag values
exports.VERSION = "1.0.0";
exports.DD_SLS_REMOTE_INSTRUMENTER_VERSION =
  "dd_sls_remote_instrumenter_version";
exports.DD_API_KEY = "DD_API_KEY";
exports.DD_SITE = "DD_SITE";

// Remote config constants
exports.RC_PRODUCT = "SERVERLESS_REMOTE_INSTRUMENTATION";
exports.RC_ACKNOWLEDGED = 2;
exports.RC_ERROR = 3;
exports.REMOTE_CONFIG_URL = "http://localhost:8126/v0.7/config";
exports.CONFIG_HASH_KEY = "datadog_remote_instrumentation_config.txt";
exports.APPLY_STATE_KEY = "apply_state.json";
