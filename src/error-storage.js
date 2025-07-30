const {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { FAILED, SKIPPED, SUCCEEDED } = require("./consts");

const bucketName = process.env.DD_S3_BUCKET;
const prefix = "errors/";
const suffix = ".json";

const putError = async (s3, functionName, error) => {
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

exports.putError = putError;

const listErrors = async (s3) => {
  const params = {
    Bucket: bucketName,
    Prefix: prefix,
  };

  let isTruncated = true;
  const results = [];

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

exports.listErrors = listErrors;

const deleteError = async (s3, functionName) => {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: `${prefix}${functionName}${suffix}`,
  });

  await s3.send(command);
};

exports.deleteError = deleteError;

const identifyNewErrorsAndResolvedErrors = (
  instrumentOutcome,
  previousErrors,
) => {
  const succeeded = ["instrument", "uninstrument"].flatMap((action) =>
    [SKIPPED, SUCCEEDED].flatMap((status) =>
      Object.keys(instrumentOutcome[action][status]),
    ),
  );
  const failed = ["instrument", "uninstrument"].flatMap((action) =>
    Object.entries(instrumentOutcome[action][FAILED]).map(([k, v]) => ({
      functionName: k,
      reason: v.reason,
    })),
  );

  return {
    newErrors: failed.filter(
      (item) => !previousErrors.includes(item.functionName),
    ),
    resolvedErrors: succeeded.filter((item) => previousErrors.includes(item)),
  };
};

exports.identifyNewErrorsAndResolvedErrors = identifyNewErrorsAndResolvedErrors;

const emptyBucket = async (s3) => {
  const params = {
    Bucket: bucketName,
  };

  let isTruncated = true;

  while (isTruncated) {
    const response = await s3.send(new ListObjectsV2Command(params));
    const { Contents, NextContinuationToken } = response;
    isTruncated = response.IsTruncated;
    if (Contents && Contents.length > 0) {
      // Batch delete objects in groups of 1000 using DeleteObjectsCommand
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

exports.emptyBucket = emptyBucket;
