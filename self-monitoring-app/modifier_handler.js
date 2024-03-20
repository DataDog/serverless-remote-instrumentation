const {
    CloudFormationClient,
    CreateStackCommand,
    UpdateStackCommand,
    DeleteStackCommand
} = require("@aws-sdk/client-cloudformation");

const datadogCi = require('@datadog/datadog-ci/dist/cli.js');
const {S3Client, ListObjectsV2Command, DeleteObjectsCommand} = require("@aws-sdk/client-s3");
const INSTRUMENTER_STACK_NAME = "datadog-remote-instrument";
const S3_BUCKET_NAME = "remote-instrument-self-monitor";

exports.handler = async (event, context, callback) => {

    console.log('\n event:', JSON.stringify(event))
    console.log(`\n process: ${JSON.stringify(process.env)}`)
    const config = await getConfig();

    await uninstrument(config);
    await sleep(120000);  // 120 seconds

    await createStack(config);
    console.log(`creating stack...`);
    await sleep(100000);  // 100 seconds

    await updateStack(config);
    console.log(`updating stack...`);

    // await deleteStack(config);
    // console.log(`deleting stack...`);
    // await sleep(120000);  // 120 seconds

    return `✅ All done.`;
};

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

// delete stack
async function deleteStack(config) {

    await emptyBucket(S3_BUCKET_NAME, config);
    console.log(`bucket ${S3_BUCKET_NAME} is emptied now`)

    const client = new CloudFormationClient({region: config.AWS_REGION});
    const deleteStackInput = {
        StackName: INSTRUMENTER_STACK_NAME,
        // RetainResources: [ // RetainResources
        //     "STRING_VALUE",
        // ],
        // RoleARN: "STRING_VALUE",
        // ClientRequestToken: "STRING_VALUE",
    };
    const command = new DeleteStackCommand(deleteStackInput);
    const response = await client.send(command);
    console.log(`DeleteStackCommand response: ${JSON.stringify(response)}`);
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
            ParameterValue: "50",
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
            ParameterValue: "49",  // was "50"
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
        const functionArn = `arn:aws:lambda:${config.AWS_REGION}:${config.DD_AWS_ACCOUNT_NUMBER}:function:${functionName}`;
        await instrumentWithDatadogCi(functionArn, true, NODE, config, uninstrumentedFunctionArns);
    }
    await untagResourcesOfSlsTag(uninstrumentedFunctionArns, config);
}

async function instrumentWithDatadogCi(functionArn, uninstrument = false, runtime = NODE, config, functionArns) {
    console.log(`instrumentWithDatadogCi: functionArns: ${functionArns} , uninstrument: ${uninstrument}`)
    const cli = datadogCi.cli;
    const layerVersionObj = await getLayerAndRuntimeVersion(runtime, config);

    let command;
    if (uninstrument === false) {
        command = ['lambda', 'instrument', '-f', functionArn, '-v', layerVersionObj.runtimeLayerVersion, '-e', layerVersionObj.extensionVersion];
    } else {
        console.log(`\n uninstrumenting...`)
        command = ['lambda', 'uninstrument', '-f', functionArn, '-r', config.AWS_REGION];
    }
    console.log(`🖥️ datadog-ci command: ${JSON.stringify(command)}`);

    const commandExitCode = await cli.run(command);

    console.log(`\n commandExitCode type: ${typeof commandExitCode}, \n commandExitCode: ${commandExitCode}`);
    if (commandExitCode === 0) {
        if (uninstrument === false) {
            console.log(`✅ Function ${functionArn} is instrumented with datadog-ci.`);
        } else {
            console.log(`✅ Function ${functionArn} is uninstrumented with datadog-ci.`);
        }
        functionArns.push(functionArn);
        console.log(`now functionArns: ${JSON.stringify(functionArns)}`)
    } else {
        if (uninstrument === false) {
            console.log(`❌ datadog-ci instrumentation failed for function ${functionArn}`);
        } else {
            console.log(`❌ datadog-ci uninstrumentation failed for function ${functionArn}`);
        }
    }
}

async function getConfig() {
    const config = {
        // AWS
        AWS_REGION: process.env.AWS_REGION,
        DD_AWS_ACCOUNT_NUMBER: process.env.DD_AWS_ACCOUNT_NUMBER,

        // instrumentation and uninstrumentation
        AllowList: process.env.AllowList,
        TagRule: process.env.TagRule,
        DenyList: process.env.DenyList,

        // layer version
        DD_EXTENSION_LAYER_VERSION: process.env.DD_EXTENSION_LAYER_VERSION,
        DD_PYTHON_LAYER_VERSION: process.env.DD_PYTHON_LAYER_VERSION,
        DD_NODE_LAYER_VERSION: process.env.DD_NODE_LAYER_VERSION,
        DD_LAYER_VERSIONS: {
            extensionVersion: process.env.DD_EXTENSION_LAYER_VERSION,
            pythonLayerVersion: process.env.DD_PYTHON_LAYER_VERSION,
            nodeLayerVersion: process.env.DD_NODE_LAYER_VERSION,
        },
    };
    console.log(`\n config: ${JSON.stringify(config)}`)
    return config;
}
