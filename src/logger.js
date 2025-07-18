const {
  LAMBDA_EVENT,
  SCHEDULED_INVOCATION_EVENT,
  PROCESSING,
} = require("./consts");
const LOG_LEVEL = (process.env.DD_LOG_LEVEL || "WARN").toUpperCase();

const LOG_INFO = ["TRACE", "DEBUG", "INFO"].includes(LOG_LEVEL);
const LOG_WARN = ["TRACE", "DEBUG", "INFO", "WARN"].includes(LOG_LEVEL);
const LOG_ERROR = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"].includes(
  LOG_LEVEL,
);

class Logger {
  logInstrumentOutcome({
    ddSlsEventName,
    outcome,
    targetFunctionName = null,
    targetFunctionArn = null,
    expectedExtensionVersion = null,
    runtime = null,
    reason = null,
    reasonCode = null,
  }) {
    console.log(
      JSON.stringify({
        ddSlsEventName,
        outcome,
        targetFunctionName,
        targetFunctionArn,
        expectedExtensionVersion,
        runtime,
        reason,
        reasonCode,
      }),
    );
  }

  // Emit RemoteInstrumentationStarted and RemoteInstrumentationEnded events for the frontend to use to display instrumentation statuses.
  // Used for both lambda management and scheduled instrumentation events.
  emitFrontendStartOrEndEvent(
    ddSlsEventName,
    triggeredBy,
    instrumentOutcome,
    configs,
  ) {
    console.log(
      JSON.stringify({
        ddSlsEventName,
        triggeredBy,
        outcome: instrumentOutcome,
        config: configs.map((config) => {
          return {
            configID: config.configID,
            rcConfigVersion: config.rcConfigVersion,
          };
        }),
      }),
    );
  }

  // Emit 'processing' events for the frontend to use to display instrumentation statuses.
  // Used for lambda management events.
  emitFrontendProcessingEvent(targetFunctionName, message = null) {
    console.log(
      JSON.stringify({
        ddSlsEventName: LAMBDA_EVENT,
        status: PROCESSING,
        targetFunctionName: targetFunctionName,
        message,
      }),
    );
  }

  // Emit an event containing the account state for the frontend.
  // Used for scheduled invocation events.
  async emitFrontendAccountStateEvent({ functionCount }) {
    console.log(
      JSON.stringify({
        ddSlsEventName: SCHEDULED_INVOCATION_EVENT,
        functionCount,
      }),
    );
  }

  logObject(event) {
    if (LOG_INFO) {
      console.log(this.redact(JSON.stringify(event)));
    }
  }

  log(message) {
    if (LOG_INFO) {
      console.log(this.redact("[Datadog Remote Instrumenter] " + message));
    }
  }

  warn(message) {
    if (LOG_WARN) {
      console.warn(this.redact("[Datadog Remote Instrumenter] " + message));
    }
  }

  error(message) {
    if (LOG_ERROR) {
      console.error(this.redact("[Datadog Remote Instrumenter] " + message));
    }
  }

  redact(log) {
    return log
      .replace(
        /"?(DD|DATADOG)_?API_?KEY.*[0-9a-fA-F]{32}"?/i,
        `"DD_API_KEY":"****"`,
      )
      .replace(
        /"?((AWS)?_?ACCESS_?KEY(_ID)?).*[a-zA-Z0-9]{20}"?/i,
        `"AWS_ACCESS_KEY_ID":"****"`,
      )
      .replace(
        /"?(AWS_?SECRET_?ACCESS_?KEY|AMAZON)"?.{0,19}"?[-A-Za-z0-9+/=]{40}"?/i,
        `"AWS_SECRET_ACCESS_KEY":"****"`,
      )
      .replace(/"?AWS_?SESSION_?TOKEN.*,"?/i, `"AWS_SESSION_TOKEN":"****",`);
  }
}
exports.logger = new Logger();
