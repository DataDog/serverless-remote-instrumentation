import {
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { getLambdaClient, getSecretsManagerClient } from "./aws-resources";
import { apiSecretName, functionName } from "../config.json";

// Read by datadog-ci on the instrumenter and copied to instrumented functions
// as DD_API_KEY_SECRET_ARN. The instrumenter keeps its own DD_API_KEY, so its
// extension and metrics are unaffected by switching this on.
const SECRET_ARN_ENV_VAR = "DATADOG_API_KEY_SECRET_ARN";

const getApiKeySecretArn = async (): Promise<string> => {
  const secretsManager = await getSecretsManagerClient();
  const { ARN } = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: apiSecretName }),
  );
  return ARN;
};

// Simulates a stack update that switches the instrumenter between DdApiKey
// (secretArn undefined) and DdApiKeySecretArn, without redeploying the stack
const setInstrumenterApiKeySecretArn = async (
  secretArn: string | undefined,
): Promise<void> => {
  const lambdaClient = await getLambdaClient();
  const waitForUpdate = () =>
    waitUntilFunctionUpdatedV2(
      { client: lambdaClient, maxWaitTime: 120 },
      { FunctionName: functionName },
    );

  await waitForUpdate();
  const { Environment } = await lambdaClient.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  );
  const variables = { ...Environment?.Variables };
  if (variables[SECRET_ARN_ENV_VAR] === secretArn) {
    return;
  }
  if (secretArn) {
    variables[SECRET_ARN_ENV_VAR] = secretArn;
  } else {
    delete variables[SECRET_ARN_ENV_VAR];
  }

  await lambdaClient.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      Environment: { Variables: variables },
    }),
  );
  await waitForUpdate();
};

export { getApiKeySecretArn, setInstrumenterApiKeySecretArn };
