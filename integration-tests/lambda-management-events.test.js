const { getCredentials } = require("./utilities/get-credentials");
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
const { SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
const { LambdaClient } = require("@aws-sdk/client-lambda");
const { account, roleName, region } = require("./config.json");

const arn = `arn:aws:iam::${account}:role/${roleName}`;

const credentials = getCredentials(arn);

const secretsManager = new SecretsManagerClient({
  credentials,
  region,
});

const lambdaClient = new LambdaClient({
  credentials,
  region,
});

describe("Remote instrumenter lambda management event tests", () => {
  const testFunction = "abcd";

  afterAll(async () => {
    await deleteFunction(lambdaClient, testFunction);
    await clearRemoteConfigs(secretsManager);
  });

  beforeAll(async () => {
    await deleteFunction(lambdaClient, testFunction);
    await clearRemoteConfigs(secretsManager);
  });

  it("can instrument a new lambda function", async () => {
    // When there is a remote config
    await setRemoteConfig(secretsManager);

    // And a lambda is created
    await createFunction(lambdaClient, {
      FunctionName: testFunction,
      Tags: { foo: "bar" },
    });

    // After some time
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(secretsManager, lambdaClient, testFunction),
    );

    // The function is instrumented correctly
    expect(isInstrumented).toStrictEqual(true);
  });
});
