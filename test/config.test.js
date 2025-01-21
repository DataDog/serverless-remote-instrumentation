const { RcConfig, getConfigsFromResponse } = require("../src/config");
const { FILTER_TYPES } = require("../src/consts");

describe("Config constructor", () => {
  const rcConfigID = "datadog/2/abc-123-def";
  const rcMetadata = {
    custom: {
      c: ["abc-def-ghi"],
      "tracer-predicates": {
        tracer_predicates_v1: [
          {
            clientID: "jkl-mno-pqr",
          },
        ],
      },
      v: 3,
    },
    hashes: {
      sha256: "stu-vwx-yza",
    },
    length: 500,
  };
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
    const rcConfig = new RcConfig(rcConfigID, testJSON, rcMetadata);
    expect(rcConfig.configVersion).toBe(1);
    expect(rcConfig.entityType).toBe("lambda");
    expect(rcConfig.extensionVersion).toBe(10);
    expect(rcConfig.nodeLayerVersion).toBe(20);
    expect(rcConfig.pythonLayerVersion).toBe(30);
    expect(rcConfig.priority).toBe(1);
    expect(rcConfig.ruleFilters.length).toBe(2);
    expect(rcConfig.rcConfigVersion).toBe(3);
    expect(rcConfig.configID).toBe(rcConfigID);
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
    const rcConfig = new RcConfig(rcConfigID, testJSON, rcMetadata);
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
    expect(() => new RcConfig(rcConfigID, testJSON, rcMetadata)).toThrow(
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
    expect(() => new RcConfig(rcConfigID, testJSON, rcMetadata)).toThrow(
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
    expect(() => new RcConfig(rcConfigID, testJSON, rcMetadata)).toThrow(
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
    expect(() => new RcConfig(rcConfigID, testJSON, rcMetadata)).toThrow(
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
    expect(() => new RcConfig(rcConfigID, testJSON, rcMetadata)).toThrow(
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
    expect(() => new RcConfig(rcConfigID, testJSON, rcMetadata)).toThrow(
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
    expect(() => new RcConfig(rcConfigID, testJSON, rcMetadata)).toThrow(
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
    expect(() => new RcConfig(rcConfigID, testJSON, rcMetadata)).toThrow(
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
    expect(() => new RcConfig(rcConfigID, testJSON, rcMetadata)).toThrow(
      "Received invalid configuration: rule filter values field must be a non-empty array",
    );
  });
});

describe("getConfigsFromResponse", () => {
  const rcConfigPath =
    "datadog/2/SERVERLESS_REMOTE_INSTRUMENTATION/abc-123-def";
  test("should error when there is no data", () => {
    expect(() => getConfigsFromResponse({})).toThrow(
      "Failed to retrieve configs",
    );
  });
  test("should error when target file is not found", () => {
    expect(() =>
      getConfigsFromResponse({
        data: {
          target_files: [
            {
              path: "datadog/2/SERVERLESS_REMOTE_INSTRUMENTATION/xyz-456-uvw",
              raw: btoa(
                JSON.stringify({
                  config_version: 1,
                  entity_type: "lambda",
                  instrumentation_settings: {
                    extension_version: 10,
                  },
                  priority: 1,
                  rule_filters: [],
                }),
              ),
            },
          ],
          client_configs: [rcConfigPath],
        },
      }),
    ).toThrow(
      `Error parsing configs: target file not found for config path '${rcConfigPath}'`,
    );
  });
  test("should error when targets not found", () => {
    expect(() =>
      getConfigsFromResponse({
        data: {
          target_files: [
            {
              path: rcConfigPath,
              raw: btoa(
                JSON.stringify({
                  config_version: 1,
                  entity_type: "lambda",
                  instrumentation_settings: {
                    extension_version: 10,
                  },
                  priority: 1,
                  rule_filters: [],
                }),
              ),
            },
          ],
          client_configs: [rcConfigPath],
        },
      }),
    ).toThrow("Error parsing configs: targets not found");
  });
  test("should error when signed target data not found for config path", () => {
    expect(() =>
      getConfigsFromResponse({
        data: {
          target_files: [
            {
              path: rcConfigPath,
              raw: btoa(
                JSON.stringify({
                  config_version: 1,
                  entity_type: "lambda",
                  instrumentation_settings: {
                    extension_version: 10,
                  },
                  priority: 1,
                  rule_filters: [],
                }),
              ),
            },
          ],
          client_configs: [rcConfigPath],
          targets: btoa(
            JSON.stringify({
              signatures: [
                {
                  keyid: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                  sig: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                },
              ],
              signed: {
                _type: "targets",
                custom: {
                  agent_refresh_interval: 50,
                  opaque_backend_state: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                },
                expires: "2027-010-21T14:49:33Z",
                spec_version: "1.0.0",
                targets: {},
                version: 100000000,
              },
            }),
          ),
        },
      }),
    ).toThrow(
      `Error parsing configs: signed target data not found for config path '${rcConfigPath}'`,
    );
  });
  test("should error on invalid config", () => {
    expect(() =>
      getConfigsFromResponse({
        data: {
          target_files: [
            {
              path: rcConfigPath,
              raw: btoa(
                JSON.stringify({
                  config_version: 1,
                  entity_type: "lambda",
                }),
              ),
            },
          ],
          client_configs: [rcConfigPath],
          targets: btoa(
            JSON.stringify({
              signatures: [
                {
                  keyid: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                  sig: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                },
              ],
              signed: {
                _type: "targets",
                custom: {
                  agent_refresh_interval: 50,
                  opaque_backend_state: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                },
                expires: "2027-010-21T14:49:33Z",
                spec_version: "1.0.0",
                targets: {
                  [rcConfigPath]: {
                    custom: {
                      c: ["4a52c9a5-8037-4567-bf4d-f5aba2d25d5d"],
                      "tracer-predicates": {
                        tracer_predicates_v1: [
                          {
                            clientID: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                          },
                        ],
                      },
                      v: 3,
                    },
                    hashes: {
                      sha256: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                    },
                    length: 500,
                  },
                },
                version: 100000000,
              },
            }),
          ),
        },
      }),
    ).toThrow(
      "Error parsing configs: Received invalid configuration: priority must be a number, but received 'undefined'",
    );
  });
  test("should return empty list when there are no configs", () => {
    expect(getConfigsFromResponse({ data: { target_files: [] } })).toEqual([]);
  });
  test("should deserialize configs into objects", () => {
    const configs = getConfigsFromResponse({
      data: {
        target_files: [
          {
            path: rcConfigPath,
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
        client_configs: [rcConfigPath],
        targets: btoa(
          JSON.stringify({
            signatures: [
              {
                keyid: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                sig: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
              },
            ],
            signed: {
              _type: "targets",
              custom: {
                agent_refresh_interval: 50,
                opaque_backend_state: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
              },
              expires: "2027-010-21T14:49:33Z",
              spec_version: "1.0.0",
              targets: {
                [rcConfigPath]: {
                  custom: {
                    c: ["4a52c9a5-8037-4567-bf4d-f5aba2d25d5d"],
                    "tracer-predicates": {
                      tracer_predicates_v1: [
                        {
                          clientID: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                        },
                      ],
                    },
                    v: 3,
                  },
                  hashes: {
                    sha256: "4a52c9a5-8037-4567-bf4d-f5aba2d25d5d",
                  },
                  length: 500,
                },
              },
              version: 100000000,
            },
          }),
        ),
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
