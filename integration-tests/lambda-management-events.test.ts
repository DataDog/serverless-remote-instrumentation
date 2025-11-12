import { pollUntilTrue } from "./utilities/poll-until-true";
import {
  isFunctionInstrumented,
  isFunctionUninstrumented,
} from "./utilities/is-function-instrumented";
import {
  setRemoteConfig,
  clearKnownRemoteConfigs,
  clearRemoteConfigs,
} from "./utilities/remote-config";
import {
  createFunction,
  createFunctions,
  deleteTestFunctions,
  tagFunction,
} from "./utilities/lambda-functions";
import {
  invokeLambdaWithScheduledEvent,
  invokeLambdaWithLambdaManagementEvent,
} from "./utilities/remote-instrumenter-invocations";

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

  it("can instrument a new lambda function with different tag casing", async () => {
    // When there is a remote config
    await setRemoteConfig();

    // And a lambda is created
    const { FunctionName: functionName } = await createFunction({
      Tags: { FOO: "BAR" },
    });

    // After some time
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );

    // The function is instrumented correctly
    expect(isInstrumented).toStrictEqual(true);
  });

  it("can instrument a lambda function with deny rule", async () => {
    // Config will cause the function to be instrumented
    await setRemoteConfig({
      ruleFilters: [
        {
          key: "apple",
          values: ["honeycrisp"],
          filter_type: "tag",
          allow: true,
        },
      ],
    });

    const { FunctionName: functionName } = await createFunction({
      Tags: {
        apple: "honeycrisp",
        potato: "idaho",
      },
    });

    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);

    // Exclude functions by tag
    await setRemoteConfig({
      ruleFilters: [
        {
          key: "apple",
          values: ["honeycrisp"],
          filter_type: "tag",
          allow: true,
        },
        {
          key: "potato",
          values: ["idaho"],
          filter_type: "tag",
          allow: false,
        },
      ],
    });

    await invokeLambdaWithScheduledEvent();

    const isUninstrumented = await isFunctionUninstrumented(functionName);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("can instrument a lambda function by its runtime", async () => {
    // When there are two lambdas created with different runtimes
    const { FunctionName: nodejsFunctionName } = await createFunction({
      Runtime: "nodejs20.x",
    });
    const { FunctionName: pythonFunctionName } = await createFunction({
      Runtime: "python3.10",
    });

    // And the config targets functions by runtime
    await setRemoteConfig({
      ruleFilters: [
        {
          key: "runtime",
          values: ["nodejs20.x"],
          filter_type: "tag",
          allow: true,
        },
      ],
    });

    // After some time
    const areCorrectlyInstrumented = await pollUntilTrue(
      60000,
      5000,
      () =>
        // @ts-expect-error Need to fix later
        isFunctionInstrumented(nodejsFunctionName) &&
        isFunctionUninstrumented(pythonFunctionName),
    );

    // The functions are instrumented and uninstrumented respectively
    expect(areCorrectlyInstrumented).toStrictEqual(true);
  });

  it("can instrument multiple new lambda functions", async () => {
    // When there is a remote config
    await setRemoteConfig();

    // And 20 lambdas are created
    const functions = await createFunctions(
      {
        Tags: { foo: "bar" },
      },
      20,
    );
    const functionNames = functions.map((lambda: any) => lambda.FunctionName);

    // For each of the 20 functions
    for (const functionName of functionNames) {
      // After some time
      const isInstrumented = await pollUntilTrue(60000, 5000, () =>
        isFunctionInstrumented(functionName),
      );

      // The function is instrumented correctly
      expect(isInstrumented).toStrictEqual(true);
    }
  }, 120000);

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
