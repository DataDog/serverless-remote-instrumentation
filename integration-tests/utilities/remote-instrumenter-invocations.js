const { InvokeCommand } = require("@aws-sdk/client-lambda");

const invokeLambdaWithScheduledEvent = async (
  lambda,
  remoteInstrumenterName,
) => {
  const command = new InvokeCommand({
    FunctionName: remoteInstrumenterName,
    Payload: JSON.stringify({
      "event-type": "Scheduled Instrumenter Invocation",
    }),
  });
  const { Payload } = await lambda.send(command);
  return JSON.parse(Buffer.from(Payload).toString());
};

exports.invokeLambdaWithScheduledEvent = invokeLambdaWithScheduledEvent;
