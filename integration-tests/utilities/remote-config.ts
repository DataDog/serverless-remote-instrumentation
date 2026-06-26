import { account, ddSite, region } from "../config.json";
import { getApiKey, getAppKey } from "./datadog-keys";
import { sleep } from "./sleep";

const remoteConfigIds: string[] = [];

interface RemoteConfigData {
  data: any[];
}

const getRemoteConfig = async (): Promise<RemoteConfigData> => {
  const [apiKey, appKey] = await Promise.all([getApiKey(), getAppKey()]);

  const url =
    "https://{DD_SITE}/api/v2/remote_config/products/serverless_remote_instrumentation/config?filter%5Baws_account_id%5D={AWS_ACCOUNT_SLOT}"
      .replace("{DD_SITE}", ddSite)
      .replace("{AWS_ACCOUNT_SLOT}", account);

  const response = await fetch(url, {
    headers: {
      "dd-api-key": apiKey,
      "dd-application-key": appKey,
    },
  });
  if (response.status === 404) {
    return { data: [] };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  remoteConfigIds.push(...data.data.map((item: any) => item.id));
  return data;
};

interface SetRemoteConfigOptions {
  waitForEventualConsistency?: boolean;
  waitForCacheInvalidation?: boolean;
  extensionVersion?: number;
  pythonLayerVersion?: number;
  nodeLayerVersion?: number;
  dotnetLayerVersion?: number;
  rubyLayerVersion?: number;
  javaLayerVersion?: number;
  ruleFilters?: any[];
  ddTraceEnabled?: boolean;
  ddServerlessLogsEnabled?: boolean;
  id?: string;
}

const setRemoteConfig = async ({
  waitForEventualConsistency = true,
  waitForCacheInvalidation = true,
  extensionVersion = 67,
  pythonLayerVersion = 99,
  nodeLayerVersion = 112,
  dotnetLayerVersion = 23,
  rubyLayerVersion = 27,
  javaLayerVersion = 25,
  ruleFilters = [
    {
      key: "foo",
      values: ["bar"],
      filter_type: "tag",
      allow: true,
    },
  ],
  ddTraceEnabled = true,
  ddServerlessLogsEnabled = true,
  id,
}: SetRemoteConfigOptions = {}): Promise<any> => {
  const [apiKey, appKey] = await Promise.all([getApiKey(), getAppKey()]);

  const instrumentation_settings: any = {
    dd_trace_enabled: ddTraceEnabled,
    dd_serverless_logs_enabled: ddServerlessLogsEnabled,
  };

  // Only include version fields if they are not explicitly undefined
  if (extensionVersion !== undefined) {
    instrumentation_settings.extension_version = extensionVersion;
  }
  if (pythonLayerVersion !== undefined) {
    instrumentation_settings.python_layer_version = pythonLayerVersion;
  }
  if (nodeLayerVersion !== undefined) {
    instrumentation_settings.node_layer_version = nodeLayerVersion;
  }
  if (dotnetLayerVersion !== undefined) {
    instrumentation_settings.dotnet_layer_version = dotnetLayerVersion;
  }
  if (rubyLayerVersion !== undefined) {
    instrumentation_settings.ruby_layer_version = rubyLayerVersion;
  }
  if (javaLayerVersion !== undefined) {
    instrumentation_settings.java_layer_version = javaLayerVersion;
  }

  const rc: any = {
    data: {
      type: "instrumentation_config",
      attributes: {
        entity_type: "lambda",
        instrumentation_settings,
        priority: 1,
        rule_filters: ruleFilters,
      },
      meta: {
        scopes: [
          {
            aws_account_id: account,
            regions: [region],
          },
        ],
      },
    },
  };

  const url = `https://${ddSite}/api/v2/remote_config/products/serverless_remote_instrumentation/config`;

  let remoteConfig;
  if (id) {
    rc.data.id = id;
    const response = await fetch(`${url}/${id}`, {
      method: "PUT",
      headers: {
        "dd-api-key": apiKey,
        "dd-application-key": appKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rc),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    remoteConfig = await response.json();
  } else {
    const existing = await getRemoteConfig();
    if (existing.data.length > 0) {
      const existingId = existing.data[0].id;
      rc.data.id = existingId;
      const response = await fetch(`${url}/${existingId}`, {
        method: "PUT",
        headers: {
          "dd-api-key": apiKey,
          "dd-application-key": appKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(rc),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      remoteConfig = await response.json();
    } else {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "dd-api-key": apiKey,
          "dd-application-key": appKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(rc),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      remoteConfig = await response.json();
    }
  }

  remoteConfigIds.push(remoteConfig.data.id);

  if (waitForCacheInvalidation) {
    // Wait 6 seconds for the cache to expire
    await sleep(6000);
  } else if (waitForEventualConsistency) {
    // Wait 2.5 seconds for config changes to be available to the instrumenter
    await sleep(2500);
  }

  return remoteConfig.data;
};

const deleteRemoteConfig = async (id: string): Promise<any> => {
  const [apiKey, appKey] = await Promise.all([getApiKey(), getAppKey()]);

  const url = `https://${ddSite}/api/v2/remote_config/products/serverless_remote_instrumentation/config/${id}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "dd-api-key": apiKey,
      "dd-application-key": appKey,
    },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
};

interface ClearRemoteConfigsOptions {
  waitForEventualConsistency?: boolean;
  waitForCacheInvalidation?: boolean;
}

const clearRemoteConfigs = async ({
  waitForEventualConsistency = false,
  waitForCacheInvalidation = false,
}: ClearRemoteConfigsOptions = {}): Promise<void> => {
  const rcs = await getRemoteConfig();
  const ids = rcs.data.map((item) => item.id);
  const results = ids.map((id) => deleteRemoteConfig(id));
  await Promise.all(results);
  while (remoteConfigIds.length) {
    remoteConfigIds.pop();
  }
  if (waitForCacheInvalidation) {
    await sleep(6000);
  } else if (waitForEventualConsistency) {
    await sleep(2500);
  }
};

const clearKnownRemoteConfigs = async (): Promise<void> => {
  const ids = new Set(remoteConfigIds);
  const results = [...ids].map((id) => deleteRemoteConfig(id));
  await Promise.all(results);
  while (remoteConfigIds.length) {
    remoteConfigIds.pop();
  }
};

export {
  getRemoteConfig,
  setRemoteConfig,
  deleteRemoteConfig,
  clearRemoteConfigs,
  clearKnownRemoteConfigs,
};
