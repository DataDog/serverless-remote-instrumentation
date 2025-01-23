const { PutObjectCommand } = require("@aws-sdk/client-s3");
const {
  FAILED,
  RC_ACKNOWLEDGED,
  RC_ERROR,
  RC_PRODUCT,
  APPLY_STATE_KEY,
} = require("./consts");

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
