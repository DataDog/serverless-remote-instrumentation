const {
  TagResourcesCommand,
  UntagResourcesCommand,
} = require("@aws-sdk/client-resource-groups-tagging-api");
const { DD_SLS_REMOTE_INSTRUMENTER_VERSION, VERSION } = require("./consts");
const { logger } = require("./logger");

async function tagResourcesWithSlsTag(client, functionArns) {
  logger.log(
    `Tagging function ARNs '${functionArns}' with tag '${DD_SLS_REMOTE_INSTRUMENTER_VERSION}'`,
  );
  if (functionArns.length === 0) {
    return;
  }
  const input = {
    ResourceARNList: functionArns,
    Tags: { [DD_SLS_REMOTE_INSTRUMENTER_VERSION]: `v${VERSION}` }, // use [] to specify KEY is a variable
  };
  const tagResourcesCommand = new TagResourcesCommand(input);
  try {
    await client.send(tagResourcesCommand);
  } catch (error) {
    console.error("Error when tagging resources:", error);
  }
}
exports.tagResourcesWithSlsTag = tagResourcesWithSlsTag;

async function untagResourcesOfSlsTag(client, functionArns) {
  logger.log(
    `Removing tag '${DD_SLS_REMOTE_INSTRUMENTER_VERSION}' from function ARNs '${functionArns}'`,
  );
  if (functionArns.length === 0) {
    return;
  }
  const input = {
    ResourceARNList: functionArns,
    TagKeys: [DD_SLS_REMOTE_INSTRUMENTER_VERSION],
  };
  const untagResourcesCommand = new UntagResourcesCommand(input);
  try {
    await client.send(untagResourcesCommand);
  } catch (error) {
    console.error("Error untagging resources:", error);
  }
}
exports.untagResourcesOfSlsTag = untagResourcesOfSlsTag;
