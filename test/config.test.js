const { RcConfig, getConfigsFromResponse } = require("../src/config");
const { FILTER_TYPES } = require("../src/consts");

describe("Config constructor", () => {
  function constructTestJSON({
    configVersion,
    entityType,
    extensionVersion,
    nodeLayerVersion,
    pythonLayerVersion,
    priority,
    ruleFilters,
  }) {
    return {
      config_version: configVersion,
      entity_type: entityType,
      instrumentation_settings: {
        extension_version: extensionVersion,
        node_layer_version: nodeLayerVersion,
        python_layer_version: pythonLayerVersion,
      },
      priority: priority,
      rule_filters: ruleFilters,
    };
  }

  it("creates an RcConfig object out of well-formed JSON", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "lambda",
      extensionVersion: 10,
      nodeLayerVersion: 20,
      pythonLayerVersion: 30,
      priority: 1,
      ruleFilters: [
        {
          key: "env",
          values: ["prod"],
          allow: true,
          filter_type: "tag",
        },
        {
          key: "functionname",
          values: ["hello-world"],
          allow: false,
          filter_type: "function_name",
        },
      ],
    });
    const rcConfig = new RcConfig(testJSON);
    expect(rcConfig.configVersion).toBe(1);
    expect(rcConfig.entityType).toBe("lambda");
    expect(rcConfig.extensionVersion).toBe(10);
    expect(rcConfig.nodeLayerVersion).toBe(20);
    expect(rcConfig.pythonLayerVersion).toBe(30);
    expect(rcConfig.priority).toBe(1);
    expect(rcConfig.ruleFilters.length).toBe(2);
  });

  it("creates an RcConfig object out of well-formed JSON with undefined versions", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "lambda",
      extensionVersion: undefined,
      nodeLayerVersion: undefined,
      pythonLayerVersion: undefined,
      priority: 1,
      ruleFilters: [],
    });
    const rcConfig = new RcConfig(testJSON);
    expect(rcConfig.configVersion).toBe(1);
    expect(rcConfig.entityType).toBe("lambda");
    expect(rcConfig.extensionVersion).toBe(undefined);
    expect(rcConfig.nodeLayerVersion).toBe(undefined);
    expect(rcConfig.pythonLayerVersion).toBe(undefined);
    expect(rcConfig.priority).toBe(1);
    expect(rcConfig.ruleFilters.length).toBe(0);
  });

  it("rejects invalid config version", () => {
    const testJSON = constructTestJSON({
      configVersion: "invalid",
      entityType: "lambda",
      extensionVersion: 10,
      nodeLayerVersion: 20,
      pythonLayerVersion: 30,
      priority: 1,
      ruleFilters: [],
    });
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: config version must be a number",
    );
  });

  it("rejects invalid entity type", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "invalid",
      extensionVersion: 10,
      nodeLayerVersion: 20,
      pythonLayerVersion: 30,
      priority: 1,
      ruleFilters: [],
    });
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: entity type must be one of 'lambda'",
    );
  });

  it("rejects invalid extension version", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "lambda",
      extensionVersion: "invalid",
      nodeLayerVersion: 20,
      pythonLayerVersion: 30,
      priority: 1,
      ruleFilters: [],
    });
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: extension version must be a number",
    );
  });

  it("rejects invalid python layer version", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "lambda",
      extensionVersion: 10,
      nodeLayerVersion: 20,
      pythonLayerVersion: "invalid",
      priority: 1,
      ruleFilters: [],
    });
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: python layer version must be a number",
    );
  });

  it("rejects invalid node layer version", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "lambda",
      extensionVersion: 10,
      nodeLayerVersion: "invalid",
      pythonLayerVersion: 30,
      priority: 1,
      ruleFilters: [],
    });
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: node layer version must be a number",
    );
  });

  it("rejects invalid priority", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "lambda",
      extensionVersion: 10,
      nodeLayerVersion: 20,
      pythonLayerVersion: 30,
      priority: "invalid",
      ruleFilters: [],
    });
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: priority must be a number",
    );
  });

  it("rejects non-array rule filters", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "lambda",
      extensionVersion: 10,
      nodeLayerVersion: 20,
      pythonLayerVersion: 30,
      priority: 1,
      ruleFilters: "invalid",
    });
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: rule filters must be an array",
    );
  });

  it("rejects rule filters of invalid types", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "lambda",
      extensionVersion: 10,
      nodeLayerVersion: 20,
      pythonLayerVersion: 30,
      priority: 1,
      ruleFilters: [
        {
          key: "functionname",
          values: ["hello-world"],
          allow: false,
          filter_type: "invalid",
        },
      ],
    });
    expect(() => new RcConfig(testJSON)).toThrow(
      `Received invalid configuration: filterType field must be one of '${Array.from(FILTER_TYPES).join(", ")}', but received 'invalid'`,
    );
  });

  it("rejects rule filters with no values", () => {
    const testJSON = constructTestJSON({
      configVersion: 1,
      entityType: "lambda",
      extensionVersion: 10,
      nodeLayerVersion: 20,
      pythonLayerVersion: 30,
      priority: 1,
      ruleFilters: [
        {
          key: "functionname",
          values: [],
          allow: false,
          filter_type: "function_name",
        },
      ],
    });
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: rule filter values field must be a non-empty array",
    );
  });
});

describe("getConfigsFromResponse", () => {
  test("should error when there is no data", () => {
    expect(() => getConfigsFromResponse({})).toThrow(
      "Failed to retrieve configs",
    );
  });
  test("should error when target files have no raw data", () => {
    expect(() =>
      getConfigsFromResponse({ data: { target_files: [{}] } }),
    ).toThrow("Error retrieving raw data from configs");
  });
  test("should error on invalid config", () => {
    expect(() =>
      getConfigsFromResponse({
        data: {
          target_files: [
            {
              raw: "invalid",
            },
          ],
        },
      }),
    ).toThrow("Error parsing config");
  });
  test("should return empty list when there are no configs", () => {
    expect(getConfigsFromResponse({ data: { target_files: [] } })).toEqual([]);
  });

  test("should deserialize configs into objects", () => {
    const configs = getConfigsFromResponse({
      data: {
        target_files: [
          {
            raw: btoa(
              JSON.stringify({
                config_version: 1,
                entity_type: "lambda",
                instrumentation_settings: {
                  extension_version: 10,
                  node_layer_version: 20,
                  python_layer_version: 30,
                },
                priority: 1,
                rule_filters: [
                  {
                    key: "env",
                    values: ["prod"],
                    allow: true,
                    filter_type: "tag",
                  },
                  {
                    key: "functionname",
                    values: ["hello-world"],
                    allow: false,
                    filter_type: "function_name",
                  },
                ],
              }),
            ),
          },
        ],
      },
    });
    expect(configs.length).toBe(1);
    expect(configs[0].configVersion).toBe(1);
    expect(configs[0].entityType).toBe("lambda");
    expect(configs[0].extensionVersion).toBe(10);
    expect(configs[0].nodeLayerVersion).toBe(20);
    expect(configs[0].pythonLayerVersion).toBe(30);
    expect(configs[0].priority).toBe(1);
    expect(configs[0].ruleFilters.length).toBe(2);
  });
});
