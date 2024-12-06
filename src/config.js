const axios = require("axios");

const REMOTE_CONFIG_PRODUCT = "SERVERLESS_REMOTE_INSTRUMENTATION";
const REMOTE_CONFIG_URL = "http://localhost:8126/v0.7/config";

const ENTITY_TYPES = new Set(["lambda"]);
const FILTER_TYPES = new Set(["function_name", "tag"]);

// RcConfig represents a serverless remote instrumentation configuration file

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
    return Error("Received invalid configuration: " + message);
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

exports.getConfigsFromRC = async function (accountID, region) {
  payload = {
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
      console.log(error);
      throw new Error("Failed to retrieve configs");
    });
  return configs;
};

function getConfigsFromResponse(response) {
  if (!response.data) {
    throw new Error("Failed to retrieve configs");
  }
  const targetFiles = response.data.target_files ?? [];
  let parsedConfigFiles = [];
  for (config of targetFiles) {
    if (!config.raw) {
      throw new Error("Error parsing configs");
    }

    const rcConfig = new RcConfig(JSON.parse(atob(config.raw)));
    parsedConfigFiles.push(rcConfig);
  }
  return parsedConfigFiles;
}

// Adapt rule filters into the format currently used by the extension. This will be removed once the instrumenter
// targeting logic is updated.
exports.adaptToOldRuleFormat = function (rcConfigs) {
  let legacyConfig = {
    allowList: [],
    denyList: [],
    tagRule: [],
    extensionVersion: undefined,
    pythonLayerVersion: undefined,
    nodeLayerVersion: undefined,
  };
  let rcConfig;
  if (rcConfigs && rcConfigs.length) {
    rcConfig = rcConfigs[0];
  } else {
    return legacyConfig;
  }
  legacyConfig.extensionVersion = rcConfig.extensionVersion;
  legacyConfig.pythonLayerVersion = rcConfig.pythonLayerVersion;
  legacyConfig.nodeLayerVersion = rcConfig.nodeLayerVersion;

  const filters = rcConfig.ruleFilters ?? [];
  for (filter of filters) {
    if (filter.filterType === "function_name") {
      if (filter.allow) {
        for (value of filter.values) {
          legacyConfig.allowList.push(value);
        }
      } else {
        for (value of filter.values) {
          legacyConfig.denyList.push(value);
        }
      }
    } else if (filter.filterType === "tag") {
      if (filter.allow) {
        for (value of filter.values) {
          legacyConfig.tagRule.push(filter.key + ":" + value);
        }
      }
    }
  }

  if (
    legacyConfig.tagRule.length == 0 &&
    legacyConfig.allowList.length == 0 &&
    legacyConfig.denyList.length == 0
  ) {
    legacyConfig.denyList = "*";
  }

  return legacyConfig;
};
