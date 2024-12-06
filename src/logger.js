const LAMBDA_EVENT = "LambdaEvent";
exports.LAMBDA_EVENT = LAMBDA_EVENT;

class Logger {
  logInstrumentOutcome(
    ddSlsEventName,
    outcome,
    targetFunctionName = null,
    targetFunctionArn = null,
    expectedExtensionVersion = null,
    runtime = null,
    reason = null,
    reasonCode = null
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
      })
    );
  }

  emitFrontEndEvent(ddSlsEventName, triggeredBy, instrumentOutcome, config) {
    // emit REMOTE_INSTRUMENTATION_STARTED and REMOTE_INSTRUMENTATION_ENDED event
    console.log(
      JSON.stringify({
        ddSlsEventName,
        triggeredBy,
        outcome: instrumentOutcome,
        allowList: config?.AllowList,
        denyList: config?.DenyList,
        tagRule: config?.TagRule,
      })
    );
  }

  frontendLambdaEvents(outcome, targetFunctionName, message = null) {
    // all for LAMBDA_EVENT
    console.log(
      JSON.stringify({
        ddSlsEventName: LAMBDA_EVENT,
        outcome,
        targetFunctionName: targetFunctionName,
        message,
      })
    );
  }

  debugLogs(ddSlsEventName, outcome, targetFunctionName, message = null) {
    console.log(
      JSON.stringify({
        ddSlsEventName,
        outcome,
        targetFunctionName: targetFunctionName,
        message,
      })
    );
  }

  logObject(event) {
    // For logging lambda payload and configs
    console.log(JSON.stringify(event));
  }
}
exports.Logger = Logger;
