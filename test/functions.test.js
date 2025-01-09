const {
  satisfiesTargetingRules,
  isRemoteInstrumenter,
  isBelowMinimumMemorySize,
  isCorrectlyInstrumented,
  needsInstrumentationUpdate,
  filterFunctionsToChangeInstrumentation,
} = require("../src/functions");
const {
  DD_SLS_REMOTE_INSTRUMENTER_VERSION,
  VERSION,
} = require("../src/consts");

// Creates a test config object
function createTestConfig({
  entityType,
  extensionVersion,
  nodeLayerVersion,
  pythonLayerVersion,
  priority,
  ruleFilters,
}) {
  return {
    configVersion: 1,
    entityType: entityType,
    extensionVersion: extensionVersion,
    nodeLayerVersion: nodeLayerVersion,
    pythonLayerVersion: pythonLayerVersion,
    priority: priority,
    ruleFilters: ruleFilters,
    instrumenterFunctionName: "datadog-remote-instrumenter",
    minimumMemorySize: 512,
  };
}

// Creates a test lambda function object
function createTestLambdaFunction({
  functionName,
  functionArn,
  memorySize,
  runtime,
  tags,
  layers,
}) {
  return {
    FunctionName: functionName,
    FunctionArn: functionArn,
    MemorySize: memorySize,
    Runtime: runtime,
    Tags: tags,
    Layers: layers,
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
});

describe("isRemoteInstrumenter", () => {
  test("should return true if the function names match", () => {
    expect(isRemoteInstrumenter("functionA", "functionA")).toBe(true);
  });
  test("should return false if the function names don't match", () => {
    expect(isRemoteInstrumenter("functionB", "functionA")).toBe(false);
  });
});

describe("isBelowMinimumMemorySize", () => {
  test("should return true if the memory size is below the minimum", () => {
    expect(isBelowMinimumMemorySize(128, 512)).toBe(true);
  });
  test("should return false if the memory size is above the minimum", () => {
    expect(isBelowMinimumMemorySize(513, 512)).toBe(false);
  });
  test("should return false if the memory size is equal to the minimum", () => {
    expect(isBelowMinimumMemorySize(512, 512)).toBe(false);
  });
});

describe("isCorrectlyInstrumented", () => {
  describe("When the extension and runtime layer versions are defined", () => {
    test("should return true if both layers have the correct versions", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(true);
    });
    test("should return false if the node layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:5",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the node layer is missing", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the python layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Python:5",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "python3.8",
        ),
      ).toBe(false);
    });
    test("should return false if the python layer is missing", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "python3.8",
        ),
      ).toBe(false);
    });
    test("should return false if the extension layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:3",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the extension layer is missing", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
  });
  describe("When the extension layer is undefined", () => {
    test("should return true if extension layer is omitted and runtime layer is correct", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(true);
    });
    test("should return false if extension layer is present", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the node layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:5",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the node layer is missing", () => {
      expect(
        isCorrectlyInstrumented(
          [],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the python layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Python:5",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the python layer is missing", () => {
      expect(
        isCorrectlyInstrumented(
          [],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: 2,
            pythonLayerVersion: 3,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
  });
  describe("When the runtime layer is undefined", () => {
    test("should return true if the runtime layer is omitted and extension layer is correct", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(true);
    });
    test("should return false if the node layer is present", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            priority: 1,
            ruleFilters: [],
          }),

          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the python layer is present", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Python:2",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            priority: 1,
            ruleFilters: [],
          }),

          "python3.8",
        ),
      ).toBe(false);
    });
    test("should return false if the extension layer has the wrong version", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:3",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            priority: 1,
            ruleFilters: [],
          }),

          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the extension layer is missing", () => {
      expect(
        isCorrectlyInstrumented(
          [],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: 1,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            priority: 1,
            ruleFilters: [],
          }),

          "nodejs14.x",
        ),
      ).toBe(false);
    });
  });
  describe("When both layers are undefined", () => {
    test("should return true if both layers are omitted", () => {
      expect(
        isCorrectlyInstrumented(
          [],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(true);
    });
    test("should return false if the node layer is present", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node:2",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
    test("should return false if the python layer is present", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Python:2",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            priority: 1,
            ruleFilters: [],
          }),
          "python3.8",
        ),
      ).toBe(false);
    });
    test("should return false if the extension layer is present", () => {
      expect(
        isCorrectlyInstrumented(
          [
            {
              Arn: "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:1",
            },
          ],
          createTestConfig({
            entityType: "lambda",
            extensionVersion: undefined,
            nodeLayerVersion: undefined,
            pythonLayerVersion: undefined,
            priority: 1,
            ruleFilters: [],
          }),
          "nodejs14.x",
        ),
      ).toBe(false);
    });
  });
});

describe("needsInstrumentationUpdate", () => {
  const instrumentOutcome = {
    instrument: { succeeded: {}, failed: {}, skipped: {} },
    uninstrument: { succeeded: {}, failed: {}, skipped: {} },
  };
  describe("When targeting rules are not satisfied", () => {
    test("not instrumented function should not be changed", () => {
      const lambdaFunc = createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        memorySize: 512,
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
        needsInstrumentationUpdate(lambdaFunc, config, instrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(false);
      expect(untag).toBe(false);
    });
    test("instrumented function should be uninstrumented and untagged", () => {
      const lambdaFunc = createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        memorySize: 512,
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
        needsInstrumentationUpdate(lambdaFunc, config, instrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(true);
      expect(tag).toBe(false);
      expect(untag).toBe(true);
    });
  });
  describe("When it's the remote instrumenter lambda", () => {
    test("function should not be changed", () => {
      const lambdaFunc = createTestLambdaFunction({
        functionName: "datadog-remote-instrumenter",
        functionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:datadog-remote-instrumenter",
        memorySize: 512,
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
        needsInstrumentationUpdate(lambdaFunc, config, instrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(false);
      expect(untag).toBe(false);
    });
  });
  describe("When the memory size is below the minimum", () => {
    test("function should not be changed", () => {
      const lambdaFunc = createTestLambdaFunction({
        functionName: "functionA",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionA",
        memorySize: 128,
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
        needsInstrumentationUpdate(lambdaFunc, config, instrumentOutcome);
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
        memorySize: 512,
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
        needsInstrumentationUpdate(lambdaFunc, config, instrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(false);
      expect(untag).toBe(false);
    });
  });
  describe("When the function is already correctly instrumented", () => {
    test("untagged function should be tagged", () => {
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
        memorySize: 512,
        runtime: "nodejs14.x",
        tags: new Set(["foo:bar"]),
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
        priority: 1,
        ruleFilters: ruleFilters,
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, instrumentOutcome);
      expect(instrument).toBe(false);
      expect(uninstrument).toBe(false);
      expect(tag).toBe(true);
      expect(untag).toBe(false);
    });
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
        memorySize: 512,
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
        priority: 1,
        ruleFilters: ruleFilters,
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, instrumentOutcome);
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
        memorySize: 512,
        runtime: "nodejs14.x",
        tags: new Set(["foo:bar"]),
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
        priority: 1,
        ruleFilters: ruleFilters,
      });
      const { instrument, uninstrument, tag, untag } =
        needsInstrumentationUpdate(lambdaFunc, config, instrumentOutcome);
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
        memorySize: 512,
        runtime: "nodejs14.x",
        tags: new Set(["foo:bar"]),
        layers: [],
      }),
      // Function B should be uninstrumented and untagged
      createTestLambdaFunction({
        functionName: "functionB",
        functionArn: "arn:aws:lambda:us-east-1:123456789012:function:functionB",
        memorySize: 512,
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
    const instrumentOutcome = {
      instrument: { succeeded: {}, failed: {}, skipped: {} },
      uninstrument: { succeeded: {}, failed: {}, skipped: {} },
    };
    const {
      functionsToInstrument,
      functionsToUninstrument,
      functionsToTag,
      functionsToUntag,
    } = filterFunctionsToChangeInstrumentation(
      functionsToCheck,
      config,
      instrumentOutcome,
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
