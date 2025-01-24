const { InvokeCommand } = require("@aws-sdk/client-lambda");
const { getLambdaClient } = require("./aws-resources");

const invokeLambdaWithScheduledEvent = async (remoteInstrumenterName) => {
  const command = new InvokeCommand({
    FunctionName: remoteInstrumenterName,
    Payload: JSON.stringify({
      "event-type": "Scheduled Instrumenter Invocation",
    }),
  });
  const lambdaClient = await getLambdaClient();
  const { Payload } = lambdaClient.send(command);
  return JSON.parse(Buffer.from(Payload).toString());
};

exports.invokeLambdaWithScheduledEvent = invokeLambdaWithScheduledEvent;
