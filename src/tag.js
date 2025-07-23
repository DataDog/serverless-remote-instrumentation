const {
  TagResourcesCommand,
  UntagResourcesCommand,
} = require("@aws-sdk/client-resource-groups-tagging-api");
const { DD_SLS_REMOTE_INSTRUMENTER_VERSION, VERSION } = require("./consts");
const { logger } = require("./logger");

async function processResourcesInBatches(
  client,
  functionArns,
  operationName,
  createCommand,
) {
  if (functionArns.length === 0) {
    return;
  }

  // Batch the function ARNs into groups of 20 (AWS limit)
  const batchSize = 20;
  const batches = [];
  for (let i = 0; i < functionArns.length; i += batchSize) {
    batches.push(functionArns.slice(i, i + batchSize));
  }

  logger.log(
    `Processing ${functionArns.length} resources in ${batches.length} batches of ${batchSize} for ${operationName}`,
  );

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const command = createCommand(batch);
    try {
      await client.send(command);
      logger.log(
        `Successfully processed batch ${i + 1}/${batches.length} (${batch.length} resources) for ${operationName}`,
      );
    } catch (error) {
      logger.error(
        `Error processing resources in batch ${i + 1}/${batches.length} for ${operationName}: ${error}`,
      );
    }
  }
}

async function tagResourcesWithSlsTag(client, functionArns) {
  logger.log(
    `Tagging function ARNs '${functionArns}' with tag '${DD_SLS_REMOTE_INSTRUMENTER_VERSION}'`,
  );

  const createTagCommand = (batch) => {
    const input = {
      ResourceARNList: batch,
      Tags: { [DD_SLS_REMOTE_INSTRUMENTER_VERSION]: `v${VERSION}` }, // use [] to specify KEY is a variable
    };
    return new TagResourcesCommand(input);
  };

  await processResourcesInBatches(
    client,
    functionArns,
    "tagging",
    createTagCommand,
  );
}
exports.tagResourcesWithSlsTag = tagResourcesWithSlsTag;

async function untagResourcesOfSlsTag(client, functionArns) {
  logger.log(
    `Removing tag '${DD_SLS_REMOTE_INSTRUMENTER_VERSION}' from function ARNs '${functionArns}'`,
  );

  const createUntagCommand = (batch) => {
    const input = {
      ResourceARNList: batch,
      TagKeys: [DD_SLS_REMOTE_INSTRUMENTER_VERSION],
    };
    return new UntagResourcesCommand(input);
  };

  await processResourcesInBatches(
    client,
    functionArns,
    "untagging",
    createUntagCommand,
  );
}
exports.untagResourcesOfSlsTag = untagResourcesOfSlsTag;
