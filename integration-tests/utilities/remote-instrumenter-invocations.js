const { InvokeCommand } = require("@aws-sdk/client-lambda");
const { getLambdaClient } = require("./aws-resources");
const { functionName } = require("../config.json");
const { createPresignedUrl, deleteObject } = require("./s3-helpers");

const invokeLambdaWithScheduledEvent = async () => {
  // Delete the last hash so that the remote instrumenter will more consistently check
  // if the function is supposed to be instrumented or not, instead of skipping it
  await deleteObject("datadog_remote_instrumentation_config.txt");
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

const invokeLambdaWithCFNEvent = async (eventType) => {
  const s3Key = `cloudformationDelete/${new Date()}`;
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify({
      RequestType: eventType,
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

const invokeLambdaWithCFNDeleteEvent = async () => {
  return invokeLambdaWithCFNEvent("Delete");
};

exports.invokeLambdaWithCFNDeleteEvent = invokeLambdaWithCFNDeleteEvent;

const invokeLambdaWithCFNCreateEvent = async () => {
  return invokeLambdaWithCFNEvent("Create");
};

exports.invokeLambdaWithCFNCreateEvent = invokeLambdaWithCFNCreateEvent;
