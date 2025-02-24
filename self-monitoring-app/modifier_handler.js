const {
  CloudFormationClient,
  CreateStackCommand,
  UpdateStackCommand,
  DeleteStackCommand,
  DescribeStackResourcesCommand,
} = require("@aws-sdk/client-cloudformation");
const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} = require("@aws-sdk/client-s3");
const { LambdaClient, GetFunctionCommand } = require("@aws-sdk/client-lambda");
const datadogCi = require("@datadog/datadog-ci/dist/cli.js");

// dd imports
const { sendDistributionMetric } = require("datadog-lambda-js");

// Constants
const ENV = "self-monitor-dev";
const INSTRUMENTER_STACK_NAME = "datadog-remote-instrument";
const SELF_MONITOR_STACK_NAME = "remote-instrument-self-monitor";
const NODE = "node";
const DD_AWS_ACCOUNT_NUMBER = "425362996713"; // serverless sandbox
const SERVICE_NAME = "remote-instrument-self-monitor";

const UPDATED_EXTENSION_VERSION = process.env.UpdatedDdExtensionLayerVersion;
const ORIGINAL_EXTENSION_VERSION = process.env.DdExtensionLayerVersion;

// need to be updated to match ther template URL in the self-monitoring app's template yaml file
const INSTRUMENTER_TEMPLATE_VERSION = "0.40.0";

exports.handler = async (event) => {
  logMessage(JSON.stringify(event));
  const config = getConfig();

  if (!Object.prototype.hasOwnProperty.call(event, "eventName")) {
    logMessage('The event doesn\'t have "eventName" field.');
    return;
  }

  if (event.eventName === "Uninstrument") {
    await uninstrument(config);
    await sleep(120000); // 120 seconds
    await checkFunctionsInstrumentedWithExpectedExtensionVersionAndEmitMetrics(
      config,
      ORIGINAL_EXTENSION_VERSION,
    );
  } else if (event.eventName === "UpdateStack") {
    await updateStack(config);
    await sleep(180000); // 180 seconds
    await checkFunctionsInstrumentedWithExpectedExtensionVersionAndEmitMetrics(
      config,
      UPDATED_EXTENSION_VERSION,
    );
  } else if (event.eventName === "DeleteStack") {
    await deleteStack(config);
  } else if (event.eventName === "UninstrumentAfterDeleteStack") {
    await uninstrument(config);
  } else if (event.eventName === "CreateStack") {
    await createStack(config);
    await sleep(180000); // 180 seconds
    await checkFunctionsInstrumentedWithExpectedExtensionVersionAndEmitMetrics(
      config,
      ORIGINAL_EXTENSION_VERSION,
    );
  }
  return "✅";
};

async function checkFunctionsInstrumentedWithExpectedExtensionVersionAndEmitMetrics(
  config,
  expectedExtensionVersion,
) {
  await checkFunction(
    config,
    config.NODE_FUNCTION_NAME,
    expectedExtensionVersion,
  );
  await checkFunction(
    config,
    config.PYTHON_FUNCTION_NAME,
    expectedExtensionVersion,
  );
  await checkFunction(
    config,
    config.LAMBDA_WITH_SPECIFIED_TAGS_FUNCTION_NAME,
    expectedExtensionVersion,
  );
  // await checkUntaggedFunction();
}

async function checkFunction(config, functionName, expectedExtensionVersion) {
  const extraTags = [
    `function_name:${functionName}`,
    `expected_extension_version:${expectedExtensionVersion}`,
  ];
  const getFunctionCommandOutput = await getFunction(config, functionName);
  if (getFunctionCommandOutput == null) {
    sendDistributionMetricWrapper(
      "serverless.remote_instrument.instrument_function.aws_request_failed",
      extraTags,
    );
    return;
  }
  logMessage(
    `getFunctionCommandOutput: ${JSON.stringify(getFunctionCommandOutput)}`,
  );
  // check if lambda has layer
  if (getFunctionCommandOutput?.Configuration?.Layers !== undefined) {
    let hasExtensionLayer = false;
    for (const layer of getFunctionCommandOutput.Configuration.Layers) {
      if (
        layer.Arn.includes(
          "arn:aws:lambda:us-west-1:464622532012:layer:Datadog-Extension-ARM",
        )
      ) {
        hasExtensionLayer = true;

        // check if layer version matched
        const arr = layer.Arn.split(":");
        const layerVersion = arr[arr.length - 1];
        sendDistributionMetricWrapper(
          "serverless.remote_instrument.target_function.current_extension_version",
          [...extraTags, `current_extension_version:${layerVersion}`],
        );
        if (layerVersion === expectedExtensionVersion) {
          sendDistributionMetricWrapper(
            "serverless.remote_instrument.instrument_function.extension_version_matched",
            extraTags,
          );
        } else {
          logErrorMessage(
            `\n serverless.remote_instrument.instrument_function.extension_version_unmatched \n The extension layer version unmatched! getFunctionCommandOutput: ${JSON.stringify(getFunctionCommandOutput)}`,
          );
          sendDistributionMetricWrapper(
            "serverless.remote_instrument.instrument_function.extension_version_unmatched",
            extraTags,
          );
        }
      }
    }
    if (!hasExtensionLayer) {
      logErrorMessage(
        `\n serverless.remote_instrument.instrument_function.failed \n The Extension layer is not found on the ${config.NODE_FUNCTION_NAME}. Function config is: ${JSON.stringify(getFunctionCommandOutput)}`,
      );
      sendDistributionMetricWrapper(
        "serverless.remote_instrument.instrument_function.failed",
        extraTags,
      );
    } else {
      sendDistributionMetricWrapper(
        "serverless.remote_instrument.instrument_function.succeeded",
        extraTags,
      );
    }
  } else {
    logErrorMessage(
      `\n serverless.remote_instrument.instrument_function.failed \n The extension layer version unmatched! getFunctionCommandOutput: ${JSON.stringify(getFunctionCommandOutput)}`,
    );
    sendDistributionMetricWrapper(
      "serverless.remote_instrument.instrument_function.failed",
      extraTags,
    );
  }
}

async function getFunction(config, functionName) {
  const params = {
    FunctionName: functionName,
  };
  const client = new LambdaClient({ region: config.AWS_REGION });
  const command = new GetFunctionCommand(params);

  try {
    const getFunctionCommandOutput = await client.send(command);
    return getFunctionCommandOutput;
  } catch (error) {
    // simply skip this current instrumentation of the function.
    logErrorMessage(
      `\nError is caught when fetching function for ${functionName}. Error is: ${error}`,
    );
  }
  return null;
}

// delete s3 bucket
async function deleteS3Bucket(bucketName, config) {
  const s3Client = new S3Client({ region: config.AWS_REGION });

  try {
    const data = await s3Client.send(
      new DeleteBucketCommand({ Bucket: bucketName }),
    );
    logMessage("Delete S3 bucket succeeded", JSON.stringify(data));
  } catch (err) {
    // try to delete the bucket before stack is delete just in case stack deletion failed
    // to delete the bucket which will block the stack creation later on.
    logMessage("Delete S3 bucket error", err);
  }
}

// delete all objects in a bucket
async function emptyBucket(bucketName, config) {
  const s3Client = new S3Client({ region: config.AWS_REGION }); // Replace YOUR_REGION with your S3 bucket region

  // Function to list all objects in the bucket
  async function listAllObjects(bucketName) {
    const allObjects = [];
    let isTruncated = true;
    let token;

    while (isTruncated) {
      const { Contents, IsTruncated, NextContinuationToken } =
        await s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            ContinuationToken: token,
          }),
        );

      allObjects.push(...Contents);
      isTruncated = IsTruncated;
      token = NextContinuationToken;
    }

    return allObjects;
  }

  // Function to delete all objects in the bucket
  async function deleteAllObjects(bucketName) {
    const objects = await listAllObjects(bucketName);

    // S3's DeleteObjects API can take multiple keys, so split the list into chunks if necessary
    while (objects.length > 0) {
      const chunk = objects.splice(0, 1000); // S3 API supports deleting up to 1000 objects at once
      const deleteParams = {
        Bucket: bucketName,
        Delete: {
          Objects: chunk.map(({ Key }) => ({ Key })),
          Quiet: true,
        },
      };

      await s3Client.send(new DeleteObjectsCommand(deleteParams));
    }
  }

  await deleteAllObjects(bucketName)
    .then(() => logMessage("All objects deleted successfully."))
    .catch((error) => logErrorMessage("An error occurred:", error));
}

async function getNestedInstrumenterStackName(config) {
  const client = new CloudFormationClient({ region: config.AWS_REGION });
  const input = {
    // DescribeStackResourcesInput
    StackName: SELF_MONITOR_STACK_NAME,
    LogicalResourceId: "RemoteInstrumentNestedStack",
  };
  const command = new DescribeStackResourcesCommand(input);
  const response = await client.send(command);
  logMessage(`DescribeStackResourcesCommand: ${JSON.stringify(response)}`);

  const nestedStackARN = response.StackResources[0].PhysicalResourceId;
  const nestedStackName = nestedStackARN.split("/")[1];
  logMessage(`nestedStackName: ${nestedStackName}`);
  return nestedStackName;
}

// delete stack
async function deleteStack(config) {
  const stackNamesToDelete = [INSTRUMENTER_STACK_NAME]; // periodically created stack
  let nestedStackName = ""; // nested stack when the self-monitoring app first created
  try {
    nestedStackName = await getNestedInstrumenterStackName(config);
    stackNamesToDelete.push(nestedStackName);
  } catch {
    // manually retry for the 2nd time to avoid needing to use another package
    logMessage("failed to fetch nestedStackName. trying again");
    nestedStackName = await getNestedInstrumenterStackName(config);
    stackNamesToDelete.push(nestedStackName);
  }

  try {
    await getBucketNameFromStackNameAndDelete(nestedStackName, config);
  } catch (e) {
    logWarnMessage(
      `getBucketNameFromStackNameAndDelete failed for nestedStackName: ${nestedStackName}`,
    );
    logWarnMessage(`${JSON.stringify(e)}`);
    logMessage(
      `Nested stack may not exist anymore. Trying to get s3BucketName from ${INSTRUMENTER_STACK_NAME} stack now...`,
    );
    await getBucketNameFromStackNameAndDelete(INSTRUMENTER_STACK_NAME, config);
  }

  const client = new CloudFormationClient({ region: config.AWS_REGION });

  for (const stackName of stackNamesToDelete) {
    const deleteStackInput = {
      StackName: stackName,
      DeletionMode: "FORCE_DELETE_STACK",
    };
    try {
      const command = new DeleteStackCommand(deleteStackInput);
      const response = await client.send(command);
      logMessage(
        `datadog-remote-instrument response for deleting ${stackName}: ${JSON.stringify(response)}`,
      );
    } catch (e) {
      logMessage(`DeleteStackCommand failed with error: ${JSON.stringify(e)}`);
    }
  }
}

async function getS3BucketNameByStackName(stackName, config) {
  const client = new CloudFormationClient({ region: config.AWS_REGION });
  const input = {
    // DescribeStackResourcesInput
    StackName: stackName,
    LogicalResourceId: "S3Bucket",
  };
  const command = new DescribeStackResourcesCommand(input);
  const response = await client.send(command);
  logMessage(`DescribeStackResourcesCommand: ${JSON.stringify(response)}`);

  const s3BucketName = response.StackResources[0].PhysicalResourceId;
  logMessage(
    `s3BucketName from DescribeStackResourcesCommand: ${s3BucketName}`,
  );
  return s3BucketName;
}

async function getBucketNameFromStackNameAndDelete(stackName, config) {
  let s3BucketName = await getS3BucketNameByStackName(stackName, config);
  await emptyBucket(s3BucketName, config);
  await sleep(60000);
  logMessage(`Bucket ${s3BucketName} should be emptied now`);
  await deleteS3Bucket(s3BucketName, config);
}

const createStackInput = {
  StackName: INSTRUMENTER_STACK_NAME,
  TemplateURL: `https://datadog-cloudformation-template-serverless-sandbox.s3.sa-east-1.amazonaws.com/aws/remote-instrument-dev/${INSTRUMENTER_TEMPLATE_VERSION}.yaml`,
  Parameters: [
    {
      ParameterKey: "DdRemoteInstrumentLayerAwsAccount",
      ParameterValue: process.env.DdRemoteInstrumentLayerAwsAccount,
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdApiKey",
      ParameterValue: process.env.DD_API_KEY,
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdSite",
      ParameterValue: "datadoghq.com",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdAllowList",
      ParameterValue:
        "remote-instrument-self-monitor-node,remote-instrument-self-monitor-python,some-function-does-not-exist-for-testing-purpose",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdTagRule",
      ParameterValue: "DD_REMOTE_INSTRUMENT_ENABLED:true,another-tag:true",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdDenyList",
      ParameterValue: "",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdExtensionLayerVersion",
      ParameterValue: ORIGINAL_EXTENSION_VERSION,
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdPythonLayerVersion",
      ParameterValue: "70",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdNodeLayerVersion",
      ParameterValue: "100",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "EnableCodeSigningConfigurations",
      ParameterValue: "false",
    },
  ],
  TimeoutInMinutes: 5, // minutes
  Capabilities: ["CAPABILITY_IAM"],
  OnFailure: "DELETE", // DO_NOTHING, ROLLBACK, or DELETE
  Tags: [
    {
      Key: "DD_PRESERVE_STACK",
      Value: "true",
    },
  ],
};

// create stack
async function createStack(config) {
  const clientConfig = { region: config.AWS_REGION };
  const client = new CloudFormationClient(clientConfig);
  const command = new CreateStackCommand(createStackInput);
  const response = await client.send(command);
  logMessage(`Create stack response: ${JSON.stringify(response)}`);
}

// update stack
async function updateStack(config) {
  const client = new CloudFormationClient({ region: config.AWS_REGION });
  const updateStackInput = Object.assign({}, createStackInput);
  updateStackInput.Parameters = [
    {
      ParameterKey: "DdExtensionLayerVersion",
      ParameterValue: UPDATED_EXTENSION_VERSION, // was "50"
      UsePreviousValue: false,
    },
    {
      ParameterKey: "DdDenyList",
      ParameterValue: `${config.LAMBDA_WITH_TAGS_UPDATE_TO_BE_IN_DENY_LIST_FUNCTION_NAME}`,
      UsePreviousValue: false,
    },
    // Only changing the above parameters. Every other parameters below are not changed.
    {
      ParameterKey: "DdRemoteInstrumentLayerAwsAccount",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdApiKey",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdSite",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdAllowList",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdTagRule",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdPythonLayerVersion",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "DdNodeLayerVersion",
      UsePreviousValue: true,
    },
    {
      ParameterKey: "EnableCodeSigningConfigurations",
      ParameterValue: "false",
    },
  ];
  logMessage(
    `updateStackInput: ${JSON.stringify(updateStackInput.Parameters)}`,
  );

  const command = new UpdateStackCommand(updateStackInput);
  try {
    const response = await client.send(command);
    logMessage(`UpdateStackCommand response: ${JSON.stringify(response)}`);
  } catch (error) {
    if (error.message === "Stack [datadog-remote-instrument] does not exist") {
      logMessage(`Expected error. Error is: ${error}`);
    } else {
      logErrorMessage(`Unexpected error: ${error}`);
    }
  }
}

// uninstrument
async function uninstrument(config) {
  const functionNamesToUninstrument = [
    "remote-instrument-self-monitor-node",
    "remote-instrument-self-monitor-python",
    "remote-instrument-self-monitor-with-specified-tags",
  ];
  await uninstrumentFunctions(functionNamesToUninstrument, config);
}

function sleep(ms) {
  logMessage(`sleeping for ${ms} ms`);
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function uninstrumentFunctions(functionNamesToUninstrument, config) {
  logMessage(`\n functionNamesToUninstrument: ${functionNamesToUninstrument}`);

  const uninstrumentedFunctionArns = [];
  for (const functionName of functionNamesToUninstrument) {
    logMessage(
      `\n functionName in functionNamesToUninstrument : ${functionName}`,
    );
    const functionArn = `arn:aws:lambda:${config.AWS_REGION}:${DD_AWS_ACCOUNT_NUMBER}:function:${functionName}`;
    await uninstrumentWithDatadogCi(
      functionArn,
      NODE,
      config,
      uninstrumentedFunctionArns,
    );
  }
}

async function uninstrumentWithDatadogCi(
  functionArn,
  runtime = NODE,
  config,
  functionArns,
) {
  logMessage(`instrumentWithDatadogCi: functionArns: ${functionArns}`);
  const cli = datadogCi.cli;
  logMessage("\n uninstrumenting...");
  const command = [
    "lambda",
    "uninstrument",
    "-f",
    functionArn,
    "-r",
    config.AWS_REGION,
  ];
  logMessage(`🖥️ datadog-ci command: ${JSON.stringify(command)}`);
  logMessage(`runtime: ${runtime}`);
  const commandExitCode = await cli.run(command);

  logMessage(
    `\n commandExitCode type: ${typeof commandExitCode}, \n commandExitCode: ${commandExitCode}`,
  );
  if (commandExitCode === 0) {
    logMessage(`✅ Function ${functionArn} is uninstrumented with datadog-ci.`);
    functionArns.push(functionArn);
    logMessage(`now functionArns: ${JSON.stringify(functionArns)}`);
  } else {
    logMessage(
      `❌ datadog-ci uninstrumentation failed for function ${functionArn}`,
    );
  }
}

function getConfig() {
  const config = {
    // AWS
    AWS_REGION: process.env.AWS_REGION,
    NODE_FUNCTION_NAME: process.env.NodeLambdaFunctionName,
    PYTHON_FUNCTION_NAME: process.env.PythonLambdaFunctionName,
    LAMBDA_WITH_SPECIFIED_TAGS_FUNCTION_NAME:
      process.env.LambdaWithSpecifiedTagsFunctionName,
    LAMBDA_WITHOUT_SPECIFIED_TAGS_FUNCTION_NAME:
      process.env.LambdaWithoutSpecifiedTagsFunctionName,
    LAMBDA_WITH_TAGS_UPDATE_TO_BE_IN_DENY_LIST_FUNCTION_NAME:
      process.env.LambdaWithTagsUpdatedToBeInDenyListFunctionName,
  };
  logMessage(`\n config: ${JSON.stringify(config)}`);
  return config;
}

function sendDistributionMetricWrapper(metricName, extraTags) {
  sendDistributionMetric(
    metricName,
    1, // Metric value
    `env:${ENV}`,
    `service:${SERVICE_NAME}`,
    ...extraTags,
  );
}

function redact(log) {
  let newlog = log.replace(/"DD_API_KEY":.*,/, `"DD_API_KEY":"****",`);
  newlog = newlog.replace(
    /"AWS_ACCESS_KEY_ID":.*,/,
    `"AWS_ACCESS_KEY_ID":"****",`,
  );
  newlog = newlog.replace(
    /"AWS_SECRET_ACCESS_KEY":.*,/,
    `"AWS_SECRET_ACCESS_KEY":"****",`,
  );
  newlog = newlog.replace(
    /"AWS_SESSION_TOKEN":.*,/,
    `"AWS_SESSION_TOKEN":"****",`,
  );
  return newlog;
}

function logMessage(log) {
  console.log(redact(log));
}

function logErrorMessage(log) {
  console.error(redact(log));
}

function logWarnMessage(log) {
  console.warn(redact(log));
}
