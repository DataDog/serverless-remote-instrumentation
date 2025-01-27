const { InvokeCommand } = require("@aws-sdk/client-lambda");
const { getLambdaClient } = require("./aws-resources");
const { functionName } = require("../config.json");

const invokeLambdaWithScheduledEvent = async () => {
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify({
      "event-type": "Scheduled Instrumenter Invocation",
      name: `integration-tests${process.env.USER}`,
    }),
  });
  const lambdaClient = await getLambdaClient();
  const { Payload } = await lambdaClient.send(command);
  return JSON.parse(Buffer.from(Payload).toString());
};

exports.invokeLambdaWithScheduledEvent = invokeLambdaWithScheduledEvent;
