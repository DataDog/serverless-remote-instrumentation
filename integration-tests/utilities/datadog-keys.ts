import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { getSecretsManagerClient } from "./aws-resources";
import { apiSecretName, appSecretName } from "../config.json";

const getSecret = async (name: string): Promise<string> => {
  const secretsManager = await getSecretsManagerClient();
  const response = await secretsManager.send(
    new GetSecretValueCommand({
      SecretId: name,
    }),
  );
  return response.SecretString;
};

const getApiKey = async (): Promise<string> => {
  return getSecret(apiSecretName);
};

const getAppKey = async (): Promise<string> => {
  return getSecret(appSecretName);
};

export { getApiKey, getAppKey };
