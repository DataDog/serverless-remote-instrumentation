const axios = require("axios");
const { logger } = require("./logger");
const {
  GetObjectCommand,
  PutObjectCommand,
  NoSuchKey,
  S3ServiceException,
} = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const {
  ENTITY_TYPES,
  FILTER_TYPES,
  RC_PRODUCT,
  REMOTE_CONFIG_URL,
  CONFIG_HASH_KEY,
  CONFIG_CACHE_TTL_MS,
  CONFIG_STATUS_EXPIRED,
} = require("./consts");
const { getApplyState } = require("./apply-state");

// Initialize config cache
const CONFIG_CACHE = {
  configs: null,
  expirationTime: null,
};
exports.CONFIG_CACHE = CONFIG_CACHE;

class RcConfig {
  constructor(configID, configJSON, configMeta) {
    this.setConfigID(configID);
    this.setRcConfigVersion(configMeta.custom?.v);
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
    this.setDDTraceEnabled(
      configJSON.instrumentation_settings?.dd_trace_enabled,
    );
    this.setDDServerlessLogsEnabled(
      configJSON.instrumentation_settings?.dd_serverless_logs_enabled,
    );
    this.setPriority(configJSON.priority);
    this.setRuleFilters(configJSON.rule_filters);
  }

  configurationError(message) {
    logger.error(message);
    return Error(`Received invalid configuration: ${message}`);
  }

  setConfigID(configID) {
    if (typeof configID === "string") {
      this.configID = configID;
    } else {
      throw this.configurationError(
        `config ID must be a string, but received '${configID}'`,
      );
    }
  }

  setRcConfigVersion(rcConfigVersion) {
    if (typeof rcConfigVersion === "number") {
      this.rcConfigVersion = rcConfigVersion;
    } else {
      throw this.configurationError(
        `rc config version must be a number, but received '${rcConfigVersion}'`,
      );
    }
  }

  setConfigVersion(configVersion) {
    if (typeof configVersion === "number") {
      this.configVersion = configVersion;
    } else {
      throw this.configurationError(
        `config version must be a number, but received '${configVersion}'`,
      );
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
      throw this.configurationError(
        `extension version must be a number, but received '${extensionVersion}'`,
      );
    }
  }

  setNodeLayerVersion(nodeLayerVersion) {
    if (
      nodeLayerVersion === undefined ||
      typeof nodeLayerVersion === "number"
    ) {
      this.nodeLayerVersion = nodeLayerVersion;
    } else {
      throw this.configurationError(
        `node layer version must be a number, but received '${nodeLayerVersion}'`,
      );
    }
  }

  setPythonLayerVersion(pythonLayerVersion) {
    if (
      pythonLayerVersion === undefined ||
      typeof pythonLayerVersion === "number"
    ) {
      this.pythonLayerVersion = pythonLayerVersion;
    } else {
      throw this.configurationError(
        `python layer version must be a number, but received '${pythonLayerVersion}'`,
      );
    }
  }

  setDDTraceEnabled(ddTraceEnabled) {
    if (ddTraceEnabled === undefined || typeof ddTraceEnabled === "boolean") {
      this.ddTraceEnabled = ddTraceEnabled;
    } else {
      throw this.configurationError(
        `ddTraceEnabled must be a boolean, but received '${ddTraceEnabled}'`,
      );
    }
  }

  setDDServerlessLogsEnabled(ddServerlessLogsEnabled) {
    if (
      ddServerlessLogsEnabled === undefined ||
      typeof ddServerlessLogsEnabled === "boolean"
    ) {
      this.ddServerlessLogsEnabled = ddServerlessLogsEnabled;
    } else {
      throw this.configurationError(
        `ddServerlessLogsEnabled must be a boolean, but received '${ddServerlessLogsEnabled}'`,
      );
    }
  }

  setPriority(priority) {
    if (typeof priority === "number") {
      this.priority = priority;
    } else {
      throw this.configurationError(
        `priority must be a number, but received '${priority}'`,
      );
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
            `rule filter key field must be a string, but received '${filter.key}'`,
          );
        }
        if (!Array.isArray(filter.values) || filter.values.length === 0) {
          throw this.configurationError(
            `rule filter values field must be a non-empty array, but received '${filter.values}'`,
          );
        }
        if (typeof filter.allow !== "boolean") {
          throw this.configurationError(
            `rule filter allow field must be a boolean, but received '${filter.allow}'`,
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
      throw this.configurationError(
        `rule filters must be an array, but received '${ruleFilters}'`,
      );
    }
  }
}
exports.RcConfig = RcConfig;

async function getConfigsFromRC(s3Client, accountID, region) {
  const applyState = await getApplyState(s3Client);
  const payload = {
    client: {
      state: {
        root_version: 1,
        targets_version: 0,
        config_states: applyState,
      },
      id: crypto.randomUUID(),
      products: [RC_PRODUCT],
      is_tracer: true,
      client_tracer: {
        runtime_id: "",
        language: "node",
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
    .then(function handleResponse(response) {
      configs = getConfigsFromResponse(response);
    })
    .catch(function handleError(error) {
      logger.error(error);
      throw new Error("Failed to retrieve configs");
    });
  return configs;
}

function getConfigsFromResponse(response) {
  if (!response.data) {
    throw new Error("Failed to retrieve configs");
  }
  // If the config is expired, throw an error
  if (response.data.config_status === CONFIG_STATUS_EXPIRED) {
    throw new Error("Config is expired");
  }

  // Map path to config for each target file
  const targetFiles = response.data.target_files ?? [];
  const targetFileMapping = targetFiles.reduce(
    (acc, targetFile) => ({
      ...acc,
      [targetFile.path]: targetFile.raw ?? undefined,
    }),
    {},
  );
  const configPaths = response.data.client_configs ?? [];
  let parsedConfigFiles = [];
  // For each config path, find the config data and signed target metadata
  for (const configPath of configPaths) {
    // Find the target file or error if not found
    if (!(configPath in targetFileMapping)) {
      throw new Error(
        `Error parsing configs: target file not found for config path '${configPath}'`,
      );
    }
    const targetFile = targetFileMapping[configPath];
    // Find the metadata or error if not found
    if (!response.data.targets) {
      throw new Error("Error parsing configs: targets not found");
    }
    const signedTargets = JSON.parse(atob(response.data.targets)).signed
      ?.targets;
    if (!(configPath in signedTargets)) {
      throw new Error(
        `Error parsing configs: signed target data not found for config path '${configPath}'`,
      );
    }
    const configMeta = signedTargets[configPath];

    try {
      const rcConfig = new RcConfig(
        configPath.split("/")[3],
        JSON.parse(atob(targetFile)),
        configMeta,
      );
      parsedConfigFiles.push(rcConfig);
    } catch (e) {
      throw new Error("Error parsing configs: " + e.message);
    }
  }
  return parsedConfigFiles;
}
exports.getConfigsFromResponse = getConfigsFromResponse;

async function getConfigs(s3Client, context) {
  if (isCacheValid()) {
    return CONFIG_CACHE.configs;
  }

  const awsAccountId = context.invokedFunctionArn.split(":")[4];
  const awsRegion = process.env.AWS_REGION;
  const instrumenterFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  const configsFromRC = await getConfigsFromRC(
    s3Client,
    awsAccountId,
    awsRegion,
  );
  for (const config of configsFromRC) {
    config.awsAccountId = awsAccountId;
    config.awsRegion = awsRegion;
    config.instrumenterFunctionName = instrumenterFunctionName;
  }
  logger.logObject({
    ...configsFromRC.map((config) => {
      return {
        configID: config.configID,
        rcConfigVersion: config.rcConfigVersion,
      };
    }),
    eventName: "getConfigs",
  });

  updateCache(configsFromRC);

  return configsFromRC;
}
exports.getConfigs = getConfigs;

async function configHasChanged(client, configs) {
  const newConfigHash = crypto
    .createHash("sha256", "datadog-remote-instrumenter")
    .update(JSON.stringify(configs))
    .digest("hex");
  const bucketName = process.env.DD_S3_BUCKET;
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: CONFIG_HASH_KEY,
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
      logger.error(
        `Error from S3 while getting object "${CONFIG_HASH_KEY}" from "${bucketName}". No such key exists.`,
      );
      return true;
    } else if (caught instanceof S3ServiceException) {
      logger.error(
        `Error from S3 while getting object from ${bucketName}.  ${caught.name}: ${caught.message}`,
      );
      return false;
    } else {
      logger.error(caught.message);
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
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: CONFIG_HASH_KEY,
    Body: newConfigHash,
  });

  try {
    await client.send(command);
    logger.log(`Updated config hash with new instrumentation config.`);
  } catch (caught) {
    if (caught instanceof S3ServiceException) {
      logger.error(
        `Error from S3 while uploading object to ${bucketName}.  ${caught.name}: ${caught.message}`,
      );
    } else {
      logger.error(caught.message);
      throw caught;
    }
  }
}
exports.updateConfigHash = updateConfigHash;

function isCacheValid() {
  return (
    CONFIG_CACHE.configs !== null &&
    CONFIG_CACHE.expirationTime !== null &&
    Date.now() < CONFIG_CACHE.expirationTime
  );
}
exports.isCacheValid = isCacheValid;

function updateCache(configs) {
  CONFIG_CACHE.configs = configs;
  CONFIG_CACHE.expirationTime = Date.now() + CONFIG_CACHE_TTL_MS;
}
exports.updateCache = updateCache;
