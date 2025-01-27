const {
  DeleteObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  NotFound,
} = require("@aws-sdk/client-s3");
const { getS3Client } = require("./aws-resources");

const { bucketName } = require("../config.json");

const putErrorObject = async (functionName) => {
  const s3 = await getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: `errors/${functionName}.json`,
    Body: JSON.stringify({ functionName }),
  });

  return s3.send(command);
};

exports.putErrorObject = putErrorObject;

const deleteErrorObject = async (functionName) => {
  const s3 = await getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: `errors/${functionName}.json`,
  });

  return s3.send(command);
};

exports.deleteErrorObject = deleteErrorObject;

const doesErrorObjectExist = async (functionName) => {
  const s3 = await getS3Client();
  const command = new HeadObjectCommand({
    Bucket: bucketName,
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
