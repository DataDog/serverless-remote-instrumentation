const axios = require("axios");
const { GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { account, region } = require("../config.json");

const getRemoteConfig = async (secretsClient) => {
  const requests = [
    "Remote_Instrumenter_Test_API_Key",
    "Remote_Instrumenter_Test_APPLICATION_Key",
  ].map(async (name) => {
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: name,
      }),
    );
    return response.SecretString;
  });

  const [apiKey, appKey] = await Promise.all(requests);

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
  return remoteConfig.data;
};

exports.getRemoteConfig = getRemoteConfig;
