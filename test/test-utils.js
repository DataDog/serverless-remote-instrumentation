function constructTestJSON({
  configVersion,
  entityType,
  extensionVersion,
  nodeLayerVersion,
  pythonLayerVersion,
  javaLayerVersion,
  dotnetLayerVersion,
  rubyLayerVersion,
  ddTraceEnabled,
  ddServerlessLogsEnabled,
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
      java_layer_version: javaLayerVersion,
      dotnet_layer_version: dotnetLayerVersion,
      ruby_layer_version: rubyLayerVersion,
      dd_trace_enabled: ddTraceEnabled,
      dd_serverless_logs_enabled: ddServerlessLogsEnabled,
    },
    priority: priority,
    rule_filters: ruleFilters,
  };
}
exports.constructTestJSON = constructTestJSON;

const sampleRcTestJSON = constructTestJSON({
  configVersion: 1,
  entityType: "lambda",
  extensionVersion: 10,
  nodeLayerVersion: 20,
  pythonLayerVersion: 30,
  javaLayerVersion: 40,
  dotnetLayerVersion: 50,
  rubyLayerVersion: 60,
  ddTraceEnabled: true,
  ddServerlessLogsEnabled: false,
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
exports.sampleRcTestJSON = sampleRcTestJSON;

const sampleRcConfigID = "datadog/2/abc-123-def";
exports.sampleRcConfigID = sampleRcConfigID;

const sampleRcMetadata = {
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
exports.sampleRcMetadata = sampleRcMetadata;

const baseInstrumentOutcome = {
  instrument: { succeeded: {}, failed: {}, skipped: {} },
  uninstrument: { succeeded: {}, failed: {}, skipped: {} },
};
exports.baseInstrumentOutcome = baseInstrumentOutcome;
