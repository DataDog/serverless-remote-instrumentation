import {
  GetObjectCommand,
  PutObjectCommand,
  NoSuchKey,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  FAILED,
  RC_ACKNOWLEDGED,
  RC_ERROR,
  RC_PRODUCT,
  APPLY_STATE_KEY,
  type InstrumentOutcome,
} from "./consts";
import { logger } from "./logger";

interface ApplyStateObject {
  id: string;
  product: string;
  version: number;
  apply_state: number;
  apply_error: string;
}

interface Config {
  configID: string;
  rcConfigVersion: number;
}

export async function getApplyState(
  client: S3Client,
): Promise<ApplyStateObject[] | void> {
  const bucketName = process.env.DD_S3_BUCKET;
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: APPLY_STATE_KEY,
      }),
    );
    const applyState = await response.Body!.transformToString();
    logger.log(`Retrieved apply state: ${applyState}`);
    return JSON.parse(applyState);
  } catch (caught) {
    if (caught instanceof NoSuchKey) {
      logger.log(`No apply state found at key: ${APPLY_STATE_KEY}`);
      return [];
    }
  }
}

export async function putApplyState(
  client: S3Client,
  applyStateObjects: ApplyStateObject[],
): Promise<void> {
  const bucketName = process.env.DD_S3_BUCKET;
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: APPLY_STATE_KEY,
      Body: JSON.stringify(applyStateObjects),
    }),
  );
}

export async function deleteApplyState(client: S3Client): Promise<void> {
  const bucketName = process.env.DD_S3_BUCKET;
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: APPLY_STATE_KEY,
      }),
    );
  } catch (caught) {
    if (caught instanceof NoSuchKey) {
      return;
    }
  }
}

export function createApplyStateObject(
  instrumentOutcome: InstrumentOutcome,
  config: Config,
): ApplyStateObject {
  const failedFunctions = [
    ...Object.keys(instrumentOutcome.instrument[FAILED]),
    ...Object.keys(instrumentOutcome.uninstrument[FAILED]),
  ];
  const applyState = failedFunctions.length === 0 ? RC_ACKNOWLEDGED : RC_ERROR;
  const applyError =
    failedFunctions.length === 0
      ? ""
      : "Failed to instrument functions: " + failedFunctions.join(", ");

  return {
    id: config.configID,
    product: RC_PRODUCT,
    version: config.rcConfigVersion,
    apply_state: applyState,
    apply_error: applyError,
  };
}
