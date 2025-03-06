const { getLambdaFunction } = require("./functions");
const {
  UpdateFunctionConfigurationCommand,
} = require("@aws-sdk/client-lambda");

async function updateInstrumenterDDTags(client) {
  const instrumenterFunction = await getLambdaFunction(
    client,
    process.env.AWS_LAMBDA_FUNCTION_NAME,
  );
  let instrumenterLayerVersion;
  for (const layer of instrumenterFunction.Configuration.Layers) {
    if (layer?.Arn?.includes("Datadog-Serverless-Remote-Instrumentation-ARM")) {
      instrumenterLayerVersion = parseInt(layer.Arn.split(":").at(-1), 10);
    }
  }
  if (!instrumenterLayerVersion) {
    throw new Error(
      "Could not find the remote instrumentation layer on the instrumenter function",
    );
  }
  const instrumenterLayerVersionTag = `instrumenter_layer_version:${instrumenterLayerVersion}`;
  if (
    instrumenterFunction.Configuration.Environment?.Variables?.DD_TAGS !==
    instrumenterLayerVersionTag
  ) {
    instrumenterFunction.Configuration.Environment.Variables.DD_TAGS =
      instrumenterLayerVersionTag;
    const input = {
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
      Environment: {
        Variables: instrumenterFunction.Configuration.Environment.Variables,
      },
    };
    const command = new UpdateFunctionConfigurationCommand(input);
    await client.send(command);
  }
}
exports.updateInstrumenterDDTags = updateInstrumenterDDTags;
