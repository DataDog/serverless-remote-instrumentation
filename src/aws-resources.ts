const { LambdaClient } = require("@aws-sdk/client-lambda");
const {
  ResourceGroupsTaggingAPIClient,
} = require("@aws-sdk/client-resource-groups-tagging-api");
const { S3Client } = require("@aws-sdk/client-s3");

let lambdaClient;
const getLambdaClient = () => {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION,
      retryMode: "adaptive",
      maxAttempts: 5,
    });
  }
  return lambdaClient;
};

exports.getLambdaClient = getLambdaClient;

let taggingClient;
const getTaggingClient = () => {
  if (!taggingClient) {
    taggingClient = new ResourceGroupsTaggingAPIClient({
      region: process.env.AWS_REGION,
      retryMode: "adaptive",
      maxAttempts: 5,
    });
  }
  return taggingClient;
};

exports.getTaggingClient = getTaggingClient;

let s3Client;
const getS3Client = () => {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION,
      retryMode: "adaptive",
      maxAttempts: 5,
    });
  }
  return s3Client;
};

exports.getS3Client = getS3Client;
