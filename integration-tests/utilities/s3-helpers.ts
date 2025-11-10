import {
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  NotFound,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { bucketName } from "../config.json" with { type: "json" };
import { getS3Client } from "./aws-resources";

const createPresignedUrl = async (key: string): Promise<string> => {
  const s3 = await getS3Client();
  const command = new PutObjectCommand({ Bucket: bucketName, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
};

const doesObjectExist = async (key: string): Promise<boolean> => {
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

const deleteObject = async (key: string): Promise<any> => {
  const s3 = await getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return s3.send(command);
};

export { createPresignedUrl, doesObjectExist, deleteObject };
