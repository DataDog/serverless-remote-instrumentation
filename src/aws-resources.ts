import { LambdaClient } from "@aws-sdk/client-lambda";
import { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { S3Client } from "@aws-sdk/client-s3";

let lambdaClient: any;
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

let taggingClient: any;
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

let s3Client: any;
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
