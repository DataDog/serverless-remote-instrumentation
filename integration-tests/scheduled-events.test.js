const { pollUntilTrue } = require("./utilities/poll-until-true");
const {
  isFunctionInstrumented,
  isFunctionUninstrumented,
} = require("./utilities/is-function-instrumented");
const {
  setRemoteConfig,
  clearKnownRemoteConfigs,
  clearRemoteConfigs,
} = require("./utilities/remote-config");
const {
  invokeLambdaWithScheduledEvent,
} = require("./utilities/remote-instrumenter-invocations");
const {
  createFunction,
  deleteTestFunctions,
  createFunctions,
} = require("./utilities/lambda-functions");
const { Runtime } = require("@aws-sdk/client-lambda");
const {
  deleteErrorObject,
  putErrorObject,
  doesErrorObjectExist,
} = require("./utilities/s3-error-object");

describe("Remote instrumenter scheduled event tests", () => {
  const functionThatDoesntExist = "ThisDoesNotExist";

  afterAll(async () => {
    await deleteErrorObject(functionThatDoesntExist);
    await clearRemoteConfigs();
  });

  afterEach(async () => {
    await deleteTestFunctions();
  });

  beforeEach(async () => {
    await clearKnownRemoteConfigs();
  });

  beforeAll(async () => {
    await clearRemoteConfigs();
  });

  it("function with different tags does NOT get instrumented", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "baz" },
    });
    await setRemoteConfig();

    const res = await invokeLambdaWithScheduledEvent();

    expect(Object.keys(res.instrument.skipped)).toEqual(
      expect.arrayContaining([functionName]),
    );
    expect(res.instrument.skipped[functionName].reasonCode).toStrictEqual(
      "not-satisfying-targeting-rules",
    );

    const isUninstrumented = await isFunctionUninstrumented(functionName);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("manually instrumented function does NOT get instrumented", async () => {
    await setRemoteConfig();
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
      Environment: {
        Variables: {
          DD_API_KEY: "a",
          DD_SITE: "b",
        },
      },
    });

    const res = await invokeLambdaWithScheduledEvent();

    expect(Object.keys(res.instrument.skipped)).toEqual(
      expect.arrayContaining([functionName]),
    );
    expect(res.instrument.skipped[functionName].reasonCode).toStrictEqual(
      "already-manually-instrumented",
    );
  });

  it("function with correct tags does get instrumented", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });
    await setRemoteConfig();

    const res = await invokeLambdaWithScheduledEvent();
    // Very rarely the instrumenter can run in between setting the config and running the lambda
    expect(
      Object.keys(res.instrument.succeeded).concat(
        Object.keys(res.instrument.skipped),
      ),
    ).toEqual(expect.arrayContaining([functionName]));

    // If it was skipped, it should have the reason that it already has the correct layer
    if (Object.keys(res.instrument.skipped).includes(functionName)) {
      expect(res.instrument.skipped[functionName].reasonCode).toStrictEqual(
        "already-correct-extension-and-layer",
      );
    }

    const isInstrumented = await isFunctionInstrumented(functionName);
    expect(isInstrumented).toStrictEqual(true);
  });

  it("function with unsupported runtime does not get instrumented", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
      Runtime: Runtime.java21,
    });
    await setRemoteConfig();

    const res = await invokeLambdaWithScheduledEvent();

    expect(Object.keys(res.instrument.skipped)).toEqual(
      expect.arrayContaining([functionName]),
    );
    expect(res.instrument.skipped[functionName].reasonCode).toStrictEqual(
      "unsupported-runtime",
    );

    const isUninstrumented = await isFunctionUninstrumented(functionName);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("can upgrade layer versions when the config changes", async () => {
    const rc = await setRemoteConfig({
      extensionVersion: 66,
      nodeLayerVersion: 111,
    });
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    // The function should be instrumented by the lambda management event
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);

    // Update the RC to be a different version
    await setRemoteConfig({
      extensionVersion: 67,
      nodeLayerVersion: 112,
      id: rc.id,
    });

    await invokeLambdaWithScheduledEvent();

    // isFunctionInstrumented checks against the RC version, so
    // it being instrumented here means the version is correct
    const isReInstrumented = await isFunctionInstrumented(functionName);
    expect(isReInstrumented).toStrictEqual(true);
  });

  it("clears remote instrumentation when all configs are deleted", async () => {
    await setRemoteConfig();
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    // The function should be instrumented by the lambda management event
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);

    // Remove all configs
    await clearRemoteConfigs({ waitForCacheInvalidation: true });

    // After the next scheduled event
    await invokeLambdaWithScheduledEvent();

    // The function should be uninstrumented
    const isUninstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionUninstrumented(functionName),
    );
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("instruments all functions when using wildcard rule filter", async () => {
    await setRemoteConfig({
      ruleFilters: [
        {
          key: "function_name",
          values: ["*"],
          filter_type: "function_name",
          allow: true,
        },
      ],
    });

    const functions = await createFunctions({}, 3);
    const functionNames = functions.map((lambda) => lambda.FunctionName);
    const res = await invokeLambdaWithScheduledEvent();

    // For each of the 3 functions
    for (const functionName of functionNames) {
      // After some time
      const isInstrumented = await pollUntilTrue(60000, 5000, () =>
        isFunctionInstrumented(functionName),
      );

      // The function is instrumented correctly
      expect(isInstrumented).toStrictEqual(true);
    }

    expect(Object.keys(res.instrument.succeeded)).toEqual(
      expect.arrayContaining(functionNames),
    );
  });

  describe("set DD_TRACE_ENABLED and DD_SERVERLESS_LOGS_ENABLED correctly", () => {
    it("sets variables to true when undefined in config", async () => {
      const { FunctionName: functionName } = await createFunction({
        Tags: { foo: "bar" },
      });
      await setRemoteConfig({
        ddTraceEnabled: undefined,
        ddServerlessLogsEnabled: undefined,
      });
      await invokeLambdaWithScheduledEvent();
      let isInstrumented = await pollUntilTrue(60000, 5000, () =>
        isFunctionInstrumented(functionName),
      );
      expect(isInstrumented).toStrictEqual(true);
    });

    it("sets variables to config value when set in config", async () => {
      const { FunctionName: functionName } = await createFunction({
        Tags: { foo: "bar" },
      });
      await setRemoteConfig({
        ddTraceEnabled: true,
        ddServerlessLogsEnabled: false,
      });
      await invokeLambdaWithScheduledEvent();
      const isInstrumented = await pollUntilTrue(60000, 5000, () =>
        isFunctionInstrumented(functionName),
      );
      expect(isInstrumented).toStrictEqual(true);
    });
  });

  it("adds an appropriate reason code when datadog-ci fails", async () => {
    // Set the extension version to a version that doesn't exist
    await setRemoteConfig({
      extensionVersion: 100000000,
    });
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    const res = await invokeLambdaWithScheduledEvent();
    expect(Object.keys(res.instrument.failed)).toEqual(
      expect.arrayContaining([functionName]),
    );

    expect(res.instrument.failed[functionName].reasonCode).toStrictEqual(
      "datadog-ci-error",
    );
    expect(res.instrument.failed[functionName].reason).toBeDefined();

    const isUninstrumented = await isFunctionUninstrumented(functionName);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("error for nonexistant function gets cleared and skipped", async () => {
    await putErrorObject(functionThatDoesntExist);

    const res = await invokeLambdaWithScheduledEvent();

    if (Object.keys(res.instrument.skipped).includes(functionThatDoesntExist)) {
      expect(
        res.instrument.skipped[functionThatDoesntExist].reasonCode,
      ).toStrictEqual("function-not-found");
    }

    const doesErrorObjectStillExist = await doesErrorObjectExist(
      functionThatDoesntExist,
    );
    expect(doesErrorObjectStillExist).toEqual(false);
  });
});
