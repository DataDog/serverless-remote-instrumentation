const { pollUntilTrue } = require("./utilities/poll-until-true");
const {
  isFunctionInstrumented,
} = require("./utilities/is-function-instrumented");
const {
  setRemoteConfig,
  clearRemoteConfigs,
} = require("./utilities/remote-config");
const {
  createFunction,
  deleteFunction,
} = require("./utilities/lambda-functions");

describe("Remote instrumenter lambda management event tests", () => {
  const testFunction = "abcd";

  afterAll(async () => {
    await deleteFunction(testFunction);
    await clearRemoteConfigs();
  });

  beforeAll(async () => {
    await deleteFunction(testFunction);
    await clearRemoteConfigs();
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
});
