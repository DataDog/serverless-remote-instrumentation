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
exports.REMOTE_INSTRUMENTER_FUNCTION = "remote-instrumenter-function";

// Remote instrumentation tag values
exports.VERSION = "1.0.0";
exports.DD_SLS_REMOTE_INSTRUMENTER_VERSION =
  "dd_sls_remote_instrumenter_version";

// Remote config constants
exports.RC_PRODUCT = "SERVERLESS_REMOTE_INSTRUMENTATION";
