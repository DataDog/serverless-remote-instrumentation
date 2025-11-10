import {
  TagResourcesCommand,
  UntagResourcesCommand,
} from "@aws-sdk/client-resource-groups-tagging-api";
import { DD_SLS_REMOTE_INSTRUMENTER_VERSION, VERSION } from "./consts";
import { logger } from "./logger";

async function tagBatch(
  client: any,
  functionArns: string[],
  operationName: string,
  createCommand: (batch: string[]) => any,
): Promise<any[]> {
  if (functionArns.length === 0) {
    return [];
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

  const results = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const command = createCommand(batch);
    try {
      results.push(await client.send(command));
      logger.log(
        `Successfully processed batch ${i + 1}/${batches.length} (${batch.length} resources) for ${operationName}`,
      );
    } catch (error) {
      logger.error(
        `Error processing resources in batch ${i + 1}/${batches.length} for ${operationName}: ${error}`,
      );
    }
  }

  return results;
}

const applyFunctionTags = async (
  client: any,
  functionArns: string[],
  operationName: string,
  createCommand: (batch: string[]) => any,
): Promise<void> => {
  let tries = 0;
  let functionsToTag = [...functionArns];
  while (functionsToTag.length > 0 && tries < 3) {
    tries++;
    const results = await tagBatch(
      client,
      functionsToTag,
      operationName,
      createCommand,
    );

    functionsToTag = results
      .flatMap((result) =>
        Object.entries(result.FailedResourcesMap || {}).filter(
          ([, value]: [string, any]) =>
            value.ErrorCode !== "InvalidParameterException",
        ),
      )
      .map(([key]) => key);

    if (functionsToTag.length > 0) {
      logger.log(`Retrying tagging on ${functionsToTag.length} functions`);
    }
  }
  if (functionsToTag.length > 0) {
    throw new Error(
      `Failed to process ${functionsToTag.length} resources after 3 tries ${JSON.stringify(
        functionsToTag,
      )}`,
    );
  }
};

export async function tagResourcesWithSlsTag(
  client: any,
  functionArns: string[],
): Promise<void> {
  logger.log(
    `Tagging function ARNs '${functionArns}' with tag '${DD_SLS_REMOTE_INSTRUMENTER_VERSION}'`,
  );

  const createTagCommand = (batch: string[]) => {
    const input = {
      ResourceARNList: batch,
      Tags: { [DD_SLS_REMOTE_INSTRUMENTER_VERSION]: `v${VERSION}` }, // use [] to specify KEY is a variable
    };
    return new TagResourcesCommand(input);
  };

  await applyFunctionTags(client, functionArns, "tagging", createTagCommand);
}

export async function untagResourcesOfSlsTag(
  client: any,
  functionArns: string[],
): Promise<void> {
  logger.log(
    `Removing tag '${DD_SLS_REMOTE_INSTRUMENTER_VERSION}' from function ARNs '${functionArns}'`,
  );

  const createUntagCommand = (batch: string[]) => {
    const input = {
      ResourceARNList: batch,
      TagKeys: [DD_SLS_REMOTE_INSTRUMENTER_VERSION],
    };
    return new UntagResourcesCommand(input);
  };

  await applyFunctionTags(
    client,
    functionArns,
    "untagging",
    createUntagCommand,
  );
}

export { applyFunctionTags };
