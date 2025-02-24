const { LAMBDA_EVENT } = require("./consts");

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
    console.log(this.redact(JSON.stringify(event)));
  }

  log(message) {
    console.log(this.redact("[Datadog Remote Instrumenter] " + message));
  }

  error(message) {
    console.error(this.redact("[Datadog Remote Instrumenter] " + message));
  }

  redact(log) {
    return log.replace(/"DD_API_KEY":.*,/, `"DD_API_KEY":"****",`);
  }
}
exports.logger = new Logger();
