import { describe, test, expect, beforeEach, vi } from "vitest";

import {
  satisfiesTargetingRules,
  isRemoteInstrumenter,
  isCorrectlyInstrumented,
  needsInstrumentationUpdate,
  filterFunctionsToChangeInstrumentation,
  isInstrumented,
  waitUntilFunctionIsActive,
  selectFunctionFieldsForLogging,
  enrichFunctionsWithTags,
} from "../src/functions";
import {
  DD_SLS_REMOTE_INSTRUMENTER_VERSION,
  VERSION,
  DD_TRACE_ENABLED,
  DD_SERVERLESS_LOGS_ENABLED,
} from "../src/consts";
import * as awsClients from "../src/aws-resources";
import * as sleep from "../src/sleep";
import { baseInstrumentOutcome } from "./test-utils";

vi.mock("../src/aws-resources");
vi.mock("../src/sleep");

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
}: any) {
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
}: any) {
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
    test("should return true if the function has an allowed tag with different casing", () => {
      // Tag value casing is different
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:Bar"]), [
          {
            key: "foo",
            values: ["bar", "baz"],
            allow: true,
            filterType: "tag",
          },
        ]),
      ).toBe(true);
      // Tag key casing is different
      expect(
        satisfiesTargetingRules("functionA", new Set(["FOO:bar"]), [
          {
            key: "foo",
            values: ["bar", "baz"],
            allow: true,
            filterType: "tag",
          },
        ]),
      ).toBe(true);
      // Tag key and value casing are both different
      expect(
        satisfiesTargetingRules("functionA", new Set(["FOO:bAR"]), [
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
    test("should return false if the function name does not match", () => {
      expect(
        satisfiesTargetingRules("functionA", new Set(["foo:bar"]), [
          {
            key: "functionName",
            values: ["FUNCTIONA"],
            allow: true,
            filterType: "function_name",
          },
        ]),
      ).toBe(false);
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
        needsInstrumentationUpdate(
          lambdaFunc,
          config,
          baseInstrumentOutcome,
          false,
        );
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
        needsInstrumentationUpdate(
          lambdaFunc,
          config,
          baseInstrumentOutcome,
          false,
        );
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
        needsInstrumentationUpdate(
          lambdaFunc,
          {} as any,
          baseInstrumentOutcome,
          false,
        );
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(false);
      expect(untag).toBe(false);
      expect(
        (baseInstrumentOutcome.instrument.skipped as any)[functionName]
          .reasonCode,
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
        needsInstrumentationUpdate(
          lambdaFunc,
          config,
          baseInstrumentOutcome,
          false,
        );
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
        needsInstrumentationUpdate(
          lambdaFunc,
          config,
          baseInstrumentOutcome,
          false,
        );
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
        needsInstrumentationUpdate(
          lambdaFunc,
          config,
          baseInstrumentOutcome,
          false,
        );
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
        needsInstrumentationUpdate(
          lambdaFunc,
          config,
          baseInstrumentOutcome,
          false,
        );
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
        needsInstrumentationUpdate(
          lambdaFunc,
          config,
          baseInstrumentOutcome,
          false,
        );
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
    const { functionsToInstrumentOrTag, functionsToUninstrumentOrUntag } =
      filterFunctionsToChangeInstrumentation(
        functionsToCheck,
        config,
        baseInstrumentOutcome,
      );
    expect(Object.keys(functionsToInstrumentOrTag).length).toBe(1);
    expect(Object.keys(functionsToUninstrumentOrUntag).length).toBe(1);
    expect(functionsToInstrumentOrTag[0].needsInstrumentation).toBe(true);
    expect(functionsToInstrumentOrTag[0].needsTagging).toBe(true);
    expect(functionsToUninstrumentOrUntag[0].needsUninstrumentation).toBe(true);
    expect(functionsToUninstrumentOrUntag[0].needsUntagging).toBe(true);
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
      "Is instrumented with DD_API_KEY_SECRET_ARN and DD_SITE",
      {
        Environment: {
          Variables: {
            DD_API_KEY_SECRET_ARN:
              "arn:aws:secretsmanager:us-east-1:123456789012:secret:dd-api-key",
            DD_SITE: "datadoghq.com",
          },
        },
      },
      true,
    ],
    [
      "Is instrumented with DD_API_KEY_SSM_ARN and DD_SITE",
      {
        Environment: {
          Variables: {
            DD_API_KEY_SSM_ARN:
              "arn:aws:ssm:us-east-2:425362996713:parameter/dev/DD_API_KEY",
            DD_SITE: "datadoghq.com",
          },
        },
      },
      true,
    ],
    [
      "Is instrumented with DD_KMS_API_KEY and DD_SITE",
      {
        Environment: {
          Variables: {
            DD_KMS_API_KEY: "encrypted-key",
            DD_SITE: "datadoghq.com",
          },
        },
      },
      true,
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
    expect(isInstrumented(lambdaFunc as any)).toBe(expected);
  });
});

describe("waitUntilFunctionIsActive", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("stops when the status is active", async () => {
    vi.mocked(awsClients.getLambdaClient).mockReturnValue({
      send: () => ({ State: "Active" }),
    } as any);
    const res = await waitUntilFunctionIsActive("test-function");
    expect(res).toStrictEqual(true);
    expect(sleep.sleep).toHaveBeenCalledTimes(0);
  });

  test("stops when the status is active after the second time", async () => {
    vi.mocked(awsClients.getLambdaClient).mockReturnValue({
      send: vi
        .fn()
        .mockReturnValueOnce({ State: "Pending" })
        .mockReturnValueOnce({ State: "Active" }),
    } as any);
    const res = await waitUntilFunctionIsActive("test-function");
    expect(res).toStrictEqual(true);
    expect(sleep.sleep).toHaveBeenCalledTimes(1);
  });

  test("times out waiting when the status never exits", async () => {
    vi.mocked(awsClients.getLambdaClient).mockReturnValue({
      send: () => ({ State: "Pending" }),
    } as any);
    const res = await waitUntilFunctionIsActive("test-function");
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

describe("enrichFunctionsWithTags", () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockClient = {
      send: vi.fn(),
    };
  });

  test("should include tags from DD_TAGS env var, AWS resource tags, and runtime", async () => {
    const functions = [
      createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: { env: "prod", team: "backend" },
        layers: [],
        envVars: {
          DD_TAGS: "service:api version:1.0.0",
        },
      }),
      createTestLambdaFunction({
        functionName: "functionB",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionB",
        runtime: "python3.8",
        tags: { env: "staging", team: "frontend" },
        layers: [],
        envVars: {},
      }),
    ];

    const enrichedFunctions = await enrichFunctionsWithTags(
      mockClient,
      functions,
    );

    expect(enrichedFunctions[0].Tags).toEqual(
      new Set([
        "service:api",
        "version:1.0.0",
        "env:prod",
        "team:backend",
        "runtime:nodejs14.x",
      ]),
    );
    expect(enrichedFunctions[1].Tags).toEqual(
      new Set(["env:staging", "team:frontend", "runtime:python3.8"]),
    );
  });

  test("should fetch AWS resource tags when Tags property is not present", async () => {
    const functions = [
      createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        layers: [],
        envVars: {},
      }),
    ];

    mockClient.send.mockResolvedValue({
      Tags: {
        env: "staging",
        owner: "devops",
      },
    });

    const enrichedFunctions = await enrichFunctionsWithTags(
      mockClient,
      functions,
    );

    expect(enrichedFunctions[0].Tags).toEqual(
      new Set(["env:staging", "owner:devops", "runtime:nodejs14.x"]),
    );
  });

  test("should not fetch AWS resource tags when Tags property is already present", async () => {
    const functions = [
      createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: { env: "prod" },
        layers: [],
        envVars: {},
      }),
    ];

    const enrichedFunctions = await enrichFunctionsWithTags(
      mockClient,
      functions,
    );

    expect(mockClient.send).not.toHaveBeenCalled();
    expect(enrichedFunctions[0].Tags).toEqual(
      new Set(["env:prod", "runtime:nodejs14.x"]),
    );
  });

  test("should deduplicate tags correctly", async () => {
    const functions = [
      createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: { env: "prod", service: "api" },
        layers: [],
        envVars: {
          DD_TAGS: "env:prod service:web",
        },
      }),
    ];

    const enrichedFunctions = await enrichFunctionsWithTags(
      mockClient,
      functions,
    );

    // env:prod should appear only once, service:api and service:web should both appear
    expect(enrichedFunctions[0].Tags).toEqual(
      new Set(["env:prod", "service:api", "service:web", "runtime:nodejs14.x"]),
    );
  });

  test("should store aws:-prefixed tags in both raw and REDAPL-normalized form", async () => {
    // REDAPL converts colons in tag keys to underscores, so the Datadog UI shows
    // aws:cloudformation:stack-name as aws_cloudformation_stack-name.
    // The instrumenter must match rule filters expressed in either form.
    // Only aws:-prefixed keys get this treatment to avoid false positives between
    // unrelated user tags like foo:bar and foo_bar.
    const functions = [
      createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        tags: {
          "aws:cloudformation:stack-name": "my-stack",
          "foo:bar": "baz",
        },
        layers: [],
        envVars: {},
      }),
    ];

    const enrichedFunctions = await enrichFunctionsWithTags(
      mockClient,
      functions,
    );

    // Raw AWS form (for filters using the original tag key)
    expect(enrichedFunctions[0].Tags).toContain(
      "aws:cloudformation:stack-name:my-stack",
    );
    // REDAPL-normalized form (for filters as shown in the Datadog UI)
    expect(enrichedFunctions[0].Tags).toContain(
      "aws_cloudformation_stack-name:my-stack",
    );
    // Non-aws: tags with colons should NOT be duplicated in normalized form
    expect(enrichedFunctions[0].Tags).toContain("foo:bar:baz");
    expect(enrichedFunctions[0].Tags).not.toContain("foo_bar:baz");
  });

  test("should handle AWS resource tags with empty object", async () => {
    const functions = [
      createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        runtime: "nodejs14.x",
        layers: [],
        envVars: {},
      }),
    ];

    mockClient.send.mockResolvedValue({
      Tags: {},
    });

    const enrichedFunctions = await enrichFunctionsWithTags(
      mockClient,
      functions,
    );
    expect(enrichedFunctions[0].Tags).toEqual(new Set(["runtime:nodejs14.x"]));
  });
});
