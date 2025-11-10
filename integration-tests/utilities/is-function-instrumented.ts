const {
  GetFunctionConfigurationCommand,
  ListTagsCommand,
} = require("@aws-sdk/client-lambda");
const { getRemoteConfig } = require("./remote-config");
const { getLambdaClient } = require("./aws-resources");
const { isFunctionInvokable } = require("./lambda-functions");
const { ddSite } = require("../config.json");
const { pollUntilTrue } = require("./poll-until-true");

const hasLayerMatching = (l, matcher, version) =>
  l?.Layers?.some(
    (layer) =>
      layer.Arn.includes(matcher) &&
      Number(layer.Arn.split(":").at(-1)) === version,
  );

const hasLayer = (l, matcher) =>
  l?.Layers?.some((layer) => layer.Arn.includes(matcher));

const hasEnvVar = (l, varName) =>
  Object.keys(l?.Environment?.Variables || {}).includes(varName);

const hasEnvVarMatching = (l, varName, value) =>
  l?.Environment?.Variables[varName] === value;

const hasRemoteInstrumenterTag = async (functionArn) => {
  const lambdaClient = await getLambdaClient();
  try {
    const tagsResponse = await lambdaClient.send(
      new ListTagsCommand({
        Resource: functionArn,
      }),
    );
    return "dd_sls_remote_instrumenter_version" in tagsResponse.Tags;
  } catch (error) {
    console.log(
      `Error checking tags for function ${functionArn}: ${error.message}`,
    );
    return false;
  }
};
exports.hasRemoteInstrumenterTag = hasRemoteInstrumenterTag;

// A function is considered instrumented if all are true:
// 1. If the extension layer is configured, there is a Datadog-Extension with matching version
// 2. If there is a language layer configured, there should is a matching version of the language layer
// 3. It has the DD_API_KEY and DD_SITE environment variables
// 4. The function should still be invokable
const isFunctionInstrumented = async (functionName) => {
  const lambdaClient = await getLambdaClient();
  const funConfig = await lambdaClient.send(
    new GetFunctionConfigurationCommand({
      FunctionName: functionName,
    }),
  );
  const rc = await getRemoteConfig();
  const {
    extension_version,
    node_layer_version,
    python_layer_version,
    dd_trace_enabled,
    dd_serverless_logs_enabled,
  } = rc.data[0].attributes.instrumentation_settings;

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

  if (
    !hasEnvVarMatching(
      funConfig,
      "DD_TRACE_ENABLED",
      dd_trace_enabled?.toString() ?? "true",
    )
  ) {
    return false;
  }

  if (
    !hasEnvVarMatching(
      funConfig,
      "DD_SERVERLESS_LOGS_ENABLED",
      dd_serverless_logs_enabled?.toString() ?? "true",
    )
  ) {
    return false;
  }

  if (
    !(
      hasEnvVar(funConfig, "DD_API_KEY") &&
      hasEnvVarMatching(funConfig, "DD_SITE", ddSite)
    )
  ) {
    return false;
  }

  return isFunctionInvokable(functionName);
};

exports.isFunctionInstrumented = isFunctionInstrumented;

const isFunctionUninstrumented = async (functionName) => {
  const lambdaClient = await getLambdaClient();
  const funConfig = await lambdaClient.send(
    new GetFunctionConfigurationCommand({
      FunctionName: functionName,
    }),
  );

  return (
    !hasLayer(funConfig, "Datadog-Python") &&
    !hasLayer(funConfig, "Datadog-Node") &&
    !hasLayer(funConfig, "Datadog-Extension") &&
    !hasEnvVar(funConfig, "DD_API_KEY") &&
    !hasEnvVar(funConfig, "DD_SITE")
  );
};

exports.isFunctionUninstrumented = isFunctionUninstrumented;

const expectFunctionsToBeInstrumented = async (functionNames) => {
  await Promise.all(
    functionNames.map(async (functionName) => {
      const isInstrumented = await pollUntilTrue(60000, 5000, () =>
        isFunctionInstrumented(functionName),
      );

      // The function is instrumented correctly
      expect(isInstrumented).toStrictEqual(true);
    }),
  );
};
exports.expectFunctionsToBeInstrumented = expectFunctionsToBeInstrumented;
