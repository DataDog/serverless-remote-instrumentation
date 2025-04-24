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
  createFunction,
  createFunctions,
  deleteTestFunctions,
  tagFunction,
} = require("./utilities/lambda-functions");
const {
  invokeLambdaWithScheduledEvent,
  invokeLambdaWithLambdaManagementEvent,
} = require("./utilities/remote-instrumenter-invocations");

describe("Remote instrumenter lambda management event tests", () => {
  afterAll(async () => {
    await clearRemoteConfigs();
  });

  beforeAll(async () => {
    await clearRemoteConfigs();
  });

  beforeEach(async () => {
    await clearKnownRemoteConfigs();
  });

  afterEach(async () => {
    await deleteTestFunctions();
  });

  it("can instrument a new lambda function", async () => {
    // When there is a remote config
    await setRemoteConfig();

    // And a lambda is created
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    // After some time
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );

    // The function is instrumented correctly
    expect(isInstrumented).toStrictEqual(true);
  });

  it("can instrument many new lambda functions", async () => {
    // When there is a remote config
    await setRemoteConfig();

    // And 20 lambdas are created
    const functions = await createFunctions(
      {
        Tags: { foo: "bar" },
      },
      20,
    );
    const functionNames = functions.map((lambda) => lambda.FunctionName);

    // For all 20 functions
    for (const functionName of functionNames) {
      // After some time
      const isInstrumented = await pollUntilTrue(60000, 5000, () =>
        isFunctionInstrumented(functionName),
      );

      // The function is instrumented correctly
      expect(isInstrumented).toStrictEqual(true);
    }
  });

  it("can instrument an existing lambda function that changes tags", async () => {
    // Create a lambda with tags that do not match the rule
    await setRemoteConfig();
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "baz" },
    });

    await invokeLambdaWithScheduledEvent();

    // The lambda should be uninstrumented
    const isUninstrumented = await isFunctionUninstrumented(functionName);
    expect(isUninstrumented).toStrictEqual(true);

    // Tag the function with tags that match the rule
    await tagFunction(functionName, { foo: "bar" });

    // After some time
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
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
