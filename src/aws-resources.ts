import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { S3Client } from "@aws-sdk/client-s3";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";

let lambdaClient: LambdaClient;
export const getLambdaClient = () => {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION,
      retryMode: "adaptive",
      maxAttempts: 5,
    });
  }
  return lambdaClient;
};

let taggingClient: ResourceGroupsTaggingAPIClient;
export const getTaggingClient = () => {
  if (!taggingClient) {
    taggingClient = new ResourceGroupsTaggingAPIClient({
      region: process.env.AWS_REGION,
      retryMode: "adaptive",
      maxAttempts: 5,
    });
  }
  return taggingClient;
};

let s3Client: S3Client;
export const getS3Client = () => {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION,
      retryMode: "adaptive",
      maxAttempts: 5,
    });
  }
  return s3Client;
};

let cloudWatchLogsClient: CloudWatchLogsClient;
export const getCloudWatchLogsClient = () => {
  if (!cloudWatchLogsClient) {
    cloudWatchLogsClient = new CloudWatchLogsClient({
      region: process.env.AWS_REGION,
      retryMode: "adaptive",
      maxAttempts: 5,
    });
  }
  return cloudWatchLogsClient;
};

let cloudformationClient: CloudFormationClient;
export const getCloudFormationClient = () => {
  if (!cloudformationClient) {
    cloudformationClient = new CloudFormationClient({
      region: process.env.AWS_REGION,
      retryMode: "adaptive",
      maxAttempts: 5,
    });
  }
  return cloudformationClient;
};
