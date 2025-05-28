const axios = require("axios");
const { account, ddSite, region } = require("../config.json");
const { getApiKey, getAppKey } = require("./datadog-keys");
const { sleep } = require("./sleep");

const remoteConfigIds = [];

const getRemoteConfig = async () => {
  const [apiKey, appKey] = await Promise.all([getApiKey(), getAppKey()]);

  const url =
    "https://{DD_SITE}/api/v2/remote_config/products/serverless_remote_instrumentation/config?filter%5Baws_account_id%5D={AWS_ACCOUNT_SLOT}&filter%5Bregion%5D={REGION_SLOT}"
      .replace("{DD_SITE}", ddSite)
      .replace("{AWS_ACCOUNT_SLOT}", account)
      .replace("{REGION_SLOT}", region);

  let remoteConfig;
  try {
    remoteConfig = await axios.get(url, {
      headers: {
        "dd-api-key": apiKey,
        "dd-application-key": appKey,
      },
    });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return { data: [] };
    }
    throw error;
  }
  remoteConfigIds.push(...remoteConfig.data.data.map((item) => item.id));
  return remoteConfig.data;
};

exports.getRemoteConfig = getRemoteConfig;

const setRemoteConfig = async ({
  waitForEventualConsistency = true,
  waitForCacheInvalidation = true,
  extensionVersion = 67,
  pythonLayerVersion = 99,
  nodeLayerVersion = 112,
  ddTraceEnabled = true,
  ddServerlessLogsEnabled = true,
  id,
} = {}) => {
  const [apiKey, appKey] = await Promise.all([getApiKey(), getAppKey()]);

  const rc = {
    data: {
      type: "instrumentation_config",
      attributes: {
        entity_type: "lambda",
        instrumentation_settings: {
          extension_version: extensionVersion,
          python_layer_version: pythonLayerVersion,
          node_layer_version: nodeLayerVersion,
          dd_trace_enabled: ddTraceEnabled,
          dd_serverless_logs_enabled: ddServerlessLogsEnabled,
        },
        priority: 1,
        rule_filters: [
          {
            key: "foo",
            values: ["bar"],
            filter_type: "tag",
            allow: true,
          },
        ],
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
    remoteConfig = await axios.put(`${url}/${id}`, rc, {
      headers: {
        "dd-api-key": apiKey,
        "dd-application-key": appKey,
      },
    });
  } else {
    remoteConfig = await axios.post(url, rc, {
      headers: {
        "dd-api-key": apiKey,
        "dd-application-key": appKey,
      },
    });
  }

  remoteConfigIds.push(remoteConfig.data.data.id);

  if (waitForCacheInvalidation) {
    // Wait 6 seconds for the cache to expire
    await sleep(6000);
  } else if (waitForEventualConsistency) {
    // Wait 2.5 seconds for config changes to be available to the instrumenter
    await sleep(2500);
  }

  return remoteConfig.data.data;
};

exports.setRemoteConfig = setRemoteConfig;

const deleteRemoteConfig = async (id) => {
  const [apiKey, appKey] = await Promise.all([getApiKey(), getAppKey()]);

  const url = `https://${ddSite}/api/v2/remote_config/products/serverless_remote_instrumentation/config/${id}`;

  return axios.delete(url, {
    headers: {
      "dd-api-key": apiKey,
      "dd-application-key": appKey,
    },
  });
};

exports.deleteRemoteConfig = deleteRemoteConfig;

const clearRemoteConfigs = async ({
  waitForEventualConsistency = false,
  waitForCacheInvalidation = false,
} = {}) => {
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

exports.clearRemoteConfigs = clearRemoteConfigs;

const clearKnownRemoteConfigs = async () => {
  const ids = new Set(remoteConfigIds);
  const results = [...ids].map((id) => deleteRemoteConfig(id));
  await Promise.all(results);
  while (remoteConfigIds.length) {
    remoteConfigIds.pop();
  }
};

exports.clearKnownRemoteConfigs = clearKnownRemoteConfigs;
