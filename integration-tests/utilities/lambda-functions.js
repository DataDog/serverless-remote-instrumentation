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

const functionNames = [];

const createFunction = async (lambdaProps) => {
  // Name the function after the test, picking the last 64 characters since
  // lambda limits function name length and that is probably the most descriptive
  let functionName =
    `${expect.getState().currentTestName}${namingSeed.slice(0, 6)}`.replace(
      /\W/g,
      "",
    );

  const prefix = "ri-test-";
  const maxLengthWithoutPrefix = 64 - prefix.length;
  if (functionName.length > maxLengthWithoutPrefix) {
    functionName = functionName.slice(
      functionName.length - maxLengthWithoutPrefix,
    );
  }

  functionName = `${prefix}${functionName}`;

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
    MemorySize: 512,
    Tags: {
      dd_serverless_service: "remote_instrumenter_testing",
    },
    ...lambdaProps,
  });

  const lambdaClient = await getLambdaClient();
  const lambda = await lambdaClient.send(command);
  const { FunctionName } = lambda;
  functionNames.push(FunctionName);

  // When a new function is created it is in a pending state for a little bit,
  // wait until it is active since it cannot be modified in this pending state
  let isFunctionReady = false;
  while (!isFunctionReady) {
    await sleep(1000);
    const functionStatus = await lambdaClient.send(
      new GetFunctionConfigurationCommand({
        FunctionName,
      }),
    );
    const { State } = functionStatus;
    if (State !== "Pending") {
      isFunctionReady = true;
    }
  }
  return lambda;
};

exports.createFunction = createFunction;

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
  await Promise.all(functionNames.map((name) => deleteFunction(name)));
  while (functionNames.length) {
    functionNames.pop();
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
