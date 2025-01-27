const { pollUntilTrue } = require("./utilities/poll-until-true");
const {
  isFunctionInstrumented,
  isFunctionUninstrumented,
} = require("./utilities/is-function-instrumented");
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

describe("Remote instrumenter scheduled event tests", () => {
  const testFunction = "scheduledEventTest";

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
});
