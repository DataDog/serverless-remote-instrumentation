import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "./aws-resources";
import { deleteObject, doesObjectExist } from "./s3-helpers";

import { bucketName } from "../config.json" with { type: "json" };

const putErrorObject = async (functionName: string): Promise<any> => {
  const s3 = await getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: `errors/${functionName}.json`,
    Body: JSON.stringify({ functionName }),
  });

  return s3.send(command);
};

const deleteErrorObject = async (functionName: string): Promise<any> => {
  return deleteObject(`errors/${functionName}.json`);
};

const doesErrorObjectExist = async (functionName: string): Promise<boolean> => {
  return doesObjectExist(`errors/${functionName}.json`);
};

export { putErrorObject, deleteErrorObject, doesErrorObjectExist };
