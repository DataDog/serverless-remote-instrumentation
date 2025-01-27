const { SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
const { LambdaClient } = require("@aws-sdk/client-lambda");
const { account, roleName, region } = require("../config.json");
const { S3Client } = require("@aws-sdk/client-s3");
const { getCredentials } = require("./get-credentials");

const arn = `arn:aws:iam::${account}:role/${roleName}`;

let secretsManagerClient;
const getSecretsManagerClient = async () => {
  if (!secretsManagerClient) {
    secretsManagerClient = new SecretsManagerClient({
      credentials: getCredentials(arn),
      region,
    });
  }
  return secretsManagerClient;
};

exports.getSecretsManagerClient = getSecretsManagerClient;

let lambdaClient;
const getLambdaClient = async () => {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({
      credentials: getCredentials(arn),
      maxAttempts: 6,
      retryMode: "adaptive",
      region,
    });
  }
  return lambdaClient;
};

exports.getLambdaClient = getLambdaClient;

let s3Client;
const getS3Client = async () => {
  if (!s3Client) {
    s3Client = new S3Client({
      credentials: getCredentials(arn),
      region,
    });
  }
  return s3Client;
};

exports.getS3Client = getS3Client;
