const { LAMBDA_EVENT } = require("./consts");

class Logger {
  logInstrumentOutcome(
    ddSlsEventName,
    outcome,
    targetFunctionName = null,
    targetFunctionArn = null,
    expectedExtensionVersion = null,
    runtime = null,
    reason = null,
    reasonCode = null,
  ) {
    console.log(
      JSON.stringify({
        ddSlsEventName,
        outcome,
        targetFunctionName: targetFunctionName,
        targetFunctionArn: targetFunctionArn,
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
        config: JSON.stringify(configs),
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
    console.log(JSON.stringify(event));
  }
}
exports.logger = new Logger();
