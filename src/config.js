const axios = require("axios");
const { logger } = require("./logger");
const {
  GetObjectCommand,
  PutObjectCommand,
  NoSuchKey,
  S3ServiceException,
} = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const { ENTITY_TYPES, FILTER_TYPES } = require("./consts");

const REMOTE_CONFIG_PRODUCT = "SERVERLESS_REMOTE_INSTRUMENTATION";
const REMOTE_CONFIG_URL = "http://localhost:8126/v0.7/config";

class RcConfig {
  constructor(configJSON) {
    this.setConfigVersion(configJSON.config_version);
    this.setEntityType(configJSON.entity_type);
    this.setExtensionVersion(
      configJSON.instrumentation_settings?.extension_version,
    );
    this.setNodeLayerVersion(
      configJSON.instrumentation_settings?.node_layer_version,
    );
    this.setPythonLayerVersion(
      configJSON.instrumentation_settings?.python_layer_version,
    );
    this.setPriority(configJSON.priority);
    this.setRuleFilters(configJSON.rule_filters);
  }

  configurationError(message) {
    console.error(message);
    return Error(`Received invalid configuration: ${message}`);
  }

  setConfigVersion(configVersion) {
    if (typeof configVersion === "number") {
      this.configVersion = configVersion;
    } else {
      throw this.configurationError("config version must be a number");
    }
  }

  setEntityType(entityType) {
    if (typeof entityType === "string" && ENTITY_TYPES.has(entityType)) {
      this.entityType = entityType;
    } else {
      throw this.configurationError(
        `entity type must be one of '${Array.from(ENTITY_TYPES).join(", ")}', but received '${entityType}'`,
      );
    }
  }

  setExtensionVersion(extensionVersion) {
    if (
      extensionVersion === undefined ||
      typeof extensionVersion === "number"
    ) {
      this.extensionVersion = extensionVersion;
    } else {
      throw this.configurationError("extension version must be a number");
    }
  }

  setNodeLayerVersion(nodeLayerVersion) {
    if (
      nodeLayerVersion === undefined ||
      typeof nodeLayerVersion === "number"
    ) {
      this.nodeLayerVersion = nodeLayerVersion;
    } else {
      throw this.configurationError("node layer version must be a number");
    }
  }

  setPythonLayerVersion(pythonLayerVersion) {
    if (
      pythonLayerVersion === undefined ||
      typeof pythonLayerVersion === "number"
    ) {
      this.pythonLayerVersion = pythonLayerVersion;
    } else {
      throw this.configurationError("python layer version must be a number");
    }
  }

  setPriority(priority) {
    if (typeof priority === "number") {
      this.priority = priority;
    } else {
      throw this.configurationError("priority must be a number");
    }
  }

  setRuleFilters(ruleFilters) {
    if (Array.isArray(ruleFilters)) {
      const processedFilters = ruleFilters.map((filter) => ({
        key: filter.key,
        values: filter.values,
        allow: filter.allow,
        filterType: filter.filter_type,
      }));
      for (const filter of processedFilters) {
        if (typeof filter.key !== "string") {
          throw this.configurationError(
            "rule filter key field must be a string",
          );
        }
        if (!Array.isArray(filter.values) || filter.values.length === 0) {
          throw this.configurationError(
            "rule filter values field must be a non-empty array",
          );
        }
        if (typeof filter.allow !== "boolean") {
          throw this.configurationError(
            "rule filter allow field must be a boolean",
          );
        }
        const filterType = filter.filterType;
        if (typeof filterType !== "string" || !FILTER_TYPES.has(filterType)) {
          throw this.configurationError(
            `filterType field must be one of '${Array.from(FILTER_TYPES).join(", ")}', but received '${filterType}'`,
          );
        }
      }
      this.ruleFilters = processedFilters;
    } else {
      throw this.configurationError("rule filters must be an array");
    }
  }
}
exports.RcConfig = RcConfig;

async function getConfigsFromRC(accountID, region) {
  const payload = {
    client: {
      state: {
        root_version: 1,
        targets_version: 0,
      },
      id: crypto.randomUUID(),
      products: [REMOTE_CONFIG_PRODUCT],
      is_tracer: true,
      client_tracer: {
        runtime_id: "",
        language: "javascript",
        tracer_version: "1.0.0",
        service: "dd-remote-instrumenter-lambda",
        env: "",
        app_version: "1.0.0",
        extra_services: [],
        tags: ["aws_account_id:" + accountID, "region:" + region],
      },
      capabilities: "",
    },
    cached_target_files: [],
  };

  let configs = [];
  await axios
    .post(REMOTE_CONFIG_URL, payload)
    .then(function (response) {
      configs = getConfigsFromResponse(response);
    })
    .catch(function (error) {
      logger.log(error);
      throw new Error("Failed to retrieve configs");
    });
  return configs;
}

function getConfigsFromResponse(response) {
  if (!response.data) {
    throw new Error("Failed to retrieve configs");
  }
  const targetFiles = response.data.target_files ?? [];
  let parsedConfigFiles = [];
  for (const targetFile of targetFiles) {
    if (!targetFile.raw) {
      throw new Error("Error retrieving raw data from configs");
    }
    try {
      const rcConfig = new RcConfig(JSON.parse(atob(targetFile.raw)));
      parsedConfigFiles.push(rcConfig);
    } catch (e) {
      throw new Error("Error parsing configs");
    }
  }
  return parsedConfigFiles;
}
exports.getConfigsFromResponse = getConfigsFromResponse;

async function getConfigs(context) {
  const awsAccountId = context.invokedFunctionArn.split(":")[4];
  const awsRegion = process.env.AWS_REGION;
  const instrumenterFunctionName = process.env.DD_INSTRUMENTER_FUNCTION_NAME;
  const minimumMemorySize = process.env.DD_MinimumMemorySize;
  const configsFromRC = await getConfigsFromRC(awsAccountId, awsRegion);
  for (const config of configsFromRC) {
    config.awsAccountId = awsAccountId;
    config.awsRegion = awsRegion;
    config.instrumenterFunctionName = instrumenterFunctionName;
    config.minimumMemorySize = minimumMemorySize;
  }
  logger.logObject({ ...configsFromRC, ...{ eventName: "getConfigs" } });
  return configsFromRC;
}
exports.getConfigs = getConfigs;

async function configHasChanged(client, configs) {
  const newConfigHash = crypto
    .createHash("sha256", "datadog-remote-instrumenter")
    .update(JSON.stringify(configs))
    .digest("hex");
  const bucketName = process.env.DD_S3_BUCKET;
  const key = "config.txt";
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );
    const oldConfigHash = await response.Body.transformToString();
    const configChanged = oldConfigHash !== newConfigHash;
    logger.log(
      `Instrumentation configuration ${configChanged ? "has" : "has not"} changed since last scheduled invocation.`,
    );
    return configChanged;
  } catch (caught) {
    if (caught instanceof NoSuchKey) {
      console.error(
        `Error from S3 while getting object "${key}" from "${bucketName}". No such key exists.`,
      );
      return true;
    } else if (caught instanceof S3ServiceException) {
      console.error(
        `Error from S3 while getting object from ${bucketName}.  ${caught.name}: ${caught.message}`,
      );
      return false;
    } else {
      console.error(caught.message);
      throw caught;
    }
  }
}
exports.configHasChanged = configHasChanged;

async function updateConfigHash(client, configs) {
  const newConfigHash = crypto
    .createHash("sha256", "datadog-remote-instrumenter")
    .update(JSON.stringify(configs))
    .digest("hex");
  const bucketName = process.env.DD_S3_BUCKET;
  const key = "config.txt";
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: newConfigHash,
  });

  try {
    await client.send(command);
    logger.log(`Updated config hash with new instrumentation config.`);
  } catch (caught) {
    if (caught instanceof S3ServiceException) {
      console.error(
        `Error from S3 while uploading object to ${bucketName}.  ${caught.name}: ${caught.message}`,
      );
    } else {
      console.error(caught.message);
      throw caught;
    }
  }
}
exports.updateConfigHash = updateConfigHash;
