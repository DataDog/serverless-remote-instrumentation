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
} = require("./utilities/lambda-functions");
const { Runtime } = require("@aws-sdk/client-lambda");
const {
  deleteErrorObject,
  putErrorObject,
  doesErrorObjectExist,
} = require("./utilities/s3-error-object");
const { sleep } = require("./utilities/sleep");

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

    // Wait for the instrumenter's cache to become invalid
    await sleep(6000);

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

    // Wait for the instrumenter's cache to become invalid
    await sleep(6000);

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

    // Wait for the instrumenter's cache to become invalid
    await sleep(6000);

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

    // Wait for the instrumenter's cache to become invalid
    await sleep(6000);

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
    await clearRemoteConfigs(true);

    // Wait for the instrumenter's cache to become invalid
    await sleep(6000);

    // After the next scheduled event
    await invokeLambdaWithScheduledEvent();

    // The function should be uninstrumented
    const isUninstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionUninstrumented(functionName),
    );
    expect(isUninstrumented).toStrictEqual(true);
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
