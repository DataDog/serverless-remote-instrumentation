import axios from "axios";
import { logger } from "./logger";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  NoSuchKey,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import crypto from "crypto";
import {
  ENTITY_TYPES,
  FILTER_TYPES,
  RC_PRODUCT,
  REMOTE_CONFIG_URL,
  CONFIG_HASH_KEY,
  CONFIG_CACHE_TTL_MS,
  CONFIG_STATUS_EXPIRED,
  SUPPORTED_RUNTIME_CONFIGURATIONS,
} from "./consts";
import { getApplyState } from "./apply-state";
import { sleep } from "./sleep";

interface RuleFilter {
  key: string;
  values: string[];
  allow: boolean;
  filterType: string;
}

interface ConfigMeta {
  custom?: {
    v?: number;
  };
}

interface ConfigJSON {
  config_version: number;
  entity_type: string;
  instrumentation_settings?: {
    node_layer_version?: number;
    python_layer_version?: number;
    extension_version?: number;
    dd_trace_enabled?: boolean;
    dd_serverless_logs_enabled?: boolean;
  };
  priority: number;
  rule_filters: Array<{
    key: string;
    values: string[];
    allow: boolean;
    filter_type: string;
  }>;
}

interface ConfigCache {
  configs: RcConfig[] | null;
  expirationTime: number | null;
}

// Initialize config cache
export const CONFIG_CACHE: ConfigCache = {
  configs: null,
  expirationTime: null,
};

export class RcConfig {
  configID!: string;
  rcConfigVersion!: number;
  configVersion!: number;
  entityType!: string;
  extensionVersion?: number;
  ddTraceEnabled?: boolean;
  ddServerlessLogsEnabled?: boolean;
  priority!: number;
  ruleFilters!: RuleFilter[];
  awsAccountId?: string;
  awsRegion?: string;
  instrumenterFunctionName?: string;
  [key: string]: any;

  constructor(
    configID: string,
    configJSON: ConfigJSON,
    configMeta: ConfigMeta,
  ) {
    this.setConfigID(configID);
    this.setRcConfigVersion(configMeta.custom?.v);
    this.setConfigVersion(configJSON.config_version);
    this.setEntityType(configJSON.entity_type);

    Object.values(SUPPORTED_RUNTIME_CONFIGURATIONS).forEach((config: any) => {
      this.setField(
        config.configField,
        config.getFromJsonConfig(configJSON),
        "number",
        true,
      );
    });
    this.setExtensionVersion(
      configJSON.instrumentation_settings?.extension_version,
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

  configurationError(message: string): Error {
    logger.error(message);
    return Error(`Received invalid configuration: ${message}`);
  }

  setConfigID(configID: any): void {
    if (typeof configID === "string") {
      this.configID = configID;
    } else {
      throw this.configurationError(
        `config ID must be a string, but received '${configID}'`,
      );
    }
  }

  setRcConfigVersion(rcConfigVersion: any): void {
    if (typeof rcConfigVersion === "number") {
      this.rcConfigVersion = rcConfigVersion;
    } else {
      throw this.configurationError(
        `rc config version must be a number, but received '${rcConfigVersion}'`,
      );
    }
  }

  setConfigVersion(configVersion: any): void {
    if (typeof configVersion === "number") {
      this.configVersion = configVersion;
    } else {
      throw this.configurationError(
        `config version must be a number, but received '${configVersion}'`,
      );
    }
  }

  setEntityType(entityType: any): void {
    if (typeof entityType === "string" && ENTITY_TYPES.has(entityType)) {
      this.entityType = entityType;
    } else {
      throw this.configurationError(
        `entity type must be one of '${Array.from(ENTITY_TYPES).join(", ")}', but received '${entityType}'`,
      );
    }
  }

  setField(
    field: string,
    value: any,
    type: string,
    allowUndefined = false,
  ): void {
    if ((allowUndefined && value === undefined) || typeof value === type) {
      this[field] = value;
    } else {
      throw this.configurationError(
        `${field} must be a ${type}, but received '${value}'`,
      );
    }
  }

  setExtensionVersion(extensionVersion: any): void {
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

  setDDTraceEnabled(ddTraceEnabled: any): void {
    if (ddTraceEnabled === undefined || typeof ddTraceEnabled === "boolean") {
      this.ddTraceEnabled = ddTraceEnabled;
    } else {
      throw this.configurationError(
        `ddTraceEnabled must be a boolean, but received '${ddTraceEnabled}'`,
      );
    }
  }

  setDDServerlessLogsEnabled(ddServerlessLogsEnabled: any): void {
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

  setPriority(priority: any): void {
    if (typeof priority === "number") {
      this.priority = priority;
    } else {
      throw this.configurationError(
        `priority must be a number, but received '${priority}'`,
      );
    }
  }

  setRuleFilters(ruleFilters: any): void {
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

async function getConfigsFromRC(
  s3Client: any,
  accountID: string,
  region: string,
): Promise<RcConfig[]> {
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

  let configs: RcConfig[] = [];
  await axios
    .post(REMOTE_CONFIG_URL, payload)
    .then(function handleResponse(response: any) {
      configs = getConfigsFromResponse(response);
    })
    .catch(function handleError(error: any) {
      logger.error(error);
      throw new Error("Failed to retrieve configs");
    });

  if (configs.length === 0) {
    logger.logObject(payload);
  }
  return configs;
}

function getConfigsFromResponse(response: any): RcConfig[] {
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
    (acc: any, targetFile: any) => ({
      ...acc,
      [targetFile.path]: targetFile.raw ?? undefined,
    }),
    {},
  );
  const configPaths = response.data.client_configs ?? [];
  let parsedConfigFiles: RcConfig[] = [];
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
    } catch (e: any) {
      throw new Error("Error parsing configs: " + e.message);
    }
  }
  if (parsedConfigFiles.length === 0) {
    logger.warn(
      `No configs found in response '${JSON.stringify(response.data)}'`,
    );
  }
  return parsedConfigFiles;
}
export { getConfigsFromResponse };

export async function getConfigs(
  s3Client: any,
  context: any,
): Promise<RcConfig[]> {
  if (isCacheValid()) {
    return CONFIG_CACHE.configs!;
  }

  const awsAccountId = context.invokedFunctionArn?.split(":")[4];
  const awsRegion = process.env.AWS_REGION;
  if (!awsAccountId || !awsRegion) {
    logger.error(
      `AWS account ID and/or region is missing. awsAccountId: ${awsAccountId}, awsRegion: ${awsRegion}`,
    );
    throw new Error("Failed to retrieve configs.");
  }
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

export async function configHasChanged(
  client: any,
  configs: RcConfig[],
): Promise<boolean> {
  const newConfigHash = crypto
    .createHash("sha256", "datadog-remote-instrumenter" as any)
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
    if (configChanged && configs.length === 0) {
      logger.warn(
        `Instrumentation configuration has been fully removed since the last scheduled invocation.`,
      );
    }
    return configChanged;
  } catch (caught: any) {
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

export async function getConfigsWithRetry(
  s3Client: any,
  context: any,
): Promise<{ configs: RcConfig[]; configChanged: boolean }> {
  let configs = await getConfigs(s3Client, context);
  let configChanged = await configHasChanged(s3Client, configs);

  // If we detect a config change and newly receive no configs, retry fetching configs up to 2 more times
  let retryCount = 0;
  const maxRetries = 2;
  while (configChanged && configs.length === 0 && retryCount < maxRetries) {
    retryCount++;
    logger.log(
      `Config changed but no configs found. Retrying attempt ${retryCount}/${maxRetries}`,
    );

    // Wait for the cache TTL so that we don't exhaust our cache bypass limit
    await sleep(CONFIG_CACHE_TTL_MS);
    configs = await getConfigs(s3Client, context);
    configChanged = await configHasChanged(s3Client, configs);

    // Stop retrying if we now have configs
    if (configs.length > 0) {
      logger.log(
        `Found ${configs.length} configs on retry attempt ${retryCount}`,
      );
      break;
    }
  }
  return { configs, configChanged };
}

export async function updateConfigHash(
  client: any,
  configs: RcConfig[],
): Promise<void> {
  const newConfigHash = crypto
    .createHash("sha256", "datadog-remote-instrumenter" as any)
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
  } catch (caught: any) {
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

export async function deleteConfigHash(client: any): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: process.env.DD_S3_BUCKET,
    Key: CONFIG_HASH_KEY,
  });
  await client.send(command);
}

export function isCacheValid(): boolean {
  return (
    CONFIG_CACHE.configs !== null &&
    CONFIG_CACHE.expirationTime !== null &&
    Date.now() < CONFIG_CACHE.expirationTime
  );
}

export function updateCache(configs: RcConfig[]): void {
  CONFIG_CACHE.configs = configs;
  CONFIG_CACHE.expirationTime = Date.now() + CONFIG_CACHE_TTL_MS;
}
