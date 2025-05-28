const instrument = require("../src/instrument");
const applyState = require("../src/apply-state");
const tag = require("../src/tag");
const { RcConfig } = require("../src/config");
const datadogCi = require("@datadog/datadog-ci/dist/cli.js");
const {
  sampleRcConfigID,
  sampleRcTestJSON,
  sampleRcMetadata,
  baseInstrumentOutcome,
} = require("./test-utils");
const {
  DD_SLS_REMOTE_INSTRUMENTER_VERSION,
  VERSION,
  RC_PRODUCT,
  RC_ACKNOWLEDGED,
  SCHEDULED_INVOCATION_EVENT,
  LAMBDA_EVENT,
} = require("../src/consts");

jest.mock("../src/functions", () => ({
  ...jest.requireActual("../src/functions"),
  waitUntilFunctionIsActive: jest.fn(),
}));

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

jest.mock("../src/tag");
jest.mock("../src/apply-state");
jest.mock("@datadog/datadog-ci/dist/cli.js");

describe("instrumentFunctions", () => {
  // Sample functions to (un)instrument
  const functionFoo = {
    FunctionName: "foo",
    FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:foo",
    Runtime: "nodejs18.x",
    Tags: new Set(["env:prod"]),
  };
  const functionBar = {
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
  const mockClient = {
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
  applyState.createApplyStateObject.mockReturnValue(applyStateObject);

  beforeEach(() => {
    // Mock datadog-ci command
    datadogCi.cli.run.mockReturnValue(0);

    jest.clearAllMocks();
  });

  test("should instrument and tag functions that need it", async () => {
    await instrument.instrumentFunctions(
      mockClient,
      [rcConfig],
      [functionFoo],
      baseInstrumentOutcome,
      mockClient,
    );
    expect(datadogCi.cli.run).toHaveBeenCalledTimes(1);
    expect(datadogCi.cli.run).toHaveBeenCalledWith(
      [
        "lambda",
        "instrument",
        "-f",
        functionFoo.FunctionArn,
        "-v",
        "20",
        "-e",
        "10",
        "--tracing",
        "true",
        "--logging",
        "false",
      ],
      expect.anything(),
    );
    expect(tag.tagResourcesWithSlsTag).toHaveBeenCalledTimes(1);
    expect(tag.tagResourcesWithSlsTag).toHaveBeenCalledWith(mockClient, [
      functionFoo.FunctionArn,
    ]);
  });
  test("should uninstrument and untag functions that need it", async () => {
    await instrument.instrumentFunctions(
      mockClient,
      [rcConfig],
      [functionBar],
      baseInstrumentOutcome,
      mockClient,
    );
    expect(datadogCi.cli.run).toHaveBeenCalledTimes(1);
    expect(datadogCi.cli.run).toHaveBeenCalledWith(
      [
        "lambda",
        "uninstrument",
        "-f",
        functionBar.FunctionArn,
        "-r",
        "us-east-2",
      ],
      expect.anything(),
    );
    expect(tag.untagResourcesOfSlsTag).toHaveBeenCalledTimes(1);
    expect(tag.untagResourcesOfSlsTag).toHaveBeenCalledWith(mockClient, [
      functionBar.FunctionArn,
    ]);
  });
  test("should uninstrument the right functions when there are no configs", async () => {
    process.env.AWS_REGION = "us-east-2";
    await instrument.instrumentFunctions(
      mockClient,
      [],
      [functionFoo, functionBar],
      baseInstrumentOutcome,
      mockClient,
    );
    expect(datadogCi.cli.run).toHaveBeenCalledTimes(1);
    expect(datadogCi.cli.run).toHaveBeenCalledWith(
      [
        "lambda",
        "uninstrument",
        "-f",
        functionBar.FunctionArn,
        "-r",
        "us-east-2",
      ],
      expect.anything(),
    );
    expect(tag.untagResourcesOfSlsTag).toHaveBeenCalledTimes(1);
    expect(tag.untagResourcesOfSlsTag).toHaveBeenCalledWith(mockClient, [
      functionBar.FunctionArn,
    ]);
    expect(applyState.deleteApplyState).toHaveBeenCalledTimes(1);
  });
  test("should write apply state if triggered by scheduled invocation", async () => {
    await instrument.instrumentFunctions(
      mockClient,
      [rcConfig],
      [functionFoo, functionBar],
      baseInstrumentOutcome,
      mockClient,
      SCHEDULED_INVOCATION_EVENT,
    );
    expect(applyState.putApplyState).toHaveBeenCalledTimes(1);
    expect(applyState.putApplyState).toHaveBeenCalledWith(expect.anything(), [
      applyStateObject,
    ]);
  });
  test("should not write apply state if triggered by lambda management event", async () => {
    await instrument.instrumentFunctions(
      mockClient,
      [rcConfig],
      [functionFoo, functionBar],
      baseInstrumentOutcome,
      mockClient,
      LAMBDA_EVENT,
    );
    expect(applyState.putApplyState).toHaveBeenCalledTimes(0);
  });
  test("should track datadog-ci command errors", async () => {
    datadogCi.cli.run.mockReturnValue(1);
    await instrument.instrumentFunctions(
      mockClient,
      [rcConfig],
      [functionFoo],
      baseInstrumentOutcome,
      mockClient,
    );
    expect(datadogCi.cli.run).toHaveBeenCalledTimes(1);
    expect(datadogCi.cli.run).toHaveBeenCalledWith(
      [
        "lambda",
        "instrument",
        "-f",
        functionFoo.FunctionArn,
        "-v",
        "20",
        "-e",
        "10",
        "--tracing",
        "true",
        "--logging",
        "false",
      ],
      expect.anything(),
    );
    expect(baseInstrumentOutcome.instrument.failed).toEqual({
      [functionFoo.FunctionName]: {
        functionArn: functionFoo.FunctionArn,
        reasonCode: "datadog-ci-error",
      },
    });
  });
});

describe("removeRemoteInstrumentation", () => {
  const mockClient = {
    send: jest.fn(),
  };
  beforeEach(() => {
    datadogCi.cli.run.mockReturnValue(0);
    jest.clearAllMocks();
  });
  test("should uninstrument and untag remotely instrumented functions", async () => {
    const functionBar = {
      FunctionName: "bar",
      FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:bar",
      Runtime: "nodejs18.x",
      Tags: new Set([
        "foo:bar",
        `${DD_SLS_REMOTE_INSTRUMENTER_VERSION}:${VERSION}`,
      ]),
    };
    process.env.AWS_REGION = "us-east-2";
    await instrument.removeRemoteInstrumentation(
      mockClient,
      [functionBar],
      baseInstrumentOutcome,
      mockClient,
    );
    expect(datadogCi.cli.run).toHaveBeenCalledTimes(1);
    expect(datadogCi.cli.run).toHaveBeenCalledWith(
      [
        "lambda",
        "uninstrument",
        "-f",
        functionBar.FunctionArn,
        "-r",
        "us-east-2",
      ],
      expect.anything(),
    );
    expect(tag.untagResourcesOfSlsTag).toHaveBeenCalledTimes(1);
    expect(tag.untagResourcesOfSlsTag).toHaveBeenCalledWith(mockClient, [
      functionBar.FunctionArn,
    ]);
    expect(applyState.deleteApplyState).toHaveBeenCalledTimes(1);
  });
  test("should not uninstrument or untag functions that are not remotely instrumented", async () => {
    const functionFoo = {
      FunctionName: "foo",
      FunctionArn: "arn:aws:lambda:us-east-2:123456789:function:foo",
      Runtime: "nodejs18.x",
      Tags: new Set(["env:prod"]),
    };
    await instrument.removeRemoteInstrumentation(
      mockClient,
      [functionFoo],
      baseInstrumentOutcome,
      mockClient,
    );
    expect(datadogCi.cli.run).toHaveBeenCalledTimes(0);
    expect(tag.untagResourcesOfSlsTag).toHaveBeenCalledTimes(0);
    expect(applyState.deleteApplyState).toHaveBeenCalledTimes(1);
  });
});
