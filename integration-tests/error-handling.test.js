const { getCredentials } = require("./utilities/get-credentials");
const {
  isFunctionInstrumented,
} = require("./utilities/is-function-instrumented");
const {
  deleteErrorObject,
  doesErrorObjectExist,
  putErrorObject,
} = require("./utilities/s3-error-object");
const { SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
const {
  invokeLambdaWithScheduledEvent,
} = require("./utilities/remote-instrumenter-invocations");
const { S3Client } = require("@aws-sdk/client-s3");
const { LambdaClient } = require("@aws-sdk/client-lambda");
const {
  account,
  roleName,
  bucketName,
  functionName,
  region,
} = require("./config.json");

const arn = `arn:aws:iam::${account}:role/${roleName}`;

const credentials = getCredentials(arn);
const s3 = new S3Client({
  credentials,
  region,
});

const secretsManager = new SecretsManagerClient({
  credentials,
  region,
});

const lambdaClient = new LambdaClient({
  credentials,
  region,
});

describe("Error handling tests", () => {
  const testFunction = "tal-hello-world";

  afterAll(async () => {
    await deleteErrorObject(s3, bucketName, testFunction);
  });
  it("reads an s3 file and instruments the lambda", async () => {
    // When there is an error for a function
    await putErrorObject(s3, bucketName, testFunction);

    // And the scheduler runs
    const instrumentOutcome = await invokeLambdaWithScheduledEvent(
      lambdaClient,
      functionName,
    );

    // Then the error object is deleted
    const objectExistsAfterInvocation = await doesErrorObjectExist(
      s3,
      bucketName,
      testFunction,
    );
    expect(objectExistsAfterInvocation).toStrictEqual(false);

    // And the response skipped the function
    expect(Object.keys(instrumentOutcome.instrument.skipped)).toStrictEqual(
      expect.arrayContaining([testFunction]),
    );
    expect(
      instrumentOutcome.instrument.skipped[testFunction].reasonCode,
    ).toStrictEqual("already-correct-extension-and-layer");

    // Because the function is instrumented
    const isInstrumented = await isFunctionInstrumented(
      secretsManager,
      lambdaClient,
      testFunction,
    );
    expect(isInstrumented).toStrictEqual(true);
  });
});
