const { GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const getSecret = async (secretsClient, name) => {
  const response = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: name,
    }),
  );
  return response.SecretString;
};

const getApiKey = async (secretsClient) => {
  return getSecret(secretsClient, "Remote_Instrumenter_Test_API_Key");
};

exports.getApiKey = getApiKey;

const getAppKey = async (secretsClient) => {
  return getSecret(secretsClient, "Remote_Instrumenter_Test_APPLICATION_Key");
};

exports.getAppKey = getAppKey;
