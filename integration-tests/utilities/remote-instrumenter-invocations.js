const { InvokeCommand } = require("@aws-sdk/client-lambda");
const { getLambdaClient } = require("./aws-resources");
const { functionName } = require("../config.json");
const { createPresignedUrl } = require("./s3-helpers");

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

const invokeLambdaWithCFNDeleteEvent = async () => {
  const s3Key = `cloudformationDelete/${new Date()}`;
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify({
      RequestType: "Delete",
      ResponseURL: await createPresignedUrl(s3Key),
      ResourceType: "AWS::CloudFormation::CustomResource",
      StackId: "fakeStackId",
      PhysicalResourceId: "fakePhysicalResourceId",
      RequestId: "fakeRequestId",
      name: `integration-tests${process.env.USER}`,
    }),
  });
  const lambdaClient = await getLambdaClient();
  const res = await lambdaClient.send(command);
  const payload = JSON.parse(Buffer.from(res.Payload).toString());
  return {
    payload,
    errors: res.FunctionError,
    s3Key,
  };
};

exports.invokeLambdaWithCFNDeleteEvent = invokeLambdaWithCFNDeleteEvent;
