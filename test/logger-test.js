const { logger } = require("../src/logger");

describe("redact", () => {
  test.each([
    ["DD_API_KEY:0123456789abcdef0123456789abcdef", true],
    ["DD_API_KEY=0123456789abcdef0123456789abcdef", true],
    [`"DD_API_KEY": "0123456789abcdef0123456789abcdef"`, true],
    [`"DD_API_KEY"="0123456789abcdef0123456789abcdef"`, true],
    ["DATADOG_API_KEY:0123456789abcdef0123456789abcdef", true],
    ["datadogApiKey:0123456789abcdef0123456789abcdef", true],
    ["ddAPIKey:0123456789abcdef0123456789abcdef", true],
    ["DD_API_KEY:2123", false],
    ["DD_API_KEY:0123456789abcdef0123456789^^^&&&", false],
  ])("should mask Datadog API Keys", (testLog, expectToRedact) => {
    const redactedLog = logger.redact(testLog);
    if (expectToRedact) {
      expect(redactedLog).toBe(`"DD_API_KEY":"****"`);
    } else {
      expect(redactedLog).toBe(testLog);
    }
  });
  test.each([
    ["AWS_ACCESS_KEY_ID:AROADBQP57FF2EXAMPLE", true],
    ["AWS_ACCESS_KEY_ID=AROADBQP57FF2EXAMPLE", true],
    [`"AWS_ACCESS_KEY_ID": "AROADBQP57FF2EXAMPLE"`, true],
    [`"AWS_ACCESS_KEY_ID"="AROADBQP57FF2EXAMPLE"`, true],
    ["awsaccesskeyid:AROADBQP57FF2EXAMPLE", true],
    ["awsaccesskey:AROADBQP57FF2EXAMPLE", true],
    ["accesskeyid:AROADBQP57FF2EXAMPLE", true],
    ["AWS_ACCESS_KEY_ID:EXAMPLE", false],
    ["AWS_ACCESS_KEY_ID:AROADBQP57FF2E^^^&&&", false],
  ])("should mask AWS Access Key IDs", (testLog, expectToRedact) => {
    const redactedLog = logger.redact(testLog);
    if (expectToRedact) {
      expect(redactedLog).toBe(`"AWS_ACCESS_KEY_ID":"****"`);
    } else {
      expect(redactedLog).toBe(testLog);
    }
  });
  test.each([
    [
      "AWS_SECRET_ACCESS_KEY: aws wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      true,
    ],
    [
      "AWS_SECRET_ACCESS_KEY= amazon wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      true,
    ],
    ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", true],
    [
      `"AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"`,
      true,
    ],
    [
      `"AWS_SECRET_ACCESS_KEY"="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"`,
      true,
    ],
    ["amazon:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", true],
    ["awssecretaccesskey:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", true],
    ["AWS_SECRET_ACCESS_KEY: aws EXAMPLEKEY", false],
    [
      "AWS_SECRET_ACCESS_KEY: aws wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAM^^^&&&",
      false,
    ],
  ])("should mask AWS Secret Access Key", (testLog, expectToRedact) => {
    const redactedLog = logger.redact(testLog);
    if (expectToRedact) {
      expect(redactedLog).toBe(`"AWS_SECRET_ACCESS_KEY":"****"`);
    } else {
      expect(redactedLog).toBe(testLog);
    }
  });
  test.each([
    ["AWS_SESSION_TOKEN:XYZ//////////ABC123+def/XYZ456+/lmno11111111,", true],
    ["AWS_SESSION_TOKEN=XYZ//////////ABC123+def/XYZ456+/lmno11111111,", true],
    ["AWS_SESSION_TOKEN=XYZ//////////ABC123+def/XYZ456+/lmno11111111,", true],
    [
      `"AWS_SESSION_TOKEN": "XYZ//////////ABC123+def/XYZ456+/lmno11111111,"`,
      true,
    ],
    [
      `"AWS_SESSION_TOKEN"="XYZ//////////ABC123+def/XYZ456+/lmno11111111,"`,
      true,
    ],
    ["awssessiontoken:XYZ//////////ABC123+def/XYZ456+/lmno11111111,", true],
    ["AWS_SESSION_TOKEN:XYZ//////////ABC123+def/XYZ456+/lmno11111111", false],
  ])("should mask AWS Session Token", (testLog, expectToRedact) => {
    const redactedLog = logger.redact(testLog);
    if (expectToRedact) {
      expect(redactedLog).toBe(`"AWS_SESSION_TOKEN":"****",`);
    } else {
      expect(redactedLog).toBe(testLog);
    }
  });
});

describe("log", () => {
  test.each([
    ["TRACE", true],
    ["DEBUG", true],
    ["INFO", true],
    ["WARN", false],
    ["ERROR", false],
    ["trace", true],
    ["debug", true],
    ["info", true],
    ["warn", false],
    ["error", false],
  ])("should log", (logLevel, expectToLog) => {
    process.env.DD_LOG_LEVEL = logLevel;
    // Reload the logger module to pick up the new environment variable
    jest.resetModules();
    const { logger } = require("../src/logger");
    const consoleLogSpy = jest.spyOn(console, "log");
    logger.log("test");
    if (expectToLog) {
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("test"),
      );
    } else {
      expect(consoleLogSpy).not.toHaveBeenCalled();
    }
    consoleLogSpy.mockRestore();
  });
});

describe("warn", () => {
  test.each([
    ["TRACE", true],
    ["DEBUG", true],
    ["INFO", true],
    ["WARN", true],
    ["ERROR", false],
    ["trace", true],
    ["debug", true],
    ["info", true],
    ["warn", true],
    ["error", false],
  ])("should log", (logLevel, expectToLog) => {
    process.env.DD_LOG_LEVEL = logLevel;
    // Reload the logger module to pick up the new environment variable
    jest.resetModules();
    const { logger } = require("../src/logger");
    const consoleLogSpy = jest.spyOn(console, "warn");
    logger.warn("test");
    if (expectToLog) {
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("test"),
      );
    } else {
      expect(consoleLogSpy).not.toHaveBeenCalled();
    }
    consoleLogSpy.mockRestore();
  });
});

describe("error", () => {
  test.each([
    ["TRACE", true],
    ["DEBUG", true],
    ["INFO", true],
    ["WARN", true],
    ["ERROR", true],
    ["trace", true],
    ["debug", true],
    ["info", true],
    ["warn", true],
    ["error", true],
  ])("should log", (logLevel, expectToLog) => {
    process.env.DD_LOG_LEVEL = logLevel;
    // Reload the logger module to pick up the new environment variable
    jest.resetModules();
    const { logger } = require("../src/logger");
    const consoleLogSpy = jest.spyOn(console, "error");
    logger.error("test");
    if (expectToLog) {
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("test"),
      );
    } else {
      expect(consoleLogSpy).not.toHaveBeenCalled();
    }
    consoleLogSpy.mockRestore();
  });
});
