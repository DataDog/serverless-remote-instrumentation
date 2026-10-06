import {
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import {
  getCloudFormationClient,
  getSecretsManagerClient,
} from "./aws-resources";
import { apiSecretName, stackName } from "../config.json";

const API_KEY_SECRET_ARN_PARAMETER = "DdApiKeySecretArn";

const getApiKeySecretArn = async (): Promise<string> => {
  const secretsManager = await getSecretsManagerClient();
  const { ARN } = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: apiSecretName }),
  );
  return ARN;
};

// Updates the stack's DdApiKeySecretArn parameter the way a customer would,
// keeping the template and every other parameter as is. An empty string
// switches back to the plaintext DdApiKey.
const setStackApiKeySecretArn = async (secretArn: string): Promise<void> => {
  const cfClient = getCloudFormationClient();
  const { Stacks } = await cfClient.send(
    new DescribeStacksCommand({ StackName: stackName }),
  );
  const parameters = Stacks?.[0]?.Parameters ?? [];
  const current = parameters.find(
    (p) => p.ParameterKey === API_KEY_SECRET_ARN_PARAMETER,
  );
  if ((current?.ParameterValue ?? "") === secretArn) {
    return;
  }

  await cfClient.send(
    new UpdateStackCommand({
      StackName: stackName,
      UsePreviousTemplate: true,
      Parameters: parameters.map(({ ParameterKey }) =>
        ParameterKey === API_KEY_SECRET_ARN_PARAMETER
          ? { ParameterKey, ParameterValue: secretArn }
          : { ParameterKey, UsePreviousValue: true },
      ),
      Capabilities: [
        "CAPABILITY_IAM",
        "CAPABILITY_NAMED_IAM",
        "CAPABILITY_AUTO_EXPAND",
      ],
    }),
  );
  await waitUntilStackUpdateComplete(
    { client: cfClient, maxWaitTime: 900 },
    { StackName: stackName },
  );
};

export { getApiKeySecretArn, setStackApiKeySecretArn };
