const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { getS3Client } = require("./aws-resources");
const { deleteObject, doesObjectExist } = require("./s3-helpers");

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
  return deleteObject(`errors/${functionName}.json`);
};

exports.deleteErrorObject = deleteErrorObject;

const doesErrorObjectExist = async (functionName) => {
  return doesObjectExist(`errors/${functionName}.json`);
};

exports.doesErrorObjectExist = doesErrorObjectExist;
