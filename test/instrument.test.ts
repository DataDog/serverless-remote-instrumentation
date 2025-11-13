import * as instrument from "../src/instrument";
import * as applyState from "../src/apply-state";
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

jest.mock("../src/functions", () => ({
  ...jest.requireActual("../src/functions"),
  waitUntilFunctionIsActive: jest.fn(),
}));

// Mock the datadog-ci-plugin-lambda functions
jest.mock("@datadog/datadog-ci-plugin-lambda/functions/instrument", () => ({
  getInstrumentedFunctionConfig: jest.fn(),
}));

jest.mock("@datadog/datadog-ci-plugin-lambda/functions/uninstrument", () => ({
  getUninstrumentedFunctionConfig: jest.fn(),
}));

jest.mock("@datadog/datadog-ci-plugin-lambda/functions/commons", () => ({
  updateFunctionConfiguration: jest.fn(),
}));

const {
  getInstrumentedFunctionConfig,
} = require("@datadog/datadog-ci-plugin-lambda/functions/instrument");
const {
  getUninstrumentedFunctionConfig,
} = require("@datadog/datadog-ci-plugin-lambda/functions/uninstrument");
const {
  updateFunctionConfiguration,
} = require("@datadog/datadog-ci-plugin-lambda/functions/commons");

describe("getExtensionAndRuntimeLayerVersion", () => {
  it("should return the layer and runtime version for node", () => {
    const runtime = "nodejs12.x";
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
});

jest.mock("../src/apply-state");

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
    send: jest.fn().mockReturnValue({}),
  };

  const mockS3Client = {
    send: jest.fn(),
  };

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
    getInstrumentedFunctionConfig.mockResolvedValue({
      functionARN: functionFoo.FunctionArn,
      lambdaConfig: functionFoo,
      updateFunctionConfigurationCommandInput: {},
    });
    getUninstrumentedFunctionConfig.mockResolvedValue({
      functionARN: functionBar.FunctionArn,
      lambdaConfig: functionBar,
      updateFunctionConfigurationCommandInput: {},
    });
    updateFunctionConfiguration.mockResolvedValue();

    jest.clearAllMocks();
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
    expect(updateFunctionConfiguration).toHaveBeenCalledTimes(1);
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
    expect(updateFunctionConfiguration).toHaveBeenCalledTimes(1);
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
    expect(updateFunctionConfiguration).toHaveBeenCalledTimes(1);
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
    updateFunctionConfiguration.mockRejectedValue(
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
    expect(updateFunctionConfiguration).toHaveBeenCalledTimes(1);
    expect(baseInstrumentOutcome.instrument.failed).toEqual({
      [functionFoo.FunctionName]: {
        functionArn: functionFoo.FunctionArn,
        reason: "Failed to update function configuration",
        reasonCode: "datadog-ci-error",
      },
    });
  });
});

describe("removeRemoteInstrumentation", () => {
  const mockTaggingClient = {
    send: jest.fn().mockReturnValue({}),
  };
  const mockS3Client = {
    send: jest.fn(),
  };
  beforeEach(() => {
    // Set AWS_REGION for tests
    process.env.AWS_REGION = "us-east-2";

    getUninstrumentedFunctionConfig.mockResolvedValue({
      functionARN: "arn:aws:lambda:us-east-2:123456789:function:bar",
      lambdaConfig: {},
      updateFunctionConfigurationCommandInput: {},
    });
    updateFunctionConfiguration.mockResolvedValue();
    jest.clearAllMocks();
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
    expect(updateFunctionConfiguration).toHaveBeenCalledTimes(2);
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
    expect(updateFunctionConfiguration).toHaveBeenCalledTimes(0);
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
