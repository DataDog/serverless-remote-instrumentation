const { getCredentials } = require("./utilities/get-credentials");
const {
  isFunctionInstrumented,
} = require("./utilities/is-function-instrumented");
const {
  deleteErrorObject,
  doesErrorObjectExist,
  putErrorObject,
} = require("./utilities/s3-error-object");
const {
  invokeLambdaWithScheduledEvent,
} = require("./utilities/remote-instrumenter-invocations");
const { S3Client } = require("@aws-sdk/client-s3");
const { LambdaClient } = require("@aws-sdk/client-lambda");

// Inputs that are needed.  These will eventually be derived in
// future PRs so that we don't need to manually specify them.
const arn = "arn:aws:iam::425362996713:role/alex-angelillo-test";
const bucket = "datadog-remote-instrument-bucket-97ee62b0";
const remoteInstrumenterName = "datadog-remote-instrumenter";
const region = "ca-central-1";

const credentials = getCredentials(arn);
const s3 = new S3Client({
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
    await deleteErrorObject(s3, bucket, testFunction);
  });
  it("reads an s3 file and instruments the lambda", async () => {
    // When there is an error for a function
    await putErrorObject(s3, bucket, testFunction);

    // And the scheduler runs
    const instrumentOutcome = await invokeLambdaWithScheduledEvent(
      lambdaClient,
      remoteInstrumenterName,
    );

    // Then the error object is deleted
    const objectExistsAfterInvocation = await doesErrorObjectExist(
      s3,
      bucket,
      testFunction,
    );
    expect(objectExistsAfterInvocation).toStrictEqual(false);

    // And the response skipped the function
    expect(Object.keys(instrumentOutcome.instrument.skipped)).toStrictEqual([
      testFunction,
    ]);
    expect(
      instrumentOutcome.instrument.skipped[testFunction].reasonCode,
    ).toStrictEqual("already-correct-extension-and-layer");

    // Because the function is instrumented
    const isInstrumented = await isFunctionInstrumented(
      lambdaClient,
      testFunction,
    );
    expect(isInstrumented).toStrictEqual(true);
  });
});
