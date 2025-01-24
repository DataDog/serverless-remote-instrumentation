const JSZip = require("jszip");
const {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  ResourceNotFoundException,
  Runtime,
} = require("@aws-sdk/client-lambda");
const { account, testLambdaRole } = require("../config.json");
const { getLambdaClient } = require("./aws-resources");

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
  await lambdaClient.send(command);
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
