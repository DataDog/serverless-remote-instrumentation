import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { FAILED, SKIPPED, SUCCEEDED } from "./consts";

const bucketName = process.env.DD_S3_BUCKET;
const prefix = "errors/";
const suffix = ".json";

interface ErrorItem {
  functionName: string;
  reason: string;
}

interface InstrumentOutcome {
  instrument: {
    [key: string]: Record<string, any>;
  };
  uninstrument: {
    [key: string]: Record<string, any>;
  };
}

const putError = async (
  s3: any,
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

export const listErrors = async (s3: any): Promise<string[]> => {
  const params: any = {
    Bucket: bucketName,
    Prefix: prefix,
  };

  let isTruncated = true;
  const results: any[] = [];

  while (isTruncated) {
    const command = new ListObjectsV2Command(params);
    const response = await s3.send(command);
    const { Contents, NextContinuationToken } = response;
    isTruncated = response.IsTruncated;
    if (Contents) {
      results.push(...Contents);
    }
    params.ContinuationToken = NextContinuationToken;
  }
  // Return just the LAMBDA_FUNCTION_NAME from `errors/LAMBDA_FUNCTION_NAME.json`
  return results
    .map((item) =>
      item.Key.slice(prefix.length, item.Key.length - suffix.length),
    )
    .filter((item) => item.length);
};

export const deleteError = async (
  s3: any,
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
      Object.keys((instrumentOutcome as any)[action][status]),
    ),
  );
  const failed = ["instrument", "uninstrument"].flatMap((action) =>
    Object.entries((instrumentOutcome as any)[action][FAILED]).map(
      ([k, v]: [string, any]) => ({
        functionName: k,
        reason: v.reason,
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

export const emptyBucket = async (s3: any): Promise<void> => {
  const params: any = {
    Bucket: bucketName,
  };

  let isTruncated = true;

  while (isTruncated) {
    const response = await s3.send(new ListObjectsV2Command(params));
    const { Contents, NextContinuationToken } = response;
    isTruncated = response.IsTruncated;
    if (Contents && Contents.length > 0) {
      // Batch delete objects in groups of 1000 using DeleteObjectsCommand to match the limit https://docs.aws.amazon.com/cli/latest/reference/s3api/delete-objects.html
      for (let i = 0; i < Contents.length; i += 1000) {
        const batch = Contents.slice(i, i + 1000);
        const deleteParams = {
          Bucket: bucketName,
          Delete: {
            Objects: batch.map((object: any) => ({ Key: object.Key })),
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
