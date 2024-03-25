const {
    CloudFormationClient,
    CreateStackCommand,
    UpdateStackCommand,
    DeleteStackCommand,
    DescribeStackResourcesCommand
} = require("@aws-sdk/client-cloudformation");
const {S3Client, ListObjectsV2Command, DeleteObjectsCommand} = require("@aws-sdk/client-s3");
const {LambdaClient, GetFunctionCommand} = require("@aws-sdk/client-lambda");
const datadogCi = require('@datadog/datadog-ci/dist/cli.js');

// dd imports
const {sendDistributionMetric} = require('datadog-lambda-js');

// Constants
const SELF_MONITOR_STACK_NAME = "remote-instrument-self-monitor";
const INSTRUMENTER_STACK_NAME = "datadog-remote-instrument";
const S3_BUCKET_NAME = "remote-instrument-self-monitor";
const NODE = "node"
const DD_AWS_ACCOUNT_NUMBER = "425362996713"  // serverless sandbox
const DD_SLS_REMOTE_INSTRUMENTER_VERSION = "dd_sls_remote_instrumenter_version"
const SERVICE_NAME = "remote-instrument-self-monitor"

const UPDATED_EXTENSION_VERSION = process.env.UpdatedDdExtensionLayerVersion
const ORIGINAL_EXTENSION_VERSION = process.env.DdExtensionLayerVersion


exports.handler = async (event, context, callback) => {

    console.log('\n event:', JSON.stringify(event))
    console.log(`\n process: ${JSON.stringify(process.env)}`)
    const config = getConfig();

    if (!event.hasOwnProperty("eventName")) {
        console.log(`The event doesn't have "eventName" field.`)
        return;
    }

    if (event.eventName === "Uninstrument") {
        await uninstrument(config);
        await sleep(120000);  // 120 seconds
        await checkFunctionsInstrumentedWithExpectedExtnesionVersionAndEmitMetrics(
            config, ORIGINAL_EXTENSION_VERSION);

    } else if (event.eventName === "UpdateStack") {
        await updateStack(config);
        await sleep(180000);  // 180 seconds
        await checkFunctionsInstrumentedWithExpectedExtnesionVersionAndEmitMetrics(
            config, UPDATED_EXTENSION_VERSION);

    } else if (event.eventName === "DeleteStack") {
        await deleteStack(config);

    } else if (event.eventName === "UninstrumentAfterDeleteStack") {
        await uninstrument(config);

    } else if (event.eventName === "CreateStack") {
        await createStack(config);
        await sleep(180000);  // 180 seconds
        await checkFunctionsInstrumentedWithExpectedExtnesionVersionAndEmitMetrics(
            config, ORIGINAL_EXTENSION_VERSION);
    }
    return `✅`;
};

async function checkFunctionsInstrumentedWithExpectedExtnesionVersionAndEmitMetrics(config, expectedExtensionVersion) {
    await checkNodeFunction(config);
    await checkPythonFunction();
    await checkTaggedFunction();
    await checkUntaggedFunction();
}

function incrementMetric(metricName) {
    sendDistributionMetric(
        metricName,
        1,                      // Metric value
        "env:dev",
        `service:${SERVICE_NAME}`,
    );
}

async function checkNodeFunction(config) {
    const getFunctionCommandOutput = await getFunction(config, config.NODE_FUNCTION_NAME);
    if (getFunctionCommandOutput == null) {
        incrementMetric('serverless.remote_instrument.instrument_by_function_name.aws_request_failed');
        return;
    }

    // check if lambda has layer
    if (getFunctionCommandOutput?.Configuration?.Layers !== undefined) {

        incrementMetric('serverless.remote_instrument.instrument_by_function_name.succeeded');
    } else {
        incrementMetric('serverless.remote_instrument.instrument_by_function_name.failed');
    }


}

async function getFunction(config, functionName) {
    const params = {
        FunctionName: functionName
    };
    const client = new LambdaClient({region: process.env.AWS_REGION});
    const command = new GetFunctionCommand(params);

    try {
        let getFunctionCommandOutput = await client.send(command);
        return getFunctionCommandOutput;
    } catch (error) {
        // simply skip this current instrumentation of the function.
        console.error(`\nError is caught for functionName ${functionName}. Skipping instrumenting this function. Error is: ${error}`);
    }
    return null;
}

// delete all objects in a bucket
async function emptyBucket(bucketName, config) {
    const s3Client = new S3Client({region: config.AWS_REGION}); // Replace YOUR_REGION with your S3 bucket region

    // Function to list all objects in the bucket
    async function listAllObjects(bucketName) {
        const allObjects = [];
        let isTruncated = true;
        let token;

        while (isTruncated) {
            const {
                Contents,
                IsTruncated,
                NextContinuationToken
            } = await s3Client.send(new ListObjectsV2Command({
                Bucket: bucketName,
                ContinuationToken: token,
            }));

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
                    Objects: chunk.map(({Key}) => ({Key})),
                    Quiet: true,
                },
            };

            await s3Client.send(new DeleteObjectsCommand(deleteParams));
        }
    }

    deleteAllObjects(bucketName)
        .then(() => console.log("All objects deleted successfully."))
        .catch((error) => console.error("An error occurred:", error));

}


async function getNestedInstrumenterStackName(config) {
// const { CloudFormationClient, DescribeStackResourcesCommand } = require("@aws-sdk/client-cloudformation"); // CommonJS import
    const client = new CloudFormationClient({region: config.AWS_REGION});
    const input = { // DescribeStackResourcesInput
        StackName: SELF_MONITOR_STACK_NAME,
        LogicalResourceId: "RemoteInstrumentStack",
        // PhysicalResourceId: "STRING_VALUE",
    };
    const command = new DescribeStackResourcesCommand(input);
    const response = await client.send(command);
    console.log(`DescribeStackResourcesCommand: ${JSON.stringify(response)}`)

    const nestedStackARN = response.StackResources[0].PhysicalResourceId;
    const nestedStackName = nestedStackARN.split('/')[1]
    console.log(`nestedStackName: ${nestedStackName}`)
    return nestedStackName;
}

// delete stack
async function deleteStack(config) {
    let stackNamesToDelete = [INSTRUMENTER_STACK_NAME];
    try {
        let nestedStackName = await getNestedInstrumenterStackName(config);
        stackNamesToDelete.push(nestedStackName);
    } catch {
        console.log(`failed to fetch nestedStackName. trying again`);
        let nestedStackName = await getNestedInstrumenterStackName(config);
        stackNamesToDelete.push(nestedStackName);
    }

    await emptyBucket(S3_BUCKET_NAME, config);
    console.log(`bucket ${S3_BUCKET_NAME} is emptied now`);
    const client = new CloudFormationClient({region: config.AWS_REGION});

    for (let stackName of stackNamesToDelete) {
        const deleteStackInput = {
            StackName: stackName,
        };
        const command = new DeleteStackCommand(deleteStackInput);
        const response = await client.send(command);
        console.log(`DeleteStackCommand response: ${JSON.stringify(response)}`);
    }
}

const createStackInput = {
    StackName: INSTRUMENTER_STACK_NAME,
    TemplateURL: "https://datadog-cloudformation-template-serverless-sandbox.s3.sa-east-1.amazonaws.com/aws/remote-instrument-dev/latest.yaml",
    Parameters: [
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
            ParameterKey: "BucketName",
            ParameterValue: S3_BUCKET_NAME,
            UsePreviousValue: true,
        },
        {
            ParameterKey: "DdAwsAccountNumber",
            ParameterValue: "425362996713",
            UsePreviousValue: true,
        },
        {
            ParameterKey: "AllowList",
            ParameterValue: "remote-instrument-self-monitor-node,remote-instrument-self-monitor-python,some-function-does-not-exist-for-testing-purpose",
            UsePreviousValue: true,
        },
        {
            ParameterKey: "TagRule",
            ParameterValue: "DD_REMOTE_INSTRUMENT_ENABLED:true,another-tag:true",
            UsePreviousValue: true,
        },
        {
            ParameterKey: "DenyList",
            ParameterValue: "remote-instrument-self-monitor-to-be-uninstrumented",
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


    ],
    // DisableRollback: false,
    // RollbackConfiguration: { // RollbackConfiguration
    //     RollbackTriggers: [ // RollbackTriggers
    //         { // RollbackTrigger
    //             Arn: "STRING_VALUE", // required
    //             Type: "STRING_VALUE", // required
    //         },
    //     ],
    //     MonitoringTimeInMinutes: Number("int"),
    // },
    TimeoutInMinutes: 5,  // minutes
    // NotificationARNs: [ // NotificationARNs
    //     "STRING_VALUE",
    // ],
    Capabilities: [
        "CAPABILITY_IAM"
    ],
    // ResourceTypes: [ // ResourceTypes
    //     "STRING_VALUE",
    // ],
    // RoleARN: "STRING_VALUE",
    OnFailure: "DO_NOTHING",  // DO_NOTHING, ROLLBACK, or DELETE
    // StackPolicyBody: "STRING_VALUE",
    // StackPolicyURL: "STRING_VALUE",
    Tags: [
        {
            Key: "DD_PRESERVE_STACK",
            Value: "true",
        },
    ],
    // ClientRequestToken: "STRING_VALUE",
    // EnableTerminationProtection: true || false,
    // RetainExceptOnCreate: true || false,
};

// create stack
async function createStack(config) {
    const clientConfig = {region: config.AWS_REGION};
    const client = new CloudFormationClient(clientConfig);
    const command = new CreateStackCommand(createStackInput);
    const response = await client.send(command);
    console.log(`Create stack response: ${JSON.stringify(response)}`)
}

// update stack
async function updateStack(config) {
    const client = new CloudFormationClient({region: config.AWS_REGION});
    const updateStackInput = Object.assign({}, createStackInput);
    updateStackInput.Parameters = [
        {
            ParameterKey: "DdExtensionLayerVersion",
            ParameterValue: UPDATED_EXTENSION_VERSION,  // was "50"
            UsePreviousValue: false,
        },
        // Only the extension version changed. Every other parameters below are not changed.
        {
            ParameterKey: "DdApiKey",
            UsePreviousValue: true,
        },
        {
            ParameterKey: "DdSite",
            UsePreviousValue: true,
        },
        {
            ParameterKey: "BucketName",
            UsePreviousValue: true,
        },
        {
            ParameterKey: "DdAwsAccountNumber",
            UsePreviousValue: true,
        },
        {
            ParameterKey: "AllowList",
            UsePreviousValue: true,
        },
        {
            ParameterKey: "TagRule",
            UsePreviousValue: true,
        },
        {
            ParameterKey: "DenyList",
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
    ]
    console.log(`updateStackInput: ${JSON.stringify(updateStackInput.Parameters)}`);

    const command = new UpdateStackCommand(updateStackInput);
    const response = await client.send(command);
    console.log(`UpdateStackCommand response: ${JSON.stringify(response)}`);
}

// uninstrument
async function uninstrument(config) {
    const functionNamesToUninstrument = [
        'remote-instrument-self-monitor-node',
        'remote-instrument-self-monitor-python',
        'remote-instrument-self-monitor-with-specified-tags',
    ]
    await uninstrumentFunctions(functionNamesToUninstrument, config);
}

function sleep(ms) {
    console.log(`sleeping for ${ms} ms`);
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}


async function uninstrumentFunctions(functionNamesToUninstrument, config) {
    console.log(`\n functionNamesToUninstrument: ${functionNamesToUninstrument}`)

    const uninstrumentedFunctionArns = [];
    for (let functionName of functionNamesToUninstrument) {
        console.log(`\n functionName in functionNamesToUninstrument : ${functionName}`)
        const functionArn = `arn:aws:lambda:${config.AWS_REGION}:${DD_AWS_ACCOUNT_NUMBER}:function:${functionName}`;
        await uninstrumentWithDatadogCi(functionArn, NODE, config, uninstrumentedFunctionArns);
    }
}

async function uninstrumentWithDatadogCi(functionArn, runtime = NODE, config, functionArns) {
    console.log(`instrumentWithDatadogCi: functionArns: ${functionArns}`)
    const cli = datadogCi.cli;
    let command;
    console.log(`\n uninstrumenting...`)
    command = ['lambda', 'uninstrument', '-f', functionArn, '-r', config.AWS_REGION];
    console.log(`🖥️ datadog-ci command: ${JSON.stringify(command)}`);

    const commandExitCode = await cli.run(command);

    console.log(`\n commandExitCode type: ${typeof commandExitCode}, \n commandExitCode: ${commandExitCode}`);
    if (commandExitCode === 0) {
        console.log(`✅ Function ${functionArn} is uninstrumented with datadog-ci.`);
        functionArns.push(functionArn);
        console.log(`now functionArns: ${JSON.stringify(functionArns)}`)
    } else {
        console.log(`❌ datadog-ci uninstrumentation failed for function ${functionArn}`);
    }
}

function getConfig() {
    const config = {
        // AWS
        AWS_REGION: process.env.AWS_REGION,
        NODE_FUNCTION_NAME: process.env.NodeLambdaFunctionName,
        PYTHON_FUNCTION_NAME: process.env.PythonLambdaFunctionName,
        LAMBDA_WITH_SPECIFIED_TAGS_FUNCTION_NAME: process.env.LambdaWithSpecifiedTagsFunctionName,
        LAMBDA_WITHOUT_SPECIFIED_TAGS_FUNCTION_NAME: process.env.LambdaWithoutSpecifiedTagsFunctionName,
    };
    console.log(`\n config: ${JSON.stringify(config)}`)
    return config;
}
