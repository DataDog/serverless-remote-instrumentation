const { pollUntilTrue } = require("./utilities/poll-until-true");
const {
  isFunctionInstrumented,
  isFunctionUninstrumented,
} = require("./utilities/is-function-instrumented");
const { namingSeed } = require("./config.json");
const {
  setRemoteConfig,
  clearRemoteConfigs,
} = require("./utilities/remote-config");
const {
  invokeLambdaWithScheduledEvent,
} = require("./utilities/remote-instrumenter-invocations");
const {
  createFunction,
  deleteFunction,
} = require("./utilities/lambda-functions");
const { Runtime } = require("@aws-sdk/client-lambda");

describe("Remote instrumenter scheduled event tests", () => {
  const testFunction = `scheduledEventTest${namingSeed}`;

  afterAll(async () => {
    await deleteFunction(testFunction);
    await clearRemoteConfigs();
  });

  beforeEach(async () => {
    await deleteFunction(testFunction);
    await clearRemoteConfigs();
  });

  it("function with different tags does NOT get instrumented", async () => {
    await createFunction({
      FunctionName: testFunction,
      Tags: { foo: "baz" },
    });
    await setRemoteConfig();

    const res = await invokeLambdaWithScheduledEvent();

    expect(Object.keys(res.instrument.skipped)).toEqual(
      expect.arrayContaining([testFunction]),
    );
    expect(res.instrument.skipped[testFunction].reasonCode).toStrictEqual(
      "not-satisfying-targeting-rules",
    );

    const isUninstrumented = await isFunctionUninstrumented(testFunction);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("manually instrumented function does NOT get instrumented", async () => {
    await setRemoteConfig();
    await createFunction({
      FunctionName: testFunction,
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
      expect.arrayContaining([testFunction]),
    );
    expect(res.instrument.skipped[testFunction].reasonCode).toStrictEqual(
      "already-manually-instrumented",
    );
  });

  it("function with correct tags does get instrumented", async () => {
    await createFunction({
      FunctionName: testFunction,
      Tags: { foo: "bar" },
    });
    await setRemoteConfig();

    const res = await invokeLambdaWithScheduledEvent();
    // Very rarely the instrumenter can run in between setting the config and running the lambda
    expect(
      Object.keys(res.instrument.succeeded).concat(
        Object.keys(res.instrument.skipped),
      ),
    ).toEqual(expect.arrayContaining([testFunction]));

    // If it was skipped, it should have the reason that it already has the correct layer
    if (Object.keys(res.instrument.skipped).includes(testFunction)) {
      expect(res.instrument.skipped[testFunction].reasonCode).toStrictEqual(
        "already-correct-extension-and-layer",
      );
    }

    const isInstrumented = await isFunctionInstrumented(testFunction);
    expect(isInstrumented).toStrictEqual(true);
  });

  it("function with unsupported runtime does not get instrumented", async () => {
    await createFunction({
      FunctionName: testFunction,
      Tags: { foo: "bar" },
      Runtime: Runtime.java21,
    });
    await setRemoteConfig();

    const res = await invokeLambdaWithScheduledEvent();

    expect(Object.keys(res.instrument.skipped)).toEqual(
      expect.arrayContaining([testFunction]),
    );
    expect(res.instrument.skipped[testFunction].reasonCode).toStrictEqual(
      "unsupported-runtime",
    );

    const isUninstrumented = await isFunctionUninstrumented(testFunction);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("can upgrade layer versions when the config changes", async () => {
    const rc = await setRemoteConfig({
      extensionVersion: 66,
      nodeLayerVersion: 111,
    });
    await createFunction({
      FunctionName: testFunction,
      Tags: { foo: "bar" },
    });

    // The function should be instrumented by the lambda management event
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(testFunction),
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
    const isReInstrumented = await isFunctionInstrumented(testFunction);
    expect(isReInstrumented).toStrictEqual(true);
  });

  it("clears remote instrumentation when all configs are deleted", async () => {
    await setRemoteConfig();
    await createFunction({
      FunctionName: testFunction,
      Tags: { foo: "bar" },
    });

    // The function should be instrumented by the lambda management event
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(testFunction),
    );
    expect(isInstrumented).toStrictEqual(true);

    // Remove all configs
    await clearRemoteConfigs();

    // After the next scheduled event
    await invokeLambdaWithScheduledEvent();

    // The function should be uninstrumented
    const isUninstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionUninstrumented(testFunction),
    );
    expect(isUninstrumented).toStrictEqual(true);
  });
});
