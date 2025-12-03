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
  invokeLambdaWithUpdateEvent,
} from "./utilities/remote-instrumenter-invocations";
import { getS3Client } from "./utilities/aws-resources";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "fs";
import { bucketName } from "./config.json";

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

  it("doesn't error on nonexistant function", async () => {
    // First, upload "modified_template.yaml" to the S3 bucket specified for testing.
    // We'll assume the bucketName is available from config.json, and use AWS SDK v3.


    const s3Client = await getS3Client();

    const filePath = "modified_template.yaml";
    const fileContent = readFileSync(filePath);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: "modified_template.yaml",
        Body: fileContent,
        ContentType: "application/x-yaml",
      })
    );
    const { errors } = await invokeLambdaWithUpdateEvent({ version: "1.10.0" });
    expect(errors).toBeFalsy();
  }, 180000);
});
