const { GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { getSecretsManagerClient } = require("./aws-resources");

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
  return getSecret("Remote_Instrumenter_Test_API_Key_20250226");
};

exports.getApiKey = getApiKey;

const getAppKey = async () => {
  return getSecret("Remote_Instrumenter_Test_APPLICATION_Key");
};

exports.getAppKey = getAppKey;
