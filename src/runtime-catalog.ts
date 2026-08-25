// This file is generated. Do not edit it directly.

export type RuntimeCatalogGroup = {
  library: string;
  runtimes: readonly string[];
  tracerLayerPrefix?: string;
  configField?: string;
  jsonConfigField?: string;
};

export const RUNTIME_CATALOG = [
  {
    library: "dotnet",
    runtimes: ["dotnet6", "dotnet8", "dotnet10"],
    tracerLayerPrefix: "dd-trace-dotnet",
    configField: "dotnetLayerVersion",
    jsonConfigField: "dotnet_layer_version",
  },
  {
    library: "java",
    runtimes: ["java8", "java8.al2", "java11", "java17", "java21", "java25"],
    tracerLayerPrefix: "dd-trace-java",
    configField: "javaLayerVersion",
    jsonConfigField: "java_layer_version",
  },
  {
    library: "node",
    runtimes: [
      "nodejs14.x",
      "nodejs16.x",
      "nodejs18.x",
      "nodejs20.x",
      "nodejs22.x",
      "nodejs24.x",
    ],
    tracerLayerPrefix: "Datadog-Node",
    configField: "nodeLayerVersion",
    jsonConfigField: "node_layer_version",
  },
  {
    library: "extension",
    runtimes: ["provided.al2", "provided.al2023"],
  },
  {
    library: "python",
    runtimes: [
      "python3.7",
      "python3.8",
      "python3.9",
      "python3.10",
      "python3.11",
      "python3.12",
      "python3.13",
      "python3.14",
    ],
    tracerLayerPrefix: "Datadog-Python",
    configField: "pythonLayerVersion",
    jsonConfigField: "python_layer_version",
  },
  {
    library: "ruby",
    runtimes: ["ruby3.2", "ruby3.3", "ruby3.4", "ruby4.0"],
    tracerLayerPrefix: "Datadog-Ruby",
    configField: "rubyLayerVersion",
    jsonConfigField: "ruby_layer_version",
  },
] satisfies readonly RuntimeCatalogGroup[];
