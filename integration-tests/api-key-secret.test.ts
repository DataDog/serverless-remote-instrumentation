import {
  describe,
  it,
  expect,
  afterAll,
  afterEach,
  beforeEach,
  beforeAll,
} from "vitest";

import { pollUntilTrue } from "./utilities/poll-until-true";
import {
  isFunctionInstrumented,
  isFunctionUninstrumented,
} from "./utilities/is-function-instrumented";
import {
  setRemoteConfig,
  clearKnownRemoteConfigs,
  clearRemoteConfigs,
} from "./utilities/remote-config";
import {
  invokeLambdaWithScheduledEvent,
  invokeLambdaWithCFNUpdateEvent,
} from "./utilities/remote-instrumenter-invocations";
import {
  createFunction,
  deleteTestFunctions,
  getFunctionEnvVars,
  invokeFunction,
  tagFunction,
} from "./utilities/lambda-functions";
import {
  getApiKeySecretArn,
  setInstrumenterApiKeySecretArn,
} from "./utilities/instrumenter-api-key";

const SECRET_ARN_ENV_VAR = "DD_API_KEY_SECRET_ARN";

const functionsInOutcome = (res: any): string[] =>
  ["succeeded", "skipped", "failed"].flatMap((outcome) =>
    Object.keys(res.instrument[outcome] ?? {}),
  );

describe("Remote instrumenter API key from Secrets Manager tests", () => {
  let secretArn: string;

  beforeAll(async () => {
    secretArn = await getApiKeySecretArn();
    await clearRemoteConfigs();
  });

  afterAll(async () => {
    // Always put the instrumenter back on the plaintext key so other test
    // files see the stack as deployed
    await setInstrumenterApiKeySecretArn(undefined);
    await clearRemoteConfigs();
  });

  beforeEach(async () => {
    await clearKnownRemoteConfigs();
  });

  afterEach(async () => {
    await deleteTestFunctions();
  });

  const instrumentWithPlaintextKey = async (): Promise<string> => {
    await setInstrumenterApiKeySecretArn(undefined);
    await setRemoteConfig();
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });
    await invokeLambdaWithScheduledEvent();
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);
    return functionName;
  };

  const instrumentWithSecretArn = async (): Promise<string> => {
    await setInstrumenterApiKeySecretArn(secretArn);
    await setRemoteConfig();
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });
    await invokeLambdaWithScheduledEvent();
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName, {
        apiKeyEnvVar: SECRET_ARN_ENV_VAR,
      }),
    );
    expect(isInstrumented).toStrictEqual(true);
    return functionName;
  };

  it("function with a stale DD_API_KEY is reinstrumented with only DD_API_KEY_SECRET_ARN", async () => {
    const functionName = await instrumentWithPlaintextKey();

    await setInstrumenterApiKeySecretArn(secretArn);
    const res = await invokeLambdaWithScheduledEvent();

    expect(Object.keys(res.instrument.succeeded)).toContain(functionName);
    const envVars = await getFunctionEnvVars(functionName);
    expect(envVars[SECRET_ARN_ENV_VAR]).toStrictEqual(secretArn);
    expect(envVars).not.toHaveProperty("DD_API_KEY");
    const isInstrumented = await isFunctionInstrumented(functionName, {
      apiKeyEnvVar: SECRET_ARN_ENV_VAR,
    });
    expect(isInstrumented).toStrictEqual(true);
  });

  it("a stack update that changes the API key source makes the next scheduled run recheck every function", async () => {
    const functionName = await instrumentWithPlaintextKey();

    // With the config hash in place and nothing changed, the scheduled run
    // doesn't look at any function. This guards against the assertion below
    // passing for an unrelated reason.
    const unchangedRes = await invokeLambdaWithScheduledEvent({
      resetConfigHash: false,
    });
    expect(functionsInOutcome(unchangedRes)).not.toContain(functionName);

    // A real stack update changes the instrumenter's environment and, because
    // the custom resource's ApiKeySource property changes, sends it an Update
    // event, which clears the config hash
    await setInstrumenterApiKeySecretArn(secretArn);
    const { errors } = await invokeLambdaWithCFNUpdateEvent();
    expect(errors).toBeUndefined();
    const res = await invokeLambdaWithScheduledEvent({
      resetConfigHash: false,
    });

    expect(Object.keys(res.instrument.succeeded)).toContain(functionName);
    const envVars = await getFunctionEnvVars(functionName);
    expect(envVars[SECRET_ARN_ENV_VAR]).toStrictEqual(secretArn);
    expect(envVars).not.toHaveProperty("DD_API_KEY");
  });

  it("uninstrumenting removes DD_API_KEY_SECRET_ARN", async () => {
    const functionName = await instrumentWithSecretArn();

    // Stop matching the targeting rules
    await tagFunction(functionName, { foo: "baz" });
    await invokeLambdaWithScheduledEvent();

    const isUninstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionUninstrumented(functionName),
    );
    expect(isUninstrumented).toStrictEqual(true);
    const envVars = await getFunctionEnvVars(functionName);
    expect(envVars).not.toHaveProperty(SECRET_ARN_ENV_VAR);
  });

  it("function without permission to read the secret still invokes without error", async () => {
    // The test Lambda execution role has no secretsmanager:GetSecretValue
    // permission, so the extension cannot resolve the API key. Telemetry is
    // lost, but the function itself must keep working.
    const functionName = await instrumentWithSecretArn();

    // Cold start (where the extension resolves the key), then a warm invoke
    for (let i = 0; i < 2; i++) {
      const { StatusCode, FunctionError } = await invokeFunction(functionName);
      expect(StatusCode).toStrictEqual(200);
      expect(FunctionError).toBeUndefined();
    }
  });
});
