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

const invokeLambdaWithLambdaManagementEvent = async ({
  eventName = "UpdateFunctionConfiguration20150331v2",
  targetFunctionName,
}) => {
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify({
      "detail-type": "AWS API Call via CloudTrail",
      detail: {
        eventName,
        requestParameters: {
          functionName: targetFunctionName,
        },
        responseElements: {
          functionName: targetFunctionName,
        },
      },
      source: "aws.lambda",
      name: `integration-tests${process.env.USER}`,
    }),
  });
  const lambdaClient = await getLambdaClient();
  const res = await lambdaClient.send(command);
  const payload = JSON.parse(Buffer.from(res.Payload).toString());
  return {
    payload,
    errors: res.FunctionError,
  };
};

exports.invokeLambdaWithLambdaManagementEvent =
  invokeLambdaWithLambdaManagementEvent;
