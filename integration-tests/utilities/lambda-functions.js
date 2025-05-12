const JSZip = require("jszip");
const {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionConfigurationCommand,
  InvokeCommand,
  ResourceNotFoundException,
  Runtime,
  TagResourceCommand,
} = require("@aws-sdk/client-lambda");
const {
  account,
  region,
  namingSeed,
  testLambdaRole,
} = require("../config.json");
const { getLambdaClient } = require("./aws-resources");
const { sleep } = require("./sleep");

const functionNamesToCleanUp = [];

const createFunctions = async (lambdaProps, numFunctions = 1) => {
  const lambdaClient = await getLambdaClient();
  const createdFunctions = new Set();
  for (let i = 0; i < numFunctions; i++) {
    const functionName = generateTestFunctionName(i);

    const zip = new JSZip();
    zip.file(
      "index.js",
      "const handler = async () => { return 1 }; exports.handler=handler;",
    );
    const zippedHandler = await zip
      .generateAsync({ type: "blob" })
      .then(async (content) => new Uint8Array(await content.arrayBuffer()));
    const command = new CreateFunctionCommand({
      Code: {
        ZipFile: zippedHandler,
      },
      FunctionName: functionName,
      Handler: "index.handler",
      Role: `arn:aws:iam::${account}:role/${testLambdaRole}`,
      Runtime: Runtime.nodejs20x,
      PackageType: "Zip",
      MemorySize: 128,
      Tags: {
        dd_serverless_service: "remote_instrumenter_testing",
      },
      ...lambdaProps,
    });

    const lambda = await lambdaClient.send(command);
    createdFunctions.add(lambda);
    functionNamesToCleanUp.push(lambda.FunctionName);
  }

  // When new functions are created they are in a pending state for a little bit,
  // wait until they are active since they cannot be modified in this pending state
  const readyFunctions = [];
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
exports.createFunctions = createFunctions;

const createFunction = async (lambdaProps) => {
  const functions = await createFunctions(lambdaProps);
  return functions[0];
};
exports.createFunction = createFunction;

function generateTestFunctionName(suffixNumber) {
  // Name the function after the test, picking the last 64 characters since
  // lambda limits function name length and that is probably the most descriptive
  let functionName =
    `${expect.getState().currentTestName}${namingSeed.slice(0, 6)}`.replace(
      /\W/g,
      "",
    );

  const prefix = "ri-test-";
  const suffix = `-${suffixNumber}`;
  const maxLengthWithoutPrefixAndSuffix = 64 - prefix.length - suffix.length;
  if (functionName.length > maxLengthWithoutPrefixAndSuffix) {
    functionName = functionName.slice(
      functionName.length - maxLengthWithoutPrefixAndSuffix,
    );
  }

  functionName = `${prefix}${functionName}${suffix}`;
  return functionName;
}

const deleteFunction = async (functionName) => {
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

exports.deleteFunction = deleteFunction;

const deleteTestFunctions = async () => {
  await Promise.all(functionNamesToCleanUp.map((name) => deleteFunction(name)));
  while (functionNamesToCleanUp.length) {
    functionNamesToCleanUp.pop();
  }
};

exports.deleteTestFunctions = deleteTestFunctions;

const tagFunction = async (functionName, tags) => {
  const lambdaClient = await getLambdaClient();
  await lambdaClient.send(
    new TagResourceCommand({
      Resource: `arn:aws:lambda:${region}:${account}:function:${functionName}`,
      Tags: tags,
    }),
  );
};

exports.tagFunction = tagFunction;

const isFunctionInvokable = async (functionName) => {
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: "{}",
  });
  const lambdaClient = await getLambdaClient();
  const { StatusCode } = await lambdaClient.send(command);
  return StatusCode === 200;
};

exports.isFunctionInvokable = isFunctionInvokable;
