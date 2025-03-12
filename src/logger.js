const { LAMBDA_EVENT } = require("./consts");
const LOG_LEVEL = process.env.DD_LOG_LEVEL;

const LOG_INFO = ["TRACE", "DEBUG", "INFO"].includes(LOG_LEVEL);
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

  // Emit events for the frontend to use to display instrumentation statuses RemoteInstrumentationStarted and RemoteInstrumentationEnded.
  // Used for both lambda management and scheduled instrumentation events.
  emitFrontEndEvent(ddSlsEventName, triggeredBy, instrumentOutcome, configs) {
    console.log(
      JSON.stringify({
        ddSlsEventName,
        triggeredBy,
        outcome: instrumentOutcome,
        config: configs,
      }),
    );
  }

  // Emit events for the frontend to use to display instrumentation status.
  // Used for lambda management events.
  frontendLambdaEvents(status, targetFunctionName, message = null) {
    console.log(
      JSON.stringify({
        ddSlsEventName: LAMBDA_EVENT,
        status,
        targetFunctionName: targetFunctionName,
        message,
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
