const {
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  NotFound,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { bucketName } = require("../config.json");
const { getS3Client } = require("./aws-resources");

const createPresignedUrl = async (key) => {
  const s3 = await getS3Client();
  const command = new PutObjectCommand({ Bucket: bucketName, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
};

exports.createPresignedUrl = createPresignedUrl;

const doesObjectExist = async (key) => {
  const s3 = await getS3Client();
  const command = new HeadObjectCommand({
    Bucket: bucketName,
    Key: key,
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
exports.doesObjectExist = doesObjectExist;

const deleteObject = async (key) => {
  const s3 = await getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return s3.send(command);
};

exports.deleteObject = deleteObject;
