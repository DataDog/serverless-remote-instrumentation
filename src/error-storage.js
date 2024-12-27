const { PutObjectCommand } = require("@aws-sdk/client-s3");

const bucketName = process.env.DD_S3_BUCKET;

const putError = async (s3, functionName, error) => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: `errors/${functionName}.json`,
    Body: JSON.stringify({
      functionName,
      error,
    }),
  });

  await s3.send(command);
};

exports.putError = putError;
