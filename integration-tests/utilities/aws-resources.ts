import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { LambdaClient } from "@aws-sdk/client-lambda";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  account,
  roleName,
  region,
  stackName,
} from "../config.json";
import { S3Client } from "@aws-sdk/client-s3";
import { getCredentials } from "./get-credentials";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

const arn = `arn:aws:iam::${account}:role/${roleName}`;

let secretsManagerClient: any;
const getSecretsManagerClient = async (): Promise<any> => {
  if (!secretsManagerClient) {
    secretsManagerClient = new SecretsManagerClient({
      credentials: getCredentials(arn),
      region,
    });
  }
  return secretsManagerClient;
};

let lambdaClient: any;
const getLambdaClient = async (): Promise<any> => {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({
      credentials: getCredentials(arn),
      maxAttempts: 10,
      retryMode: "adaptive",
      region,
    });
  }
  return lambdaClient;
};

let s3Client: any;
const getS3Client = async (): Promise<any> => {
  if (!s3Client) {
    s3Client = new S3Client({
      credentials: getCredentials(arn),
      region,
    });
  }
  return s3Client;
};

let logsClient: any;
const getLogsClient = (): any => {
  if (!logsClient) {
    logsClient = new CloudWatchLogsClient({
      credentials: getCredentials(arn),
      region,
    });
  }
  return logsClient;
};

const getEdgeFunctionName = async (): Promise<string> => {
  const cfClient = new CloudFormationClient({
    credentials: getCredentials(arn),
    region,
  });
  const result = await cfClient.send(
    new DescribeStacksCommand({ StackName: stackName }),
  );
  const output = result.Stacks?.[0]?.Outputs?.find(
    (o) => o.OutputKey === "EdgeFunctionName",
  );
  if (!output?.OutputValue) {
    throw new Error(`EdgeFunctionName output not found in stack ${stackName}`);
  }
  return output.OutputValue;
};

export {
  getSecretsManagerClient,
  getLambdaClient,
  getS3Client,
  getLogsClient,
  getEdgeFunctionName,
};
