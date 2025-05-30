const {
  satisfiesTargetingRules,
  isRemoteInstrumenter,
  isCorrectlyInstrumented,
  needsInstrumentationUpdate,
  filterFunctionsToChangeInstrumentation,
  isInstrumented,
  waitUntilFunctionIsActive,
  selectFunctionFieldsForLogging,
} = require("../src/functions");
const {
  DD_SLS_REMOTE_INSTRUMENTER_VERSION,
  VERSION,
  DD_TRACE_ENABLED,
  DD_SERVERLESS_LOGS_ENABLED,
} = require("../src/consts");
const awsClients = require("../src/aws-resources");
const sleep = require("../src/sleep");
const { baseInstrumentOutcome } = require("./test-utils");

jest.mock("../src/aws-resources");
jest.mock("../src/sleep");

// Creates a test config object
function createTestConfig({
  entityType,
  extensionVersion,
  nodeLayerVersion,
  pythonLayerVersion,
  ddTraceEnabled,
  ddServerlessLogsEnabled,
  priority,
  ruleFilters,
}) {
  return {
    configVersion: 1,
    entityType: entityType,
    extensionVersion: extensionVersion,
    nodeLayerVersion: nodeLayerVersion,
    pythonLayerVersion: pythonLayerVersion,
    ddTraceEnabled: ddTraceEnabled,
    ddServerlessLogsEnabled: ddServerlessLogsEnabled,
    priority: priority,
    ruleFilters: ruleFilters,
    instrumenterFunctionName: "datadog-remote-instrumenter",
  };
}

// Creates a test lambda function object
function createTestLambdaFunction({
  functionName,
  functionArn,
  runtime,
  tags,
  layers,
  envVars,
  extraFields,
}) {
  return {
    FunctionName: functionName,
    FunctionArn: functionArn,
    Runtime: runtime,
    Tags: tags,
    Layers: layers,
    Environment: {
      Variables: envVars,
    },
    ...extraFields,
  };
}
describe("satisfiesTargetingRules", () => {
  describe("When the filter is a tag-based allow filter", () => {
    test("should return true if the function has an allowed tag", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
          {
            key: "foo",
            values: ["bar", "baz"],
            allow: true,
            filterType: "tag",
          },
        ]),
      ).toBe(true);
    });
    test("should return false if the function doesn't have an allowed tag", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:x"]), [
          {
            key: "foo",
            values: ["bar", "baz"],
            allow: true,
            filterType: "tag",
          },
        ]),
      ).toBe(false);
      expect(
        satisfiesTargetingRules("functionA", new Set(["x:bar"]), [
          {
            key: "foo",
            values: ["bar", "baz"],
            allow: true,
            filterType: "tag",
          },
        ]),
      ).toBe(false);
    });
  });
  describe("When the filter is a tag-based deny filter", () => {
    test("should return false if the function has a denied tag", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
          {
            key: "foo",
            values: ["bar", "baz"],
            allow: false,
            filterType: "tag",
          },
        ]),
      ).toBe(false);
    });
    test("should return true if the function doesn't have a denied tag", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:x"]), [
          {
            key: "foo",
            values: ["bar", "baz"],
            allow: false,
            filterType: "tag",
          },
        ]),
      ).toBe(true);
      expect(
        satisfiesTargetingRules("functionA", new Set(["x:bar"]), [
          {
            key: "foo",
            values: ["bar", "baz"],
            allow: false,
            filterType: "tag",
          },
        ]),
      ).toBe(true);
    });
  });

  describe("When the filter is a function-name-based allow filter", () => {
    test("should return true if the function name is allowed", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
          {
            key: "functionName",
            values: ["functionA"],
            allow: true,
            filterType: "function_name",
          },
        ]),
      ).toBe(true);
    });
    test("should return false if the function name is not allowed", () => {
      expect(
        satisfiesTargetingRules("functionB", new Set(["foo:bar"]), [
          {
            key: "functionName",
            values: ["functionA"],
            allow: true,
            filterType: "function_name",
          },
        ]),
      ).toBe(false);
    });
  });
  describe("When the filter is a function-name-based deny filter", () => {
    test("should return false if the function name is denied", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
          {
            key: "functionName",
            values: ["functionA"],
            allow: false,
            filterType: "function_name",
          },
        ]),
      ).toBe(false);
    });
    test("should return true if the function name is not denied", () => {
      expect(
        satisfiesTargetingRules("functionB", new Set(["foo:bar"]), [
          {
            key: "functionName",
            values: ["functionA"],
            allow: false,
            filterType: "function_name",
          },
        ]),
      ).toBe(true);
    });
  });
  describe("When there are no filters", () => {
    test("should return false", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:bar"]), []),
      ).toBe(false);
    });
  });
  describe("When there are multiple filters", () => {
    test("should return true if all filters are satisfied", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
          {
            key: "foo",
            values: ["bar"],
            allow: true,
            filterType: "tag",
          },
          {
            key: "functionName",
            values: ["functionA"],
            allow: true,
            filterType: "function_name",
          },
        ]),
      ).toBe(true);
    });
    test("should return false if any filter is not satisfied", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
          {
            key: "foo",
            values: ["bar"],
            allow: true,
            filterType: "tag",
          },
          {
            key: "functionName",
            values: ["functionB"],
            allow: true,
            filterType: "function_name",
          },
        ]),
      ).toBe(false);
    });
  });
  test("should return true if the function name is allowed by a wildcard filter", () => {
    expect(
      satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
        {
          key: "functionName",
          values: ["*"],
          allow: true,
          filterType: "function_name",
        },
      ]),
    ).toBe(true);
  });
  test("should return false if function name is included by wildcard and explicitly denied by name", () => {
    expect(
      satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
        {
          key: "functionName",
          values: ["*"],
          allow: true,
          filterType: "function_name",
        },
        {
          key: "functionName",
          values: ["functionA"],
          allow: false,
          filterType: "function_name",
        },
      ]),
    ).toBe(false);
  });
  test("should return false if function name is included by wildcard and explicitly denied by tag", () => {
    expect(
      satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
        {
          key: "functionName",
          values: ["*"],
          allow: true,
          filterType: "function_name",
        },
        {
          key: "foo",
          values: ["bar"],
          allow: false,
          filterType: "tag",
        },
      ]),
    ).toBe(false);
  });
});

describe("isRemoteInstrumenter", () => {
  test("should return true if the function names match", () => {
    expect(isRemoteInstrumenter("functionA", "functionA")).toBe(true);
  });
  test("should return false if the function names don't match", () => {
    expect(isRemoteInstrumenter("functionB", "functionA")).toBe(false);
  });
});

describe("isCorrectlyInstrumented", () => {
  describe("When the extension and runtime layer versions are defined", () => {
    test("should return true if both layer versions and tracing/logging are correct", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(true);
    });
    test("should return false if the node layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:5",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the node layer is missing", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          tracingEnabled: true,
          loggingEnabled: false,
        }),
      ).toBe(false);
    });
    test("should return false if the python layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Python:5",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "python3.8",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the python layer is missing", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "python3.8",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the extension layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:3",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the extension layer is missing", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
  });
  describe("When the extension layer is undefined", () => {
    test("should return true if extension layer is omitted and runtime layer is correct", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(true);
    });
    test("should return false if extension layer is present", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the node layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:5",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the node layer is missing", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the python layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Python:5",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the python layer is missing", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
  });
  describe("When the runtime layer is undefined", () => {
    test("should return true if the runtime layer is omitted and extension layer is correct", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(true);
    });
    test("should return false if the node layer is present", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the python layer is present", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Python:2",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),

          targetLambdaRuntime: "python3.8",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the extension layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:3",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),

          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the extension layer is missing", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),

          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
  });
  describe("When both layers are undefined", () => {
    test("should return true if both layers are omitted", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(true);
    });
    test("should return false if the node layer is present", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the python layer is present", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Python:2",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "python3.8",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
    test("should return false if the extension layer is present", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
          ],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
  });
  describe("When the tracing and logging settings are not defined", () => {
    test("should return true if the tracing and logging environment variables are set to true", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: undefined,
            ddServerlessLogsEnabled: undefined,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "true",
        }),
      ).toBe(true);
    });
    test("should return false if the tracing and logging environment variables are set to false", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: undefined,
            ddServerlessLogsEnabled: undefined,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "false",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
  });
  describe("When the tracing and logging settings are set to false", () => {
    test("should return true if the tracing and logging environment variables are set to false", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: false,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "false",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(true);
    });
    test("should return false if the tracing and logging environment variables are set to true", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: false,
            ddServerlessLogsEnabled: false,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "true",
        }),
      ).toBe(false);
    });
  });
  describe("When the tracing and logging settings are set to true", () => {
    test("should return true if the tracing and logging environment variables are set to true", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: true,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "true",
          ddServerlessLogsEnabledValue: "true",
        }),
      ).toBe(true);
    });
    test("should return false if the tracing and logging environment variables are set to false", () => {
      expect(
        isCorrectlyInstrumented({
          layers: [],
          config: createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            ddTraceEnabled: true,
            ddServerlessLogsEnabled: true,
            priority: 1,
            ruleFilters: [],
          }),
          targetLambdaRuntime: "nodejs14.x",
          ddTraceEnabledValue: "false",
          ddServerlessLogsEnabledValue: "false",
        }),
      ).toBe(false);
    });
  });
});
describe("needsInstrumentationUpdate", () => {
  describe("When targeting rules are not satisfied", () => {
    test("not instrumented function should not be changed", () => {
      const lambdaFunc = createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: new Set(),
        layers: [],
      });
      const config = createTestConfig({
        entityType: "lambda",
        extensionVersion: 1,
        nodeLayerVersion: 1,
        pythonLayerVersion: 1,
        priority: 1,
        ruleFilters: [],
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, baseInstrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(false);
      expect(untag).toBe(false);
    });
    test("instrumented function should be uninstrumented and untagged", () => {
      const lambdaFunc = createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: new Set([DD_SLS_REMOTE_INSTRUMENTER_VERSION + ":" + VERSION]),
        layers: [],
      });
      const config = createTestConfig({
        entityType: "lambda",
        extensionVersion: 1,
        nodeLayerVersion: 1,
        pythonLayerVersion: 1,
        priority: 1,
        ruleFilters: [],
      });

      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, baseInstrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(true);
      expect(tag).toBe(false);
      expect(untag).toBe(true);
    });
  });

  describe("When the function is manually instrumented", () => {
    test("manually instrumented function should not be changed", () => {
      const functionName = "ManuallyInstrumentedFunction";
      const lambdaFunc = createTestLambdaFunction({
        functionName,
        envVars: { DD_SITE: "a", DD_API_KEY: "b" },
        tags: new Set([]),
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, {}, baseInstrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(false);
      expect(untag).toBe(false);
      expect(
        baseInstrumentOutcome.instrument.skipped[functionName].reasonCode,
      ).toStrictEqual("already-manually-instrumented");
    });
  });

  describe("When it's the remote instrumenter lambda", () => {
    test("function should not be changed", () => {
      const lambdaFunc = createTestLambdaFunction({
        functionName: "datadog-remote-instrumenter",
        functionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:datadog-remote-instrumenter",
        runtime: "nodejs14.x",
        tags: new Set(["foo:bar"]),
        layers: [],
      });
      const ruleFilters = [
        {
          key: "foo",
          values: ["bar"],
          allow: true,
          filterType: "tag",
        },
      ];
      const config = createTestConfig({
        entityType: "lambda",
        extensionVersion: 1,
        nodeLayerVersion: 1,
        pythonLayerVersion: 1,
        priority: 1,
        ruleFilters: ruleFilters,
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, baseInstrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(false);
      expect(untag).toBe(false);
    });
  });
  describe("When the function has an unsupported runtime", () => {
    test("function should not be changed", () => {
      const lambdaFunc = createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "go1.x",
        tags: new Set(["foo:bar"]),
        layers: [],
      });
      const ruleFilters = [
        {
          key: "foo",
          values: ["bar"],
          allow: true,
          filterType: "tag",
        },
      ];
      const config = createTestConfig({
        entityType: "lambda",
        extensionVersion: 1,
        nodeLayerVersion: 1,
        pythonLayerVersion: 1,
        priority: 1,
        ruleFilters: ruleFilters,
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, baseInstrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(false);
      expect(untag).toBe(false);
    });
  });
  describe("When the function is already correctly instrumented", () => {
    test("tagged function should not be changed", () => {
      const layers = [
        {
          Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:1",
        },
        {
          Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
        },
      ];
      const lambdaFunc = createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: new Set([
          "foo:bar",
          DD_SLS_REMOTE_INSTRUMENTER_VERSION + ":" + VERSION,
        ]),
        layers: layers,
        envVars: {
          [DD_TRACE_ENABLED]: "true",
          [DD_SERVERLESS_LOGS_ENABLED]: "false",
        },
      });
      const ruleFilters = [
        {
          key: "foo",
          values: ["bar"],
          allow: true,
          filterType: "tag",
        },
      ];
      const config = createTestConfig({
        entityType: "lambda",
        extensionVersion: 1,
        nodeLayerVersion: 1,
        pythonLayerVersion: 1,
        ddTraceEnabled: true,
        ddServerlessLogsEnabled: false,
        priority: 1,
        ruleFilters: ruleFilters,
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, baseInstrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(false);
      expect(untag).toBe(false);
    });
  });
  describe("When the function needs to be instrumented", () => {
    test("function should be instrumented and tagged", () => {
      const layers = [
        {
          Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
        },
        {
          Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:3",
        },
      ];
      const lambdaFunc = createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: new Set([
          "foo:bar",
          DD_SLS_REMOTE_INSTRUMENTER_VERSION + ":" + VERSION,
        ]),
        layers: layers,
      });
      const ruleFilters = [
        {
          key: "foo",
          values: ["bar"],
          allow: true,
          filterType: "tag",
        },
      ];
      const config = createTestConfig({
        entityType: "lambda",
        extensionVersion: 1,
        nodeLayerVersion: 1,
        pythonLayerVersion: 1,
        ddTraceEnabled: true,
        ddServerlessLogsEnabled: false,
        priority: 1,
        ruleFilters: ruleFilters,
        instrumenterFunctionName: "datadog-remote-instrumenter",
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, baseInstrumentOutcome);
      expect(instrument).toBe(true);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(true);
      expect(untag).toBe(false);
    });
    test("function with different tracing and logging settings should be instrumented and tagged", () => {
      const lambdaFunc = createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: new Set([
          "foo:bar",
          DD_SLS_REMOTE_INSTRUMENTER_VERSION + ":" + VERSION,
        ]),
        layers: [],
        envVars: {},
      });
      const ruleFilters = [
        {
          key: "foo",
          values: ["bar"],
          allow: true,
          filterType: "tag",
        },
      ];
      const config = createTestConfig({
        entityType: "lambda",
        extensionVersion: undefined,
        nodeLayerVersion: undefined,
        pythonLayerVersion: undefined,
        ddTraceEnabled: false,
        ddServerlessLogsEnabled: false,
        priority: 1,
        ruleFilters: ruleFilters,
        instrumenterFunctionName: "datadog-remote-instrumenter",
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, baseInstrumentOutcome);
      expect(instrument).toBe(true);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(true);
      expect(untag).toBe(false);
    });
  });
});

describe("filterFunctionsToChangeInstrumentation", () => {
  test("should return functions to instrument, uninstrument, tag, and untag", () => {
    const functionsToCheck = [
      // Function A should be instrumented and tagged
      createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: new Set([
          "foo:bar",
          DD_SLS_REMOTE_INSTRUMENTER_VERSION + ":" + VERSION,
        ]),
        layers: [],
      }),
      // Function B should be uninstrumented and untagged
      createTestLambdaFunction({
        functionName: "functionB",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionB",
        runtime: "nodejs14.x",
        tags: new Set([
          "foo:baz",
          DD_SLS_REMOTE_INSTRUMENTER_VERSION + ":" + VERSION,
        ]),
        layers: [],
      }),
    ];

    const config = createTestConfig({
      entityType: "lambda",
      extensionVersion: 1,
      nodeLayerVersion: 1,
      pythonLayerVersion: 1,
      priority: 1,
      ruleFilters: [
        { key: "foo", values: ["bar"], allow: true, filterType: "tag" },
      ],
    });
    const {
      functionsToInstrument,
      functionsToUninstrument,
      functionsToTag,
      functionsToUntag,
    } = filterFunctionsToChangeInstrumentation(
      functionsToCheck,
      config,
      baseInstrumentOutcome,
    );
    expect(functionsToInstrument.length).toBe(1);
    expect(functionsToInstrument[0].FunctionName).toBe("functionA");
    expect(functionsToUninstrument.length).toBe(1);
    expect(functionsToUninstrument[0].FunctionName).toBe("functionB");
    expect(functionsToTag.length).toBe(1);
    expect(functionsToTag[0].FunctionName).toBe("functionA");
    expect(functionsToUntag.length).toBe(1);
    expect(functionsToUntag[0].FunctionName).toBe("functionB");
  });
});

describe("isInstrumented", () => {
  test.each([
    ["Empty object is not instrumented", {}, false],
    ["Undefined is not instrumented", undefined, false],
    ["Has no environment Variables", { Environment: { Variables: {} } }, false],
    [
      "Is instrumented with both variables",
      {
        Environment: {
          Variables: {
            DD_API_KEY: "a",
            DD_SITE: "b",
          },
        },
      },
      true,
    ],

    [
      "Only has API key",
      {
        Environment: {
          Variables: {
            DD_API_KEY: "a",
          },
        },
      },
      false,
    ],

    [
      "Only has site",
      {
        Environment: {
          Variables: {
            DD_SITE: "b",
          },
        },
      },
      false,
    ],
    [
      "Has datadog layers, others potentially configured in yaml",
      {
        Layers: [
          {
            Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
          },
        ],
      },
      true,
    ],
    [
      "Has other layers",
      {
        Layers: [
          {
            Arn: "arn:aws:lambda:us-east-1:464622532012:layer:InformationCat:100",
          },
        ],
      },
      false,
    ],
  ])("%s", (_, lambdaFunc, expected) => {
    expect(isInstrumented(lambdaFunc)).toBe(expected);
  });
});

describe("waitUntilFunctionIsActive", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("stops when the status is active", async () => {
    awsClients.getLambdaClient.mockReturnValue({
      send: () => ({ State: "Active" }),
    });
    const res = await waitUntilFunctionIsActive();
    expect(res).toStrictEqual(true);
    expect(sleep.sleep).toHaveBeenCalledTimes(0);
  });

  test("stops when the status is active after the second time", async () => {
    awsClients.getLambdaClient.mockReturnValue({
      send: jest
        .fn()
        .mockReturnValueOnce({ State: "Pending" })
        .mockReturnValueOnce({ State: "Active" }),
    });
    const res = await waitUntilFunctionIsActive();
    expect(res).toStrictEqual(true);
    expect(sleep.sleep).toHaveBeenCalledTimes(1);
  });

  test("times out waiting when the status never exits", async () => {
    awsClients.getLambdaClient.mockReturnValue({
      send: () => ({ State: "Pending" }),
    });
    const res = await waitUntilFunctionIsActive();
    expect(res).toStrictEqual(false);
    expect(sleep.sleep).toHaveBeenCalledTimes(10);
  });
});

describe("selectFunctionFieldsForLogging", () => {
  test("should include only selected fields", () => {
    const lambdaFunc = createTestLambdaFunction({
      functionName: "functionA",
      functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
      runtime: "go1.x",
      tags: new Set(["foo:bar"]),
      layers: [],
      extraFields: {
        Description: "This is a test function",
        Role: "arn:aws:iam::123456789012:role/lambda-role",
      },
    });
    const lambdaFuncWithSelectedFields =
      selectFunctionFieldsForLogging(lambdaFunc);
    expect(lambdaFuncWithSelectedFields).toStrictEqual({
      FunctionName: "functionA",
      FunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
      Runtime: "go1.x",
      Architectures: undefined,
      Tags: Array.from(lambdaFunc.Tags),
      Layers: lambdaFunc.Layers,
    });
  });
});
