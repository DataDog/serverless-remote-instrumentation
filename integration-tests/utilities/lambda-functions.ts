import { expect } from "vitest";
import JSZip from "jszip";
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionConfigurationCommand,
  InvokeCommand,
  ResourceConflictException,
  ResourceNotFoundException,
  Runtime,
  TagResourceCommand,
} from "@aws-sdk/client-lambda";
import { account, region, namingSeed, testLambdaRole } from "../config.json";
import { getLambdaClient } from "./aws-resources";
import { sleep } from "./sleep";

// Public AWS Lambda base image used by container image integration tests.
// Using a public ECR image ensures tests always run in CI without needing
// a private ECR repository or dynamically generated config.
export const CONTAINER_IMAGE_URI = "public.ecr.aws/lambda/python:3.12";

const functionNamesToCleanUp: string[] = [];
const functionNameCount: Record<string, number> = {};

const createFunctions = async (
  lambdaProps: any,
  numFunctions: number = 1,
): Promise<any[]> => {
  const lambdaClient = await getLambdaClient();
  const createdFunctions = new Set<any>();
  for (let i = 0; i < numFunctions; i++) {
    const functionName = generateTestFunctionName();

    const zip = new JSZip();
    zip.file(
      "index.js",
      "const handler = async () => { return 1 }; exports.handler=handler;",
    );
    const zippedHandler = await zip
      .generateAsync({ type: "blob" })
      .then(
        async (content: any) => new Uint8Array(await content.arrayBuffer()),
      );
    const command = new CreateFunctionCommand({
      Code: {
        ZipFile: zippedHandler,
      },
      FunctionName: functionName,
      Handler: "index.handler",
      Role: `arn:aws:iam::${account}:role/${testLambdaRole}`,
      Runtime: Runtime.nodejs24x,
      PackageType: "Zip",
      MemorySize: 128,
      Tags: {
        dd_serverless_service: "remote_instrumenter_testing",
      },
      ...lambdaProps,
    });

    let lambda;
    try {
      lambda = await lambdaClient.send(command);
    } catch (e) {
      if (e instanceof ResourceConflictException) {
        // Stale function from a previous run -- delete and recreate
        await lambdaClient.send(
          new DeleteFunctionCommand({ FunctionName: functionName }),
        );
        lambda = await lambdaClient.send(command);
      } else {
        throw e;
      }
    }
    createdFunctions.add(lambda);
    functionNamesToCleanUp.push(lambda.FunctionName);
  }

  // When new functions are created they are in a pending state for a little bit,
  // wait until they are active since they cannot be modified in this pending state
  const readyFunctions: any[] = [];
  while (createdFunctions.size > 0) {
    const lambda = createdFunctions.values().next().value;
    const functionStatus = await lambdaClient.send(
      new GetFunctionConfigurationCommand({
        FunctionName: lambda.FunctionName,
      }),
    );
    const { State } = functionStatus;
    if (State === "Pending") {
      await sleep(1000);
    } else {
      readyFunctions.push(lambda);
      createdFunctions.delete(lambda);
    }
  }
  return readyFunctions;
};

const createFunction = async (lambdaProps: any): Promise<any> => {
  const functions = await createFunctions(lambdaProps);
  return functions[0];
};

function generateTestFunctionName(): string {
  // Name the function after the test, picking the last 64 characters since
  // lambda limits function name length and that is probably the most descriptive
  let functionName =
    `${expect.getState().currentTestName}${namingSeed.slice(0, 6)}`.replace(
      /\W/g,
      "",
    );

  if (functionNameCount[functionName] === undefined) {
    functionNameCount[functionName] = 0;
  }
  functionNameCount[functionName]++;

  const prefix = "ri-test-";
  const suffix = `-${functionNameCount[functionName]}`;
  const maxLengthWithoutPrefixAndSuffix = 64 - prefix.length - suffix.length;
  if (functionName.length > maxLengthWithoutPrefixAndSuffix) {
    functionName = functionName.slice(
      functionName.length - maxLengthWithoutPrefixAndSuffix,
    );
  }

  functionName = `${prefix}${functionName}${suffix}`;
  return functionName;
}

const deleteFunction = async (functionName: string): Promise<boolean> => {
  const command = new DeleteFunctionCommand({ FunctionName: functionName });
  try {
    const lambdaClient = await getLambdaClient();
    await lambdaClient.send(command);
    return true;
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      return true;
    }
    throw e;
  }
};

const deleteTestFunctions = async (): Promise<void> => {
  await Promise.all(functionNamesToCleanUp.map((name) => deleteFunction(name)));
  while (functionNamesToCleanUp.length) {
    functionNamesToCleanUp.pop();
  }
};

const tagFunction = async (
  functionName: string,
  tags: Record<string, string>,
): Promise<void> => {
  const lambdaClient = await getLambdaClient();
  await lambdaClient.send(
    new TagResourceCommand({
      Resource: `arn:aws:lambda:${region}:${account}:function:${functionName}`,
      Tags: tags,
    }),
  );
};

const isFunctionInvokable = async (functionName: string): Promise<boolean> => {
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: "{}",
  });
  const lambdaClient = await getLambdaClient();
  const { StatusCode } = await lambdaClient.send(command);
  return StatusCode === 200;
};

// Creates a container image Lambda (PackageType: "Image").
// These functions have Runtime: undefined in API responses, which is the real-world
// scenario for functions deployed as container images rather than zip archives.
// The image must exist in ECR and be accessible to the test account's Lambda role.
const createContainerImageFunction = async (
  imageUri: string,
  extraProps: Record<string, unknown> = {},
): Promise<any> => {
  const lambdaClient = await getLambdaClient();
  const functionName = generateTestFunctionName();
  const { Tags: extraTags, ...restProps } = extraProps;

  const command = new CreateFunctionCommand({
    FunctionName: functionName,
    Role: `arn:aws:iam::${account}:role/${testLambdaRole}`,
    PackageType: "Image",
    Code: { ImageUri: imageUri },
    MemorySize: 128,
    Tags: {
      dd_serverless_service: "remote_instrumenter_testing",
      ...(extraTags as Record<string, string>),
    },
    ...restProps,
  });

  let lambda;
  try {
    lambda = await lambdaClient.send(command);
  } catch (e) {
    if (e instanceof ResourceConflictException) {
      await lambdaClient.send(
        new DeleteFunctionCommand({ FunctionName: functionName }),
      );
      lambda = await lambdaClient.send(command);
    } else {
      throw e;
    }
  }

  functionNamesToCleanUp.push(lambda.FunctionName);

  // Wait for the function to leave Pending state before returning
  let state = "Pending";
  while (state === "Pending") {
    const status = await lambdaClient.send(
      new GetFunctionConfigurationCommand({
        FunctionName: lambda.FunctionName,
      }),
    );
    state = status.State ?? "Active";
    if (state === "Pending") {
      await sleep(1000);
    }
  }

  return lambda;
};

export {
  createFunctions,
  createFunction,
  createContainerImageFunction,
  deleteFunction,
  deleteTestFunctions,
  tagFunction,
  isFunctionInvokable,
};
