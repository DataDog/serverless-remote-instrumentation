import { describe, it, test, expect, beforeEach, vi } from "vitest";

import * as instrument from "../src/instrument";
import * as applyState from "../src/apply-state";
import type { S3Client } from "@aws-sdk/client-s3";
import type { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { RcConfig } from "../src/config";
import {
  sampleRcConfigID,
  sampleRcTestJSON,
  sampleRcMetadata,
  baseInstrumentOutcome,
} from "./test-utils";
import {
  DD_SLS_REMOTE_INSTRUMENTER_VERSION,
  VERSION,
  RC_PRODUCT,
  RC_ACKNOWLEDGED,
  SCHEDULED_INVOCATION_EVENT,
  LAMBDA_EVENT,
  type LambdaFunction,
} from "../src/consts";

vi.mock("../src/functions", async () => ({
  ...(await vi.importActual("../src/functions")),
  waitUntilFunctionIsActive: vi.fn(),
}));

vi.mock("@datadog/datadog-ci-plugin-lambda/functions/instrument", () => ({
  getInstrumentedFunctionConfig: vi.fn(),
}));

vi.mock("@datadog/datadog-ci-plugin-lambda/functions/uninstrument", () => ({
  getUninstrumentedFunctionConfig: vi.fn(),
}));

vi.mock("@datadog/datadog-ci-plugin-lambda/functions/commons", () => ({
  updateLambdaFunctionConfig: vi.fn(),
}));

import { getInstrumentedFunctionConfig } from "@datadog/datadog-ci-plugin-lambda/functions/instrument";
import { getUninstrumentedFunctionConfig } from "@datadog/datadog-ci-plugin-lambda/functions/uninstrument";
import { updateLambdaFunctionConfig } from "@datadog/datadog-ci-plugin-lambda/functions/commons";
import { waitUntilFunctionIsActive } from "../src/functions";

describe("getExtensionAndRuntimeLayerVersion", () => {
  it("should return the layer and runtime version for node", () => {
    const runtime = "nodejs18.x";
    const config = {
      extensionVersion: 1,
      nodeLayerVersion: 2,
      pythonLayerVersion: 3,
    };
    const expected = {
      runtimeLayerVersion: 2,
      extensionVersion: 1,
    };
    const actual = instrument.getExtensionAndRuntimeLayerVersion(
      runtime,
      config,
    );
    expect(actual).toEqual(expected);
  });
  it("should return the layer and runtime version for python", () => {
    const runtime = "python3.10";
    const config = {
      extensionVersion: 1,
      nodeLayerVersion: 2,
      pythonLayerVersion: 3,
    };
    const expected = {
      runtimeLayerVersion: 3,
      extensionVersion: 1,
    };
    const actual = instrument.getExtensionAndRuntimeLayerVersion(
      runtime,
      config,
    );
    expect(actual).toEqual(expected);
  });
  it("should return an undefined runtime layer version for an unsupported runtime", () => {
    const runtime = "go1.x";
    const config = {
      extensionVersion: 1,
      nodeLayerVersion: 2,
      pythonLayerVersion: 3,
    };
    const expected = {
      runtimeLayerVersion: undefined,
      extensionVersion: 1,
    };
    const actual = instrument.getExtensionAndRuntimeLayerVersion(
      runtime,
      config,
    );
    expect(actual).toEqual(expected);
  });
  it("should handle undefined runtime by using empty string fallback", () => {
    const runtime = "";
    const config = {
      extensionVersion: 1,
      nodeLayerVersion: 2,
      pythonLayerVersion: 3,
    };
    const expected = {
      runtimeLayerVersion: undefined,
      extensionVersion: 1,
    };
    const actual = instrument.getExtensionAndRuntimeLayerVersion(
      runtime,
      config,
    );
    expect(actual).toEqual(expected);
  });
});

vi.mock("../src/apply-state");

const mockedApplyState = applyState as any;

describe("instrumentFunctions", () => {
  // Sample functions to (un)instrument
  const functionFoo: LambdaFunction = {
    FunctionName: "foo",
    FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:foo",
    Runtime: "nodejs18.x",
    Tags: new Set(["env:prod"]),
  };
  const functionBar: LambdaFunction = {
    FunctionName: "bar",
    FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:bar",
    Runtime: "nodejs18.x",
    Tags: new Set([
      "foo:bar",
      `${DD_SLS_REMOTE_INSTRUMENTER_VERSION}:${VERSION}`,
    ]),
  };

  // Sample config object
  const rcConfig = new RcConfig(
    sampleRcConfigID,
    sampleRcTestJSON,
    sampleRcMetadata,
  );
  rcConfig.awsRegion = "us-east-2";

  // Mock client
  const mockTaggingClient = {
    send: vi.fn().mockReturnValue({}),
  } as unknown as ResourceGroupsTaggingAPIClient;

  const mockS3Client = {
    send: vi.fn(),
  } as unknown as S3Client;

  // Mock creating apply state object
  const applyStateObject = {
    id: sampleRcConfigID,
    product: RC_PRODUCT,
    version: rcConfig.rcConfigVersion,
    apply_state: RC_ACKNOWLEDGED,
    apply_error: "",
  };
  mockedApplyState.createApplyStateObject.mockReturnValue(applyStateObject);

  beforeEach(() => {
    // Set AWS_REGION for tests
    process.env.AWS_REGION = "us-east-2";

    // Mock datadog-ci helper functions
    (getInstrumentedFunctionConfig as any).mockResolvedValue({
      functionARN: functionFoo.FunctionArn,
      lambdaConfig: functionFoo,
      updateFunctionConfigurationCommandInput: {},
    });
    (getUninstrumentedFunctionConfig as any).mockResolvedValue({
      functionARN: functionBar.FunctionArn,
      lambdaConfig: functionBar,
      updateFunctionConfigurationCommandInput: {},
    });
    (updateLambdaFunctionConfig as any).mockResolvedValue();

    vi.clearAllMocks();
  });

  test("should instrument and tag functions that need it", async () => {
    await instrument.instrumentFunctions(
      mockS3Client,
      [rcConfig],
      [functionFoo],
      baseInstrumentOutcome,
      mockTaggingClient,
      SCHEDULED_INVOCATION_EVENT,
    );
    expect(getInstrumentedFunctionConfig).toHaveBeenCalledTimes(1);
    expect(getInstrumentedFunctionConfig).toHaveBeenCalledWith(
      expect.anything(), // lambdaClient
      expect.anything(), // cloudWatchLogsClient
      functionFoo,
      rcConfig.awsRegion,
      expect.objectContaining({
        extensionVersion: 10,
        layerVersion: 20,
        tracingEnabled: true,
        loggingEnabled: false,
      }),
    );
    expect(updateLambdaFunctionConfig).toHaveBeenCalledTimes(1);
    expect(mockTaggingClient.send).toHaveBeenCalledTimes(1);
    expect(mockTaggingClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          ResourceARNList: [functionFoo.FunctionArn],
          Tags: { [DD_SLS_REMOTE_INSTRUMENTER_VERSION]: `v${VERSION}` },
        },
      }),
    );
  });

  test("should instrument but skip tagging a function that already has the current version tag", async () => {
    const functionBaz: LambdaFunction = {
      FunctionName: "baz",
      FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:baz",
      Runtime: "nodejs18.x",
      Tags: new Set([
        "env:prod",
        `${DD_SLS_REMOTE_INSTRUMENTER_VERSION}:v${VERSION}`,
      ]),
    };
    (getInstrumentedFunctionConfig as any).mockResolvedValue({
      functionARN: functionBaz.FunctionArn,
      lambdaConfig: functionBaz,
      updateFunctionConfigurationCommandInput: {},
    });

    await instrument.instrumentFunctions(
      mockS3Client,
      [rcConfig],
      [functionBaz],
      baseInstrumentOutcome,
      mockTaggingClient,
      SCHEDULED_INVOCATION_EVENT,
    );

    expect(getInstrumentedFunctionConfig).toHaveBeenCalledTimes(1);
    expect(updateLambdaFunctionConfig).toHaveBeenCalledTimes(1);
    expect(mockTaggingClient.send).not.toHaveBeenCalled();
  });

  test("should uninstrument and untag functions that need it", async () => {
    await instrument.instrumentFunctions(
      mockS3Client,
      [rcConfig],
      [functionBar],
      baseInstrumentOutcome,
      mockTaggingClient,
      SCHEDULED_INVOCATION_EVENT,
    );
    expect(getUninstrumentedFunctionConfig).toHaveBeenCalledTimes(1);
    expect(getUninstrumentedFunctionConfig).toHaveBeenCalledWith(
      expect.anything(), // lambdaClient
      expect.anything(), // cloudWatchLogsClient
      functionBar,
      undefined, // forwarderARN
    );
    expect(updateLambdaFunctionConfig).toHaveBeenCalledTimes(1);
    expect(mockTaggingClient.send).toHaveBeenCalledTimes(1);
    expect(mockTaggingClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          ResourceARNList: [functionBar.FunctionArn],
          TagKeys: [DD_SLS_REMOTE_INSTRUMENTER_VERSION],
        },
      }),
    );
  });

  test("should uninstrument the right functions when there are no configs", async () => {
    process.env.AWS_REGION = "us-east-2";
    await instrument.instrumentFunctions(
      mockS3Client,
      [],
      [functionFoo, functionBar],
      baseInstrumentOutcome,
      mockTaggingClient,
      SCHEDULED_INVOCATION_EVENT,
    );
    expect(getUninstrumentedFunctionConfig).toHaveBeenCalledTimes(1);
    expect(updateLambdaFunctionConfig).toHaveBeenCalledTimes(1);
    expect(mockTaggingClient.send).toHaveBeenCalledTimes(1);
    expect(mockTaggingClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          ResourceARNList: [functionBar.FunctionArn],
          TagKeys: [DD_SLS_REMOTE_INSTRUMENTER_VERSION],
        },
      }),
    );
    expect(mockedApplyState.deleteApplyState).toHaveBeenCalledTimes(1);
  });

  test("should write apply state if triggered by scheduled invocation", async () => {
    await instrument.instrumentFunctions(
      mockS3Client,
      [rcConfig],
      [functionFoo, functionBar],
      baseInstrumentOutcome,
      mockTaggingClient,
      SCHEDULED_INVOCATION_EVENT,
    );
    expect(mockedApplyState.putApplyState).toHaveBeenCalledTimes(1);
    expect(mockedApplyState.putApplyState).toHaveBeenCalledWith(
      expect.anything(),
      [applyStateObject],
    );
  });

  test("should not write apply state if triggered by lambda management event", async () => {
    await instrument.instrumentFunctions(
      mockS3Client,
      [rcConfig],
      [functionFoo, functionBar],
      baseInstrumentOutcome,
      mockTaggingClient,
      LAMBDA_EVENT,
    );
    expect(mockedApplyState.putApplyState).toHaveBeenCalledTimes(0);
  });

  test("should track datadog-ci command errors", async () => {
    (updateLambdaFunctionConfig as any).mockRejectedValue(
      new Error("Failed to update function configuration"),
    );
    await instrument.instrumentFunctions(
      mockS3Client,
      [rcConfig],
      [functionFoo],
      baseInstrumentOutcome,
      mockTaggingClient,
      SCHEDULED_INVOCATION_EVENT,
    );
    expect(getInstrumentedFunctionConfig).toHaveBeenCalledTimes(1);
    expect(updateLambdaFunctionConfig).toHaveBeenCalledTimes(1);
    expect(baseInstrumentOutcome.instrument.failed).toEqual({
      [functionFoo.FunctionName]: {
        functionArn: functionFoo.FunctionArn,
        reason: "Failed to update function configuration",
        reasonCode: "datadog-ci-error",
      },
    });
  });

  test("one function's waitUntilFunctionIsActive failure does not abort the batch", async () => {
    const functionFoo2: LambdaFunction = {
      FunctionName: "foo2",
      FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:foo2",
      Runtime: "nodejs18.x",
      Tags: new Set(["env:prod"]),
    };
    // Reject the active-wait for one function (e.g. a throttle/ResourceNotFound)
    (waitUntilFunctionIsActive as any).mockImplementation((name: string) =>
      name === functionFoo.FunctionName
        ? Promise.reject(new Error("throttled"))
        : Promise.resolve(),
    );

    const outcome = {
      instrument: { succeeded: {} as any, failed: {} as any, skipped: {} },
      uninstrument: { succeeded: {}, failed: {}, skipped: {} },
    };

    // The batch as a whole should not reject
    await expect(
      instrument.instrumentFunctions(
        mockS3Client,
        [rcConfig],
        [functionFoo, functionFoo2],
        outcome as any,
        mockTaggingClient,
        SCHEDULED_INVOCATION_EVENT,
      ),
    ).resolves.toBeUndefined();

    // The failing function is recorded as FAILED, not thrown
    expect(outcome.instrument.failed[functionFoo.FunctionName]).toEqual({
      functionArn: functionFoo.FunctionArn,
      reason: "throttled",
      reasonCode: "datadog-ci-error",
    });
    // The other function in the batch is still instrumented
    expect(outcome.instrument.succeeded["foo2"]).toBeDefined();
    expect(updateLambdaFunctionConfig).toHaveBeenCalledTimes(1);
  });
});

describe("instrumentWithDatadogCi", () => {
  beforeEach(() => {
    process.env.AWS_REGION = "us-east-2";
    (getInstrumentedFunctionConfig as any).mockResolvedValue({
      functionARN: "arn:aws:lambda:us-east-2:123456789:function:test",
      lambdaConfig: {},
      updateFunctionConfigurationCommandInput: {},
    });
    (updateLambdaFunctionConfig as any).mockResolvedValue();
    vi.clearAllMocks();
  });

  test("should handle function with undefined runtime gracefully", async () => {
    const config = {
      extensionVersion: 10,
      nodeLayerVersion: 20,
    };
    const functionWithoutRuntime: LambdaFunction = {
      FunctionName: "no-runtime-func",
      FunctionArn:
        "arn:aws:lambda:us-east-2:123456789:function:no-runtime-func",
      Runtime: undefined,
      Tags: new Set(),
    };
    const outcome = baseInstrumentOutcome;

    await instrument.instrumentWithDatadogCi(
      functionWithoutRuntime,
      true,
      config as any,
      outcome,
    );

    expect(getInstrumentedFunctionConfig).toHaveBeenCalledTimes(1);
    expect(getInstrumentedFunctionConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      functionWithoutRuntime,
      "us-east-2",
      expect.objectContaining({
        extensionVersion: 10,
        layerVersion: "none", // empty string runtime should result in "none" layer version
      }),
    );
    expect(updateLambdaFunctionConfig).toHaveBeenCalledTimes(1);
    expect(
      (outcome.instrument.succeeded as Record<string, unknown>)[
        functionWithoutRuntime.FunctionName
      ],
    ).toBeDefined();
  });
});

describe("removeRemoteInstrumentation", () => {
  const mockTaggingClient = {
    send: vi.fn().mockReturnValue({}),
  } as unknown as ResourceGroupsTaggingAPIClient;
  const mockS3Client = {
    send: vi.fn(),
  } as unknown as S3Client;
  beforeEach(() => {
    // Set AWS_REGION for tests
    process.env.AWS_REGION = "us-east-2";

    (getUninstrumentedFunctionConfig as any).mockResolvedValue({
      functionARN: "arn:aws:lambda:us-east-2:123456789:function:bar",
      lambdaConfig: {},
      updateFunctionConfigurationCommandInput: {},
    });
    (updateLambdaFunctionConfig as any).mockResolvedValue();
    vi.clearAllMocks();
  });

  test("should uninstrument and untag remotely instrumented functions", async () => {
    const functionBar: LambdaFunction = {
      FunctionName: "bar",
      FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:bar",
      Runtime: "nodejs18.x",
      Tags: new Set([
        "foo:bar",
        `${DD_SLS_REMOTE_INSTRUMENTER_VERSION}:${VERSION}`,
      ]),
    };
    const functionBaz: LambdaFunction = {
      FunctionName: "baz",
      FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:baz",
      Runtime: "nodejs18.x",
      Tags: new Set([
        "foo:baz",
        `${DD_SLS_REMOTE_INSTRUMENTER_VERSION}:${VERSION}`,
      ]),
    };
    process.env.AWS_REGION = "us-east-2";
    await instrument.removeRemoteInstrumentation(
      mockS3Client,
      [functionBar, functionBaz],
      baseInstrumentOutcome,
      mockTaggingClient,
    );
    expect(getUninstrumentedFunctionConfig).toHaveBeenCalledTimes(2);
    expect(updateLambdaFunctionConfig).toHaveBeenCalledTimes(2);
    expect(mockTaggingClient.send).toHaveBeenCalledTimes(1);
    expect(mockTaggingClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          ResourceARNList: [functionBar.FunctionArn, functionBaz.FunctionArn],
          TagKeys: [DD_SLS_REMOTE_INSTRUMENTER_VERSION],
        },
      }),
    );
    expect(mockedApplyState.deleteApplyState).toHaveBeenCalledTimes(1);
  });

  test("should not uninstrument or untag functions that are not remotely instrumented", async () => {
    const functionFoo: LambdaFunction = {
      FunctionName: "foo",
      FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:foo",
      Runtime: "nodejs18.x",
      Tags: new Set(["env:prod"]),
    };
    await instrument.removeRemoteInstrumentation(
      mockS3Client,
      [functionFoo],
      baseInstrumentOutcome,
      mockTaggingClient,
    );
    expect(getUninstrumentedFunctionConfig).toHaveBeenCalledTimes(0);
    expect(updateLambdaFunctionConfig).toHaveBeenCalledTimes(0);
    expect(mockTaggingClient.send).toHaveBeenCalledTimes(0);
    expect(mockedApplyState.deleteApplyState).toHaveBeenCalledTimes(1);
  });
});

describe("createFunctionBatches", () => {
  const functionFoo: LambdaFunction = {
    FunctionName: "foo",
    FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:foo",
    Runtime: "nodejs18.x",
    Tags: new Set(["env:prod"]),
  };
  test("should create batches of the correct size when the number of functions is greater than the batch size", () => {
    const functions: LambdaFunction[] = Array(100).fill(functionFoo);
    expect(instrument.createFunctionBatches(functions, 50).length).toBe(2);
    expect(instrument.createFunctionBatches(functions, 50)[0].length).toBe(50);
    expect(instrument.createFunctionBatches(functions, 50)[1].length).toBe(50);
  });
  test("should create a single batch if the number of functions is less than the batch size", () => {
    const functions: LambdaFunction[] = Array(50).fill(functionFoo);
    expect(instrument.createFunctionBatches(functions, 50).length).toBe(1);
    expect(instrument.createFunctionBatches(functions, 50)[0].length).toBe(50);
  });
  test("should create a single batch if the number of functions is equal to the batch size", () => {
    const functions: LambdaFunction[] = Array(50).fill(functionFoo);
    expect(instrument.createFunctionBatches(functions, 50).length).toBe(1);
    expect(instrument.createFunctionBatches(functions, 50)[0].length).toBe(50);
  });
});
