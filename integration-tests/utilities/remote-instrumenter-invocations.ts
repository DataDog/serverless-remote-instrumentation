import { InvokeCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient } from "./aws-resources";
import { functionName } from "../config.json";
import { createPresignedUrl, deleteObject } from "./s3-helpers";

const invokeLambdaWithScheduledEvent = async (): Promise<any> => {
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

interface InvokeLambdaWithLambdaManagementEventOptions {
  eventName?: string;
  targetFunctionName?: string;
}

interface InvokeLambdaWithLambdaManagementEventResult {
  payload: any;
  errors: any;
}

const invokeLambdaWithLambdaManagementEvent = async ({
  eventName = "UpdateFunctionConfiguration20150331v2",
  targetFunctionName,
}: InvokeLambdaWithLambdaManagementEventOptions): Promise<InvokeLambdaWithLambdaManagementEventResult> => {
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

interface InvokeLambdaWithCFNEventResult {
  payload: any;
  errors: any;
  s3Key: string;
}

const invokeLambdaWithCFNEvent = async (
  eventType: string,
): Promise<InvokeLambdaWithCFNEventResult> => {
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

const invokeLambdaWithCFNDeleteEvent =
  async (): Promise<InvokeLambdaWithCFNEventResult> => {
    return invokeLambdaWithCFNEvent("Delete");
  };

const invokeLambdaWithCFNCreateEvent =
  async (): Promise<InvokeLambdaWithCFNEventResult> => {
    return invokeLambdaWithCFNEvent("Create");
  };

const invokeLambdaWithCFNUpdateEvent =
  async (): Promise<InvokeLambdaWithCFNEventResult> => {
    return invokeLambdaWithCFNEvent("Update");
  };

export {
  invokeLambdaWithScheduledEvent,
  invokeLambdaWithLambdaManagementEvent,
  invokeLambdaWithCFNDeleteEvent,
  invokeLambdaWithCFNCreateEvent,
  invokeLambdaWithCFNUpdateEvent,
};
