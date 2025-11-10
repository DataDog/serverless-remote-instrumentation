const {
  GetObjectCommand,
  PutObjectCommand,
  NoSuchKey,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  FAILED,
  RC_ACKNOWLEDGED,
  RC_ERROR,
  RC_PRODUCT,
  APPLY_STATE_KEY,
} = require("./consts");
const { logger } = require("./logger");

async function getApplyState(client) {
  const bucketName = process.env.DD_S3_BUCKET;
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: APPLY_STATE_KEY,
      }),
    );
    const applyState = await response.Body.transformToString();
    logger.log(`Retrieved apply state: ${applyState}`);
    return JSON.parse(applyState);
  } catch (caught) {
    if (caught instanceof NoSuchKey) {
      logger.log(`No apply state found at key: ${APPLY_STATE_KEY}`);
      return [];
    }
  }
}
exports.getApplyState = getApplyState;

async function putApplyState(client, applyStateObjects) {
  const bucketName = process.env.DD_S3_BUCKET;
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: APPLY_STATE_KEY,
      Body: JSON.stringify(applyStateObjects),
    }),
  );
}
exports.putApplyState = putApplyState;

async function deleteApplyState(client) {
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
exports.deleteApplyState = deleteApplyState;

function createApplyStateObject(instrumentOutcome, config) {
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
exports.createApplyStateObject = createApplyStateObject;
