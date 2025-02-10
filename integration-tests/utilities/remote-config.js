const axios = require("axios");
const { account, region } = require("../config.json");
const { getApiKey, getAppKey } = require("./datadog-keys");
const { sleep } = require("./sleep");

const remoteConfigIds = [];

const getRemoteConfig = async () => {
  const [apiKey, appKey] = await Promise.all([getApiKey(), getAppKey()]);

  const url =
    "https://datad0g.com/api/unstable/remote_config/products/serverless_remote_instrumentation/config?filter%5Baws_account_id%5D={AWS_ACCOUNT_SLOT}&filter%5Bregion%5D={REGION_SLOT}"
      .replace("{AWS_ACCOUNT_SLOT}", account)
      .replace("{REGION_SLOT}", region);

  const remoteConfig = await axios.get(url, {
    headers: {
      "dd-api-key": apiKey,
      "dd-application-key": appKey,
    },
  });
  remoteConfigIds.push(...remoteConfig.data.data.map((item) => item.id));
  return remoteConfig.data;
};

exports.getRemoteConfig = getRemoteConfig;

const setRemoteConfig = async ({
  waitForEventualConsistency = true,
  extensionVersion = 67,
  pythonLayerVersion = 99,
  nodeLayerVersion = 112,
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

  const url =
    "https://datad0g.com/api/unstable/remote_config/products/serverless_remote_instrumentation/config";

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

  if (waitForEventualConsistency) {
    await sleep(2500);
  }
  return remoteConfig.data.data;
};

exports.setRemoteConfig = setRemoteConfig;

const deleteRemoteConfig = async (id) => {
  const [apiKey, appKey] = await Promise.all([getApiKey(), getAppKey()]);

  const url = `https://datad0g.com/api/unstable/remote_config/products/serverless_remote_instrumentation/config/${id}`;

  return axios.delete(url, {
    headers: {
      "dd-api-key": apiKey,
      "dd-application-key": appKey,
    },
  });
};

exports.deleteRemoteConfig = deleteRemoteConfig;

const clearRemoteConfigs = async () => {
  const rcs = await getRemoteConfig();
  const ids = rcs.data.map((item) => item.id);
  const results = ids.map((id) => deleteRemoteConfig(id));
  await Promise.all(results);
  while (remoteConfigIds.length) {
    remoteConfigIds.pop();
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
