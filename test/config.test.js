const {
  isCacheValid,
  updateCache,
  RcConfig,
  getConfigsFromResponse,
  getConfigs,
  CONFIG_CACHE,
} = require("../src/config");
const { FILTER_TYPES, CONFIG_CACHE_TTL_MS } = require("../src/consts");
const {
  constructTestJSON,
  sampleRcConfigID,
  sampleRcMetadata,
  sampleRcTestJSON,
} = require("./test-utils");

jest.mock("axios", () => ({
  post: jest.fn(),
}));

describe("Config constructor", () => {
  it("creates an RcConfig object out of well-formed JSON", () => {
    const rcConfig = new RcConfig(
      sampleRcConfigID,
      sampleRcTestJSON,
      sampleRcMetadata,
    );
    expect(rcConfig.configVersion).toBe(1);
    expect(rcConfig.entityType).toBe("lambda");
    expect(rcConfig.extensionVersion).toBe(10);
    expect(rcConfig.nodeLayerVersion).toBe(20);
    expect(rcConfig.pythonLayerVersion).toBe(30);
    expect(rcConfig.priority).toBe(1);
    expect(rcConfig.ruleFilters.length).toBe(2);
    expect(rcConfig.rcConfigVersion).toBe(3);
    expect(rcConfig.configID).toBe(sampleRcConfigID);
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
    const rcConfig = new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata);
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
    expect(
      () => new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata),
    ).toThrow(
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
    expect(
      () => new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata),
    ).toThrow(
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
    expect(
      () => new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata),
    ).toThrow(
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
    expect(
      () => new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata),
    ).toThrow(
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
    expect(
      () => new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata),
    ).toThrow(
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
    expect(
      () => new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata),
    ).toThrow("Received invalid configuration: priority must be a number");
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
    expect(
      () => new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata),
    ).toThrow("Received invalid configuration: rule filters must be an array");
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
    expect(
      () => new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata),
    ).toThrow(
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
    expect(
      () => new RcConfig(sampleRcConfigID, testJSON, sampleRcMetadata),
    ).toThrow(
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

describe("Config cache", () => {
  const sampleRcConfig = new RcConfig(
    sampleRcConfigID,
    sampleRcTestJSON,
    sampleRcMetadata,
  );

  beforeEach(() => {
    CONFIG_CACHE.configs = null;
    CONFIG_CACHE.expirationTime = null;
  });

  describe("isCacheValid", () => {
    test("returns false when configs and expiration time are null", () => {
      expect(isCacheValid()).toBe(false);
    });

    test("returns false when expiration time is null", () => {
      CONFIG_CACHE.configs = [sampleRcConfig];
      expect(isCacheValid()).toBe(false);
    });

    test("returns false when configs are null", () => {
      CONFIG_CACHE.expirationTime = Date.now() + CONFIG_CACHE_TTL_MS;
      expect(isCacheValid()).toBe(false);
    });

    test("returns false when cache has expired", () => {
      CONFIG_CACHE.configs = [sampleRcConfig];
      CONFIG_CACHE.expirationTime = Date.now() - 1000; // Expired 1 second ago
      expect(isCacheValid()).toBe(false);
    });

    test("returns true when cache is non-null and not expired", () => {
      CONFIG_CACHE.configs = [sampleRcConfig];
      CONFIG_CACHE.expirationTime = Date.now() + CONFIG_CACHE_TTL_MS;
      expect(isCacheValid()).toBe(true);
    });

    test("returns true when cache is set to no configs and not expired", () => {
      CONFIG_CACHE.configs = [];
      CONFIG_CACHE.expirationTime = Date.now() + CONFIG_CACHE_TTL_MS;
      expect(isCacheValid()).toBe(true);
    });
  });

  describe("updateCache", () => {
    test("updates cache with new configs and sets expiration time", () => {
      const newConfigs = [sampleRcConfig, sampleRcConfig];
      updateCache(newConfigs);

      expect(CONFIG_CACHE.configs).toEqual(newConfigs);
      expect(CONFIG_CACHE.expirationTime).toBeGreaterThan(Date.now());
      expect(CONFIG_CACHE.expirationTime).toBeLessThanOrEqual(
        Date.now() + CONFIG_CACHE_TTL_MS,
      );
    });

    test("overwrites existing cache with new configs", () => {
      CONFIG_CACHE.configs = [sampleRcConfig];
      CONFIG_CACHE.expirationTime = Date.now() - 1000;

      const newConfigs = [];
      updateCache(newConfigs);

      expect(CONFIG_CACHE.configs).toEqual(newConfigs);
      expect(CONFIG_CACHE.expirationTime).toBeGreaterThan(Date.now());
      expect(CONFIG_CACHE.expirationTime).toBeLessThanOrEqual(
        Date.now() + CONFIG_CACHE_TTL_MS,
      );
    });
  });
});

describe("getConfigs", () => {
  let mockS3Client;
  let mockContext;
  let mockedAxios;

  beforeEach(() => {
    mockS3Client = {
      send: jest.fn(),
    };
    mockContext = {
      invokedFunctionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:test-function",
    };
    CONFIG_CACHE.configs = null;
    CONFIG_CACHE.expirationTime = null;
    mockedAxios = require("axios");
    mockedAxios.post.mockReset();
  });

  test("should use cached configs when they are valid", async () => {
    const cachedConfigs = [
      new RcConfig(sampleRcConfigID, sampleRcTestJSON, sampleRcMetadata),
    ];
    CONFIG_CACHE.configs = cachedConfigs;
    const expirationTime = Date.now() + CONFIG_CACHE_TTL_MS;
    CONFIG_CACHE.expirationTime = expirationTime;

    const configs = await getConfigs(mockS3Client, mockContext);

    // Check that configs are returned from the cache
    expect(configs).toEqual(cachedConfigs);
    expect(mockedAxios.post).toHaveBeenCalledTimes(0);

    // Check that cached configs and expiration time are unchanged
    expect(CONFIG_CACHE.configs).toEqual(cachedConfigs);
    expect(CONFIG_CACHE.expirationTime).toBe(expirationTime);
  });

  test("should fetch configs from RC when cached configs are null", async () => {
    const path = "datadog/2/SERVERLESS_REMOTE_INSTRUMENTATION/new-id";
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        target_files: [
          {
            path: path,
            raw: btoa(JSON.stringify(sampleRcTestJSON)),
          },
        ],
        client_configs: [path],
        targets: btoa(
          JSON.stringify({
            signed: {
              targets: {
                [path]: sampleRcMetadata,
              },
            },
          }),
        ),
      },
    });

    const configs = await getConfigs(mockS3Client, mockContext);

    // Check that new configs are fetched
    expect(configs.length).toBe(1);
    expect(configs[0].configID).toBe("new-id");
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    // Check that cache was updated
    expect(CONFIG_CACHE.configs.length).toBe(1);
    expect(CONFIG_CACHE.configs[0].configID).toBe("new-id");
    expect(CONFIG_CACHE.expirationTime).toBeGreaterThan(Date.now());
    expect(CONFIG_CACHE.expirationTime).toBeLessThanOrEqual(
      Date.now() + CONFIG_CACHE_TTL_MS,
    );
  });

  test("should fetch new configs when cache is expired", async () => {
    const oldConfigs = [
      new RcConfig("old-id", sampleRcTestJSON, sampleRcMetadata),
    ];

    CONFIG_CACHE.configs = oldConfigs;
    CONFIG_CACHE.expirationTime = Date.now() - 1000; // Expired 1 second ago

    const path = "datadog/2/SERVERLESS_REMOTE_INSTRUMENTATION/new-id";
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        target_files: [
          {
            path: path,
            raw: btoa(JSON.stringify(sampleRcTestJSON)),
          },
        ],
        client_configs: [path],
        targets: btoa(
          JSON.stringify({
            signed: {
              targets: {
                [path]: sampleRcMetadata,
              },
            },
          }),
        ),
      },
    });

    const configs = await getConfigs(mockS3Client, mockContext);

    // Check that new configs are fetched
    expect(configs.length).toBe(1);
    expect(configs[0].configID).toBe("new-id");
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    // Check that cache was updated
    expect(CONFIG_CACHE.configs.length).toBe(1);
    expect(CONFIG_CACHE.configs[0].configID).toBe("new-id");
    expect(CONFIG_CACHE.expirationTime).toBeGreaterThan(Date.now());
    expect(CONFIG_CACHE.expirationTime).toBeLessThanOrEqual(
      Date.now() + CONFIG_CACHE_TTL_MS,
    );
  });

  test("should handle empty configs from RC", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        target_files: [],
        client_configs: [],
        targets: btoa(
          JSON.stringify({
            signed: {
              targets: {},
            },
          }),
        ),
      },
    });

    const configs = await getConfigs(mockS3Client, mockContext);
    // Check that configs are empty
    expect(configs).toEqual([]);

    // Check that cache was updated
    expect(CONFIG_CACHE.configs).toEqual([]);
    expect(CONFIG_CACHE.expirationTime).toBeGreaterThan(Date.now());
    expect(CONFIG_CACHE.expirationTime).toBeLessThanOrEqual(
      Date.now() + CONFIG_CACHE_TTL_MS,
    );
  });

  test("should not update cache when there is an error", async () => {
    const oldConfigs = [
      new RcConfig("old-id", sampleRcTestJSON, sampleRcMetadata),
    ];
    const expirationTime = Date.now() - 1000;
    CONFIG_CACHE.configs = oldConfigs;
    CONFIG_CACHE.expirationTime = expirationTime;
    mockedAxios.post.mockRejectedValueOnce(new Error("Some error"));

    // Check that the error is thrown
    await expect(getConfigs(mockS3Client, mockContext)).rejects.toThrow(
      "Failed to retrieve configs",
    );

    // Check that cache was not updated
    expect(CONFIG_CACHE.configs).toEqual(oldConfigs);
    expect(CONFIG_CACHE.expirationTime).toBe(expirationTime);
  });
});
