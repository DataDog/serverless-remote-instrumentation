const { GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { getSecretsManagerClient } = require("./aws-resources");
const { apiSecretName, appSecretName } = require("../config.json");

const getSecret = async (name) => {
  const secretsManager = await getSecretsManagerClient();
  const response = await secretsManager.send(
    new GetSecretValueCommand({
      SecretId: name,
    }),
  );
  return response.SecretString;
};

const getApiKey = async () => {
  return getSecret(apiSecretName);
};

exports.getApiKey = getApiKey;

const getAppKey = async () => {
  return getSecret(appSecretName);
};

exports.getAppKey = getAppKey;
