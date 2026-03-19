import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  PutObjectCommand,
  _Object,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  FAILED,
  SKIPPED,
  SUCCEEDED,
  type InstrumentOutcome,
  type InstrumentationResult,
} from "./consts";

const bucketName = process.env.DD_S3_BUCKET;
const prefix = "errors/";
const suffix = ".json";

interface ErrorItem {
  functionName: string;
  reason: string;
}

const putError = async (
  s3: S3Client,
  functionName: string,
  error: string,
): Promise<void> => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: `${prefix}${functionName}${suffix}`,
    Body: JSON.stringify({
      functionName,
      error,
    }),
  });

  await s3.send(command);
};

export const listErrors = async (s3: S3Client): Promise<string[]> => {
  const params: ListObjectsV2CommandInput = {
    Bucket: bucketName,
    Prefix: prefix,
  };

  let isTruncated = true;
  const results: _Object[] = [];

  while (isTruncated) {
    const command = new ListObjectsV2Command(params);
    const response = await s3.send(command);
    const { Contents, NextContinuationToken } = response;
    isTruncated = response.IsTruncated ?? false;
    if (Contents) {
      results.push(...Contents);
    }
    params.ContinuationToken = NextContinuationToken;
  }
  // Return just the LAMBDA_FUNCTION_NAME from `errors/LAMBDA_FUNCTION_NAME.json`
  return results
    .map((item) =>
      item.Key!.slice(prefix.length, item.Key!.length - suffix.length),
    )
    .filter((item) => item.length);
};

export const deleteError = async (
  s3: S3Client,
  functionName: string,
): Promise<void> => {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: `${prefix}${functionName}${suffix}`,
  });

  await s3.send(command);
};

export const identifyNewErrorsAndResolvedErrors = (
  instrumentOutcome: InstrumentOutcome,
  previousErrors: string[],
): { newErrors: ErrorItem[]; resolvedErrors: string[] } => {
  const succeeded = ["instrument", "uninstrument"].flatMap((action) =>
    [SKIPPED, SUCCEEDED].flatMap((status) =>
      Object.keys(instrumentOutcome[action][status]),
    ),
  );
  const failed = ["instrument", "uninstrument"].flatMap((action) =>
    Object.entries(instrumentOutcome[action][FAILED]).map(
      ([k, v]: [string, InstrumentationResult]) => ({
        functionName: k,
        reason: v.reason ?? "",
      }),
    ),
  );

  return {
    newErrors: failed.filter(
      (item) => !previousErrors.includes(item.functionName),
    ),
    resolvedErrors: succeeded.filter((item) => previousErrors.includes(item)),
  };
};

export const emptyBucket = async (s3: S3Client): Promise<void> => {
  const params: ListObjectsV2CommandInput = {
    Bucket: bucketName,
  };

  let isTruncated = true;

  while (isTruncated) {
    const response = await s3.send(new ListObjectsV2Command(params));
    const { Contents, NextContinuationToken } = response;
    isTruncated = response.IsTruncated ?? false;
    if (Contents && Contents.length > 0) {
      // Batch delete objects in groups of 1000 using DeleteObjectsCommand to match the limit https://docs.aws.amazon.com/cli/latest/reference/s3api/delete-objects.html
      for (let i = 0; i < Contents.length; i += 1000) {
        const batch = Contents.slice(i, i + 1000);
        const deleteParams = {
          Bucket: bucketName,
          Delete: {
            Objects: batch.map((object) => ({ Key: object.Key })),
            Quiet: true,
          },
        };
        await s3.send(new DeleteObjectsCommand(deleteParams));
      }
    }
    if (NextContinuationToken) {
      params.ContinuationToken = NextContinuationToken;
    }
  }
};

export { putError };
