import {
  LAMBDA_EVENT,
  SCHEDULED_INVOCATION_EVENT,
  PROCESSING,
  type InstrumentOutcome,
} from "./consts";
const LOG_LEVEL = (process.env.DD_LOG_LEVEL || "WARN").toUpperCase();

const LOG_INFO = ["TRACE", "DEBUG", "INFO"].includes(LOG_LEVEL);
const LOG_WARN = ["TRACE", "DEBUG", "INFO", "WARN"].includes(LOG_LEVEL);
const LOG_ERROR = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"].includes(
  LOG_LEVEL,
);

interface InstrumentOutcomeParams {
  ddSlsEventName: string;
  outcome: string;
  targetFunctionName?: string | null;
  targetFunctionArn?: string | null;
  expectedExtensionVersion?: string | null;
  runtime?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
}

interface Config {
  configID: string;
  rcConfigVersion: number;
}

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
  }: InstrumentOutcomeParams): void {
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
    ddSlsEventName: string,
    triggeredBy: string,
    instrumentOutcome: InstrumentOutcome | null,
    configs: Config[],
  ): void {
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
  emitFrontendProcessingEvent(
    targetFunctionName: string,
    message: string | null = null,
  ): void {
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
  async emitFrontendAccountStateEvent({
    functionCount,
  }: {
    functionCount: number;
  }): Promise<void> {
    console.log(
      JSON.stringify({
        ddSlsEventName: SCHEDULED_INVOCATION_EVENT,
        functionCount,
      }),
    );
  }

  logObject(event: unknown): void {
    if (LOG_INFO) {
      console.log(this.redact(JSON.stringify(event)));
    }
  }

  log(message: string): void {
    if (LOG_INFO) {
      console.log(this.redact("[Datadog Remote Instrumenter] " + message));
    }
  }

  warn(message: string): void {
    if (LOG_WARN) {
      console.warn(this.redact("[Datadog Remote Instrumenter] " + message));
    }
  }

  error(message: string): void {
    if (LOG_ERROR) {
      console.error(this.redact("[Datadog Remote Instrumenter] " + message));
    }
  }

  redact(log: string): string {
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
export const logger = new Logger();
