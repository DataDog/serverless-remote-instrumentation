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
  expectFunctionsToBeInstrumented,
  isFunctionInstrumented,
  isFunctionUninstrumented,
} from "./utilities/is-function-instrumented";
import {
  setRemoteConfig,
  clearKnownRemoteConfigs,
  clearRemoteConfigs,
} from "./utilities/remote-config";
import { invokeLambdaWithScheduledEvent } from "./utilities/remote-instrumenter-invocations";
import {
  createFunction,
  createFunctions,
  deleteTestFunctions,
  getFunctionEnvVars,
  invokeFunction,
  tagFunction,
} from "./utilities/lambda-functions";
import {
  getApiKeySecretArn,
  setStackApiKeySecretArn,
} from "./utilities/stack-updates";

const SECRET_ARN_ENV_VAR = "DD_API_KEY_SECRET_ARN";

// Stack updates take a few minutes, so they happen in hooks (which get this
// timeout) rather than in the tests themselves
const STACK_UPDATE_HOOK_TIMEOUT = 15 * 60_000;

const functionsInOutcome = (res: any): string[] =>
  ["succeeded", "skipped", "failed"].flatMap((outcome) =>
    Object.keys(res.instrument[outcome] ?? {}),
  );

describe("Remote instrumenter API key from Secrets Manager tests", () => {
  let secretArn: string;

  const hasOnlySecretArn = async (functionName: string): Promise<boolean> => {
    const envVars = await getFunctionEnvVars(functionName);
    return (
      envVars[SECRET_ARN_ENV_VAR] === secretArn && !("DD_API_KEY" in envVars)
    );
  };

  beforeAll(async () => {
    secretArn = await getApiKeySecretArn();
    await clearRemoteConfigs();
  });

  afterAll(async () => {
    // Always put the stack back on the plaintext key so other test files see
    // it as deployed
    await setStackApiKeySecretArn("");
    await clearRemoteConfigs();
  }, STACK_UPDATE_HOOK_TIMEOUT);

  // These tests share one switch of the stack from DdApiKey to
  // DdApiKeySecretArn, so they share functions and remote config instead of
  // cleaning up between tests
  describe("after a stack update from DdApiKey to DdApiKeySecretArn", () => {
    let staleFunctionName: string;
    let recheckFunctionName: string;
    let resBeforeStackUpdate: any;

    beforeAll(async () => {
      await setStackApiKeySecretArn("");
      await setRemoteConfig();
      [staleFunctionName, recheckFunctionName] = (
        await createFunctions({ Tags: { foo: "bar" } }, 2)
      ).map((lambda: any) => lambda.FunctionName);
      await invokeLambdaWithScheduledEvent();
      await expectFunctionsToBeInstrumented([
        staleFunctionName,
        recheckFunctionName,
      ]);

      // With the config hash in place and nothing changed, the scheduled run
      // doesn't look at any function. This guards against the recheck test
      // passing for an unrelated reason.
      resBeforeStackUpdate = await invokeLambdaWithScheduledEvent({
        resetConfigHash: false,
      });

      await setStackApiKeySecretArn(secretArn);
    }, STACK_UPDATE_HOOK_TIMEOUT);

    afterAll(async () => {
      await deleteTestFunctions();
    });

    // Runs first so that no invocation in this file has reset the config hash
    // since the stack update
    it("the next scheduled run rechecks every function", async () => {
      expect(functionsInOutcome(resBeforeStackUpdate)).not.toContain(
        recheckFunctionName,
      );

      // The stack update changed the custom resource's ApiKeySource property,
      // so CloudFormation sent the instrumenter an Update event, which cleared
      // the config hash. Nothing in the test touches the hash itself.
      await invokeLambdaWithScheduledEvent({ resetConfigHash: false });

      // The instrumenter's own scheduled invocation may get to the function
      // first, so check the end state rather than which invocation changed it
      const isReinstrumented = await pollUntilTrue(60000, 5000, () =>
        hasOnlySecretArn(recheckFunctionName),
      );
      expect(isReinstrumented).toStrictEqual(true);
    });

    it("a function with a stale DD_API_KEY ends up with only DD_API_KEY_SECRET_ARN", async () => {
      await invokeLambdaWithScheduledEvent();

      const isReinstrumented = await pollUntilTrue(60000, 5000, () =>
        hasOnlySecretArn(staleFunctionName),
      );
      expect(isReinstrumented).toStrictEqual(true);
      const isInstrumented = await isFunctionInstrumented(staleFunctionName, {
        apiKeyEnvVar: SECRET_ARN_ENV_VAR,
      });
      expect(isInstrumented).toStrictEqual(true);
    });
  });

  describe("with DdApiKeySecretArn set", () => {
    beforeAll(async () => {
      // A no-op when the previous block already switched the stack
      await setStackApiKeySecretArn(secretArn);
    }, STACK_UPDATE_HOOK_TIMEOUT);

    beforeEach(async () => {
      await clearKnownRemoteConfigs();
    });

    afterEach(async () => {
      await deleteTestFunctions();
    });

    const instrumentWithSecretArn = async (): Promise<string> => {
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

      const { StatusCode, FunctionError } = await invokeFunction(functionName);
      expect(StatusCode).toStrictEqual(200);
      expect(FunctionError).toBeUndefined();
    });
  });
});
