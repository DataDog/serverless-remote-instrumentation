import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import {
  CloudFrontClient,
  ListDistributionsCommand,
  type DistributionSummary,
} from "@aws-sdk/client-cloudfront";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { S3Client } from "@aws-sdk/client-s3";
import { logger } from "./logger";

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

let cloudFrontClient: CloudFrontClient;
const getCloudFrontClient = () => {
  if (!cloudFrontClient) {
    cloudFrontClient = new CloudFrontClient({
      region: "us-east-1",
      retryMode: "adaptive",
      maxAttempts: 5,
    });
  }
  return cloudFrontClient;
};

// Lambda ARN format: arn:aws:lambda:REGION:ACCOUNT:function:NAME[:VERSION]
const extractFunctionNameFromArn = (lambdaArn: string): string =>
  lambdaArn.split(":")[6];

const collectLambdaArnsFromDistribution = (
  dist: DistributionSummary,
): string[] => {
  const arns: string[] = [];
  const behaviors = [
    dist.DefaultCacheBehavior,
    ...(dist.CacheBehaviors?.Items ?? []),
  ];
  for (const behavior of behaviors) {
    for (const assoc of behavior?.LambdaFunctionAssociations?.Items ?? []) {
      if (assoc.LambdaFunctionARN) {
        arns.push(assoc.LambdaFunctionARN);
      }
    }
  }
  return arns;
};

export const getEdgeLambdaFunctionNames = async (): Promise<Set<string>> => {
  const client = getCloudFrontClient();
  const names = new Set<string>();

  let marker: string | undefined;
  do {
    const output = await client.send(
      new ListDistributionsCommand({ Marker: marker }),
    );
    for (const dist of output.DistributionList?.Items ?? []) {
      for (const arn of collectLambdaArnsFromDistribution(dist)) {
        names.add(extractFunctionNameFromArn(arn));
      }
    }
    marker = output.DistributionList?.IsTruncated
      ? output.DistributionList.NextMarker
      : undefined;
  } while (marker);

  return names;
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
