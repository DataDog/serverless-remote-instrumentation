const {
  DeleteObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  NotFound,
} = require("@aws-sdk/client-s3");

const putErrorObject = async (s3, bucket, functionName) => {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: `errors/${functionName}.json`,
    Body: JSON.stringify({ functionName }),
  });

  return s3.send(command);
};

exports.putErrorObject = putErrorObject;

const deleteErrorObject = async (s3, bucket, functionName) => {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: `errors/${functionName}.json`,
  });

  return s3.send(command);
};

exports.deleteErrorObject = deleteErrorObject;

const doesErrorObjectExist = async (s3, bucket, functionName) => {
  const command = new HeadObjectCommand({
    Bucket: bucket,
    Key: `errors/${functionName}.json`,
  });
  try {
    await s3.send(command);
    return true;
  } catch (error) {
    if (error instanceof NotFound) {
      return false;
    }
    throw error;
  }
};

exports.doesErrorObjectExist = doesErrorObjectExist;
