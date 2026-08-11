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
  hasRemoteInstrumenterTag,
  getRemoteInstrumenterTagValue,
  expectFunctionsToBeInstrumented,
} from "./utilities/is-function-instrumented";
import {
  setRemoteConfig,
  clearKnownRemoteConfigs,
  clearRemoteConfigs,
} from "./utilities/remote-config";
import {
  invokeLambdaWithScheduledEvent,
  getDeployedInstrumenterVersion,
} from "./utilities/remote-instrumenter-invocations";
import {
  createFunction,
  deleteTestFunctions,
  createFunctions,
  tagFunction,
} from "./utilities/lambda-functions";
import { Runtime } from "@aws-sdk/client-lambda";
import {
  deleteErrorObject,
  putErrorObject,
  doesErrorObjectExist,
} from "./utilities/s3-error-object";
import config, { region } from "./config.json";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const containerImageFunctionName = (config as any).containerImageFunctionName as string;

describe("Remote instrumenter scheduled event tests", () => {
  const functionThatDoesntExist = "ThisDoesNotExist";

  afterAll(async () => {
    await deleteErrorObject(functionThatDoesntExist);
    await clearRemoteConfigs();
  });

  afterEach(async () => {
    await deleteTestFunctions();
  });

  beforeEach(async () => {
    await clearKnownRemoteConfigs();
  });

  beforeAll(async () => {
    await clearRemoteConfigs();
  });

  it("function with different tags does NOT get instrumented", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "baz" },
    });
    await setRemoteConfig();

    const res = await invokeLambdaWithScheduledEvent();

    expect(Object.keys(res.instrument.skipped)).toEqual(
      expect.arrayContaining([functionName]),
    );
    expect(res.instrument.skipped[functionName].reasonCode).toStrictEqual(
      "not-satisfying-targeting-rules",
    );

    const isUninstrumented = await isFunctionUninstrumented(functionName);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("manually instrumented function does NOT get instrumented", async () => {
    await setRemoteConfig();
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
      Environment: {
        Variables: {
          DD_API_KEY: "a",
          DD_SITE: "b",
        },
      },
    });

    const res = await invokeLambdaWithScheduledEvent();

    expect(Object.keys(res.instrument.skipped)).toEqual(
      expect.arrayContaining([functionName]),
    );
    expect(res.instrument.skipped[functionName].reasonCode).toStrictEqual(
      "already-manually-instrumented",
    );
  });

  it("function with correct tags does get instrumented", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });
    await setRemoteConfig();

    const res = await invokeLambdaWithScheduledEvent();
    // Very rarely the instrumenter can run in between setting the config and running the lambda
    expect(
      Object.keys(res.instrument.succeeded).concat(
        Object.keys(res.instrument.skipped),
      ),
    ).toEqual(expect.arrayContaining([functionName]));

    // If it was skipped, it should have the reason that it already has the correct layer
    if (Object.keys(res.instrument.skipped).includes(functionName)) {
      expect(res.instrument.skipped[functionName].reasonCode).toStrictEqual(
        "already-correct-extension-and-layer",
      );
    }

    const isInstrumented = await isFunctionInstrumented(functionName);
    expect(isInstrumented).toStrictEqual(true);
  });

  it("function gets instrumented without extension layer when extension version is undefined", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    // Set remote config with undefined extension version but with language layer
    await setRemoteConfig({
      extensionVersion: undefined,
      nodeLayerVersion: 112,
      pythonLayerVersion: 99,
    });

    const res = await invokeLambdaWithScheduledEvent();

    // The function should be successfully instrumented
    expect(
      Object.keys(res.instrument.succeeded).concat(
        Object.keys(res.instrument.skipped),
      ),
    ).toEqual(expect.arrayContaining([functionName]));

    // Verify the function is instrumented with language layer but without extension layer
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);
  });

  it("function gets instrumented without language layer when layer version is undefined", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    // Set remote config with undefined language layer versions but with extension
    await setRemoteConfig({
      extensionVersion: 67,
      nodeLayerVersion: undefined,
      pythonLayerVersion: undefined,
    });

    const res = await invokeLambdaWithScheduledEvent();

    // The function should be successfully instrumented
    expect(
      Object.keys(res.instrument.succeeded).concat(
        Object.keys(res.instrument.skipped),
      ),
    ).toEqual(expect.arrayContaining([functionName]));

    // Verify the function is instrumented with extension layer but without language layer
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);
  });

  it.each([
    ["nodejs20.x", Runtime.nodejs20x],
    ["nodejs24.x", Runtime.nodejs24x],
    ["python3.10", Runtime.python310],
    ["python3.14", Runtime.python314],
    ["ruby3.2", Runtime.ruby32],
    ["ruby3.4", Runtime.ruby34],
    ["java21", Runtime.java21],
    ["java25", Runtime.java25],
    ["dotnet8.0", Runtime.dotnet8],
    ["dotnet10.0", Runtime.dotnet10],
    ["provided.al2", Runtime.providedal2],
    ["provided.al2023", Runtime.providedal2023],
  ])(
    "function with runtime %s gets instrumented",
    async (runtimeName: string, runtimeValue: any) => {
      const { FunctionName: functionName } = await createFunction({
        Tags: { foo: "bar" },
        Runtime: runtimeValue,
      });
      await setRemoteConfig();
      await invokeLambdaWithScheduledEvent();

      const isInstrumented = await isFunctionInstrumented(functionName);
      expect(isInstrumented).toStrictEqual(true);
    },
  );

  it("handles function name deny rules", async () => {
    const { FunctionName: excludedFunctionName } = await createFunction({
      Tags: {
        foo: "bar",
      },
    });
    const { FunctionName: instrumentedFunctionName } = await createFunction({
      Tags: {
        foo: "bar",
      },
    });

    await setRemoteConfig({
      ruleFilters: [
        {
          key: "foo",
          values: ["bar"],
          filter_type: "tag",
          allow: true,
        },
        {
          key: "functionName",
          values: [excludedFunctionName],
          filter_type: "function_name",
          allow: false,
        },
      ],
    });

    await invokeLambdaWithScheduledEvent();

    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(instrumentedFunctionName),
    );
    expect(isInstrumented).toStrictEqual(true);

    const isUninstrumented =
      await isFunctionUninstrumented(excludedFunctionName);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("can upgrade layer versions when the config changes", async () => {
    const rc = await setRemoteConfig({
      extensionVersion: 66,
      nodeLayerVersion: 111,
    });
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    // The function should be instrumented by the lambda management event
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);

    // Update the RC to be a different version
    await setRemoteConfig({
      extensionVersion: 67,
      nodeLayerVersion: 112,
      id: rc.id,
    });

    await invokeLambdaWithScheduledEvent();

    // isFunctionInstrumented checks against the RC version, so
    // it being instrumented here means the version is correct
    const isReInstrumented = await isFunctionInstrumented(functionName);
    expect(isReInstrumented).toStrictEqual(true);
  });

  it("clears remote instrumentation when all configs are deleted", async () => {
    await setRemoteConfig();
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    // The function should be instrumented by the lambda management event
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);

    // Remove all configs
    await clearRemoteConfigs({ waitForCacheInvalidation: true });

    // After the next scheduled event
    await invokeLambdaWithScheduledEvent();

    // The function should be uninstrumented
    const isUninstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionUninstrumented(functionName),
    );
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("instruments all functions when using wildcard rule filter", async () => {
    const functions = await createFunctions({}, 3);
    const functionNames = functions.map((lambda: any) => lambda.FunctionName);

    await setRemoteConfig({
      ruleFilters: [
        {
          key: "function_name",
          values: ["*"],
          filter_type: "function_name",
          allow: true,
        },
      ],
    });

    await invokeLambdaWithScheduledEvent();
    await expectFunctionsToBeInstrumented(functionNames);
  });

  it("sets DD_TRACE_ENABLED and DD_SERVERLESS_LOGS_ENABLED correctly", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });
    const rc = await setRemoteConfig({
      ddTraceEnabled: true,
      ddServerlessLogsEnabled: true,
    });
    await invokeLambdaWithScheduledEvent();
    let isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);

    await setRemoteConfig({
      ddTraceEnabled: false,
      ddServerlessLogsEnabled: false,
      id: rc.id,
    });
    await invokeLambdaWithScheduledEvent();
    isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);
  });

  it("adds an appropriate reason code when datadog-ci fails", async () => {
    // Set the extension version to a version that doesn't exist
    await setRemoteConfig({
      extensionVersion: 100000000,
    });
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    const res = await invokeLambdaWithScheduledEvent();
    expect(Object.keys(res.instrument.failed)).toEqual(
      expect.arrayContaining([functionName]),
    );

    expect(res.instrument.failed[functionName].reasonCode).toStrictEqual(
      "datadog-ci-error",
    );
    expect(res.instrument.failed[functionName].reason).toBeDefined();

    const isUninstrumented = await isFunctionUninstrumented(functionName);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("error for nonexistant function gets cleared and skipped", async () => {
    await putErrorObject(functionThatDoesntExist);

    const res = await invokeLambdaWithScheduledEvent();

    if (Object.keys(res.instrument.skipped).includes(functionThatDoesntExist)) {
      expect(
        res.instrument.skipped[functionThatDoesntExist].reasonCode,
      ).toStrictEqual("function-not-found");
    }

    const doesErrorObjectStillExist = await doesErrorObjectExist(
      functionThatDoesntExist,
    );
    expect(doesErrorObjectStillExist).toEqual(false);
  });

  it("can instrument a function with a pre-existing non-Datadog layer", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
      Layers: [
        `arn:aws:lambda:${region}:451483290750:layer:NewRelicLambdaExtension:36`,
      ],
    });
    await setRemoteConfig();
    await invokeLambdaWithScheduledEvent();
    let isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);
  });

  it("can instrument a function with a remote instrumenter tag but no instrumentation", async () => {
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar", dd_sls_remote_instrumenter_version: "1.0.0" },
    });
    await setRemoteConfig();
    await invokeLambdaWithScheduledEvent();
    let isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);
  });

  it("updates an outdated instrumenter version tag to the current version", async () => {
    const oldVersion = "v0.0.1";
    const { FunctionName: functionName, FunctionArn: functionArn } =
      await createFunction({
        Tags: { foo: "bar", dd_sls_remote_instrumenter_version: oldVersion },
      });
    await setRemoteConfig();

    await invokeLambdaWithScheduledEvent();

    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);

    const [tagValue, deployedVersion] = await Promise.all([
      getRemoteInstrumenterTagValue(functionArn),
      getDeployedInstrumenterVersion(),
    ]);
    expect(tagValue).toBe(`v${deployedVersion}`);

    // Reset the tag to an old version and re-invoke to confirm it gets corrected again
    await tagFunction(functionName, {
      dd_sls_remote_instrumenter_version: oldVersion,
    });

    await invokeLambdaWithScheduledEvent();

    let correctedTagValue: string | undefined;
    await pollUntilTrue(60000, 5000, async () => {
      correctedTagValue = await getRemoteInstrumenterTagValue(functionArn);
      return correctedTagValue === `v${deployedVersion}`;
    });
    expect(correctedTagValue).toBe(`v${deployedVersion}`);
  });

  it("instruments a function whose tag key uses colons when the rule filter uses underscores (REDAPL normalization)", async () => {
    // REDAPL converts colons in tag keys to underscores. A customer whose Lambda is tagged
    // team:my:service will see the rule filter displayed in the Datadog UI as team_my_service.
    // The instrumenter must treat _ and : as interchangeable so that functions shown as
    // eligible in the UI are actually instrumented.
    // Note: AWS reserves the "aws:" tag prefix, so we use a custom colon-containing key here.
    const { FunctionName: functionName } = await createFunction({
      Tags: { "team:my:service": "backend" },
    });

    await setRemoteConfig({
      ruleFilters: [
        {
          key: "team_my_service",
          values: ["backend"],
          filter_type: "tag",
          allow: true,
        },
      ],
    });

    const res = await invokeLambdaWithScheduledEvent();

    expect(Object.keys(res.instrument.skipped)).not.toContain(functionName);

    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );
    expect(isInstrumented).toStrictEqual(true);
  });

  it("can remove tags from functions that should not have them", async () => {
    const { FunctionName: functionName, FunctionArn: functionArn } =
      await createFunction({
        Tags: { foo: "baz", dd_sls_remote_instrumenter_version: "1.0.0" },
      });
    await setRemoteConfig();
    await invokeLambdaWithScheduledEvent();
    let isInstrumented = await isFunctionInstrumented(functionName);
    expect(isInstrumented).toStrictEqual(false);

    const hasTag = await hasRemoteInstrumenterTag(functionArn);
    expect(hasTag).toStrictEqual(false);
  });

  // Container image Lambdas have Runtime: undefined in API responses.
  // The instrumenter must skip them gracefully rather than crashing the batch:
  // a TypeError in isSupportedRuntime would previously abort the entire scheduled run,
  // leaving all other functions in the account un-instrumented as well.
  it("container image Lambda (Runtime: undefined) is skipped without crashing the batch", async () => {
    await setRemoteConfig();

    // Create one zip-based function that should get instrumented
    const { FunctionName: zipFunctionName } = await createFunction({
      Tags: { foo: "bar" },
    });

    // The container image Lambda is pre-created in CDK (tagged foo:bar) so it is
    // automatically picked up by the scheduled event targeting rule — no per-test
    // create/delete needed.
    const res = await invokeLambdaWithScheduledEvent();

    // The container image function must appear in skipped with unsupported-runtime,
    // not in failed and not in succeeded.
    expect(Object.keys(res.instrument.skipped)).toContain(containerImageFunctionName);
    expect(res.instrument.skipped[containerImageFunctionName].reasonCode).toStrictEqual(
      "unsupported-runtime",
    );
    expect(Object.keys(res.instrument.failed)).not.toContain(containerImageFunctionName);
    expect(Object.keys(res.instrument.succeeded)).not.toContain(
      containerImageFunctionName,
    );

    // The container image function must remain un-instrumented (no layers, no env vars).
    const isImageFunctionUninstrumented =
      await isFunctionUninstrumented(containerImageFunctionName);
    expect(isImageFunctionUninstrumented).toStrictEqual(true);

    // The zip-based function in the same batch must still have been instrumented,
    // proving the container image function did not crash the batch.
    const isZipFunctionInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(zipFunctionName),
    );
    expect(isZipFunctionInstrumented).toStrictEqual(true);
  });

  it("correctly tags instrumented functions", async () => {
    const functions = await createFunctions({}, 51);
    const functionNames = functions.map((lambda: any) => lambda.FunctionName);
    const functionArns = functions.map((lambda: any) => lambda.FunctionArn);

    await setRemoteConfig({
      ruleFilters: [
        {
          key: "function_name",
          values: ["*"],
          filter_type: "function_name",
          allow: true,
        },
      ],
    });

    await invokeLambdaWithScheduledEvent();

    // For each of the 51 functions
    await expectFunctionsToBeInstrumented(functionNames);

    // For each of the 51 functions
    for (const functionArn of functionArns) {
      // Check that the function has the remote instrumenter tag
      const hasTag = await hasRemoteInstrumenterTag(functionArn);
      expect(hasTag).toStrictEqual(true);
    }
  }, 120000);
});
