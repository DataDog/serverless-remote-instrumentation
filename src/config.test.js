const RcConfig = require("./config").RcConfig;

describe("Config constructor", () => {
  function constructTestJSON(
    config_version,
    entity_type,
    extension_version,
    node_layer_version,
    python_layer_version,
    priority,
    rule_filters
  ) {
    return {
      config_version: config_version,
      entity_type: entity_type,
      instrumentation_settings: {
        extension_version: extension_version,
        node_layer_version: node_layer_version,
        python_layer_version: python_layer_version,
      },
      priority: priority,
      rule_filters: rule_filters,
    };
  }

  it("creates an RcConfig object out of well-formed JSON", () => {
    const testJSON = constructTestJSON(1, "lambda", 10, 20, 30, 1, [
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
    ]);
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
    const testJSON = constructTestJSON(
      1,
      "lambda",
      undefined,
      undefined,
      undefined,
      1,
      []
    );
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
    const testJSON = constructTestJSON("invalid", "lambda", 10, 20, 30, 1, []);
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: config version must be a number"
    );
  });

  it("rejects invalid entity type", () => {
    const testJSON = constructTestJSON(1, "invalid", 10, 20, 30, 1, []);
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: entity type must be one of 'lambda'"
    );
  });

  it("rejects invalid extension version", () => {
    const testJSON = constructTestJSON(1, "lambda", "invalid", 20, 30, 1, []);
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: extension version must be a number"
    );
  });

  it("rejects invalid python layer version", () => {
    const testJSON = constructTestJSON(1, "lambda", 10, 20, "invalid", 1, []);
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: python layer version must be a number"
    );
  });

  it("rejects invalid node layer version", () => {
    const testJSON = constructTestJSON(1, "lambda", 10, "invalid", 30, 1, []);
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: node layer version must be a number"
    );
  });

  it("rejects invalid priority", () => {
    const testJSON = constructTestJSON(1, "lambda", 10, 20, 30, "invalid", []);
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: priority must be a number"
    );
  });

  it("rejects non-array rule filters", () => {
    const testJSON = constructTestJSON(1, "lambda", 10, 20, 30, 1, "invalid");
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: rule filters must be an array"
    );
  });

  it("rejects rule filters of invalid types", () => {
    const testJSON = constructTestJSON(1, "lambda", 10, 20, 30, 1, [
      {
        key: "functionname",
        values: ["hello-world"],
        allow: false,
        filter_type: "invalid",
      },
    ]);
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: filterType field must be one of 'function_name, tag', but received 'invalid'"
    );
  });

  it("rejects rule filters with no values", () => {
    const testJSON = constructTestJSON(1, "lambda", 10, 20, 30, 1, [
      {
        key: "functionname",
        values: [],
        allow: false,
        filter_type: "function_name",
      },
    ]);
    expect(() => new RcConfig(testJSON)).toThrow(
      "Received invalid configuration: rule filter values field must be a non-empty array"
    );
  });
});
