const JSZip = require("jszip");
const {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionConfigurationCommand,
  ResourceNotFoundException,
  Runtime,
  TagResourceCommand,
} = require("@aws-sdk/client-lambda");
const { account, region, testLambdaRole } = require("../config.json");
const { getLambdaClient } = require("./aws-resources");
const { sleep } = require("./sleep");

const createFunction = async (lambdaProps) => {
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
    Handler: "index.handler",
    Role: `arn:aws:iam::${account}:role/${testLambdaRole}`,
    Runtime: Runtime.nodejs20x,
    PackageType: "Zip",
    MemorySize: 512,
    ...lambdaProps,
  });

  const lambdaClient = await getLambdaClient();
  const { FunctionName } = await lambdaClient.send(command);

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
