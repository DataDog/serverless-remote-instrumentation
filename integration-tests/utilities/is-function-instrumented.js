const { GetFunctionConfigurationCommand } = require("@aws-sdk/client-lambda");

const hasLayerMatching = (l, matcher) =>
  l.Layers.some((layer) => layer.Arn.includes(matcher));
const hasEnvVar = (l, varName) =>
  Object.keys(l.Environment.Variables).includes(varName);

// A function is considered instrumented if all are true:
// 1. It has the Datadog-Extension layer
// 2. It has a language specific datadog layer (Datadog-Python, Datadog-Node, etc)
// 3. It has the DD_API_KEY and DD_SITE environment variables
const isFunctionInstrumented = async (lambda, functionName) => {
  const funConfig = await lambda.send(
    new GetFunctionConfigurationCommand({
      FunctionName: functionName,
    }),
  );
  return (
    hasLayerMatching(funConfig, "Datadog-Extension") &&
    (hasLayerMatching(funConfig, "Datadog-Python") ||
      hasLayerMatching(funConfig, "Datadog-Node") ||
      hasLayerMatching(funConfig, "dd-trace-java") ||
      hasLayerMatching(funConfig, "dd-trace-dotnet") ||
      hasLayerMatching(funConfig, "Datadog-Ruby")) &&
    hasEnvVar(funConfig, "DD_API_KEY") &&
    hasEnvVar(funConfig, "DD_SITE")
  );
};

exports.isFunctionInstrumented = isFunctionInstrumented;
