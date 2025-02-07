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
const { namingSeed } = require("./config.json");
const {
  createFunction,
  deleteFunction,
  tagFunction,
} = require("./utilities/lambda-functions");
const {
  invokeLambdaWithScheduledEvent,
  invokeLambdaWithLambdaManagementEvent,
} = require("./utilities/remote-instrumenter-invocations");

describe("Remote instrumenter lambda management event tests", () => {
  const testFunction = `lambdaManagementEventTest${namingSeed}`;

  afterAll(async () => {
    await deleteFunction(testFunction);
    await clearRemoteConfigs();
  });

  beforeAll(async () => {
    await clearRemoteConfigs();
  });

  beforeEach(async () => {
    await deleteFunction(testFunction);
    await clearKnownRemoteConfigs();
  });

  it("can instrument a new lambda function", async () => {
    // When there is a remote config
    await setRemoteConfig();

    // And a lambda is created
    await createFunction({
      FunctionName: testFunction,
      Tags: { foo: "bar" },
    });

    // After some time
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(testFunction),
    );

    // The function is instrumented correctly
    expect(isInstrumented).toStrictEqual(true);
  });

  it("can instrument an existing lambda function that changes tags", async () => {
    // Create a lambda with tags that do not match the rule
    await setRemoteConfig();
    await createFunction({
      FunctionName: testFunction,
      Tags: { foo: "baz" },
    });

    await invokeLambdaWithScheduledEvent();

    // The lambda should be uninstrumented
    const isUninstrumented = await isFunctionUninstrumented(testFunction);
    expect(isUninstrumented).toStrictEqual(true);

    // Tag the function with tags that match the rule
    await tagFunction(testFunction, { foo: "bar" });

    // After some time
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(testFunction),
    );

    // The function is instrumented correctly
    expect(isInstrumented).toStrictEqual(true);
  });

  it("doesn't error on nonexistant function", async () => {
    const { errors } = await invokeLambdaWithLambdaManagementEvent({
      targetFunctionName: "LambdaEventThisDoesNotExist",
    });
    expect(errors).toBeFalsy();
  });
});
