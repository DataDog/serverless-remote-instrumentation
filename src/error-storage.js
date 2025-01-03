const { ListObjectsV2Command, PutObjectCommand } = require("@aws-sdk/client-s3");

const bucketName = process.env.DD_S3_BUCKET;
const prefix = 'errors/';
const suffix = '.json';

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
    const {
      Contents,
      NextContinuationToken,
    } = response;
    isTruncated = response.IsTruncated;
    results.push(...Contents);
    params.ContinuationToken = NextContinuationToken;
  }
  // Return just the LAMBDA_FUNCTION_NAME from `errors/LAMBDA_FUNCTION_NAME.json`
  return results.map(item => item.Key.slice(prefix.length, item.Key.length - suffix.length));
};

exports.listErrors = listErrors;
