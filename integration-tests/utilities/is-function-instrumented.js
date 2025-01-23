const { GetFunctionConfigurationCommand } = require("@aws-sdk/client-lambda");
const { getRemoteConfig } = require("./remote-config");

const hasLayerMatching = (l, matcher, version) =>
  l?.Layers?.some(
    (layer) =>
      layer.Arn.includes(matcher) &&
      Number(layer.Arn.split(":").at(-1)) === version,
  );
const hasEnvVar = (l, varName) =>
  Object.keys(l.Environment.Variables).includes(varName);

// A function is considered instrumented if all are true:
// 1. If the extension layer is configured, there is a Datadog-Extension with matching version
// 2. If there is a language layer configured, there should is a matching version of the language layer
// 3. It has the DD_API_KEY and DD_SITE environment variables
const isFunctionInstrumented = async (secretsManager, lambda, functionName) => {
  const funConfig = await lambda.send(
    new GetFunctionConfigurationCommand({
      FunctionName: functionName,
    }),
  );
  const rc = await getRemoteConfig(secretsManager);
  const { extension_version, node_layer_version, python_layer_version } =
    rc.data[0].attributes.instrumentation_settings;

  if (
    funConfig.Runtime.toLowerCase().includes("python") &&
    python_layer_version
  ) {
    if (!hasLayerMatching(funConfig, "Datadog-Python", python_layer_version)) {
      return false;
    }
  }

  if (funConfig.Runtime.toLowerCase().includes("node") && node_layer_version) {
    if (!hasLayerMatching(funConfig, "Datadog-Node", node_layer_version)) {
      return false;
    }
  }

  if (extension_version) {
    if (!hasLayerMatching(funConfig, "Datadog-Extension", extension_version)) {
      return false;
    }
  }

  return hasEnvVar(funConfig, "DD_API_KEY") && hasEnvVar(funConfig, "DD_SITE");
};

exports.isFunctionInstrumented = isFunctionInstrumented;
