const {
    CloudFormationClient,
    CreateStackCommand,
    UpdateStackCommand,
    DeleteStackCommand
} = require("@aws-sdk/client-cloudformation"); // CommonJS import

exports.handler = async (event, context, callback) => {

    console.log('\n event:', JSON.stringify(event))
    console.log(`\n process: ${JSON.stringify(process.env)}`)
    const config = await getConfig();
    // await uninstrument(config);
    // await sleep(30000);

    await createStack(config);
    return `✅ All done.`;
};

// delete stack
async function deleteStack(config) {

}

// create stack
async function createStack(config) {
    const clientConfig = { region: config.AWS_REGION }
    const client = new CloudFormationClient(clientConfig);
    const input = { // CreateStackInput
        StackName: "datadog-remote-instrument", // required
        // TemplateBody: "STRING_VALUE",
        // TemplateURL: "https://datadog-cloudformation-template-serverless-sandbox.s3.amazonaws.com/aws/remote-instrument-dev/latest.yaml",
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
                ParameterValue: "remote-instrument-self-monitor",
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
    const command = new CreateStackCommand(input);
    const response = await client.send(command);
    console.log(`Create stack response: ${JSON.stringify(response)}`)
// { // CreateStackOutput
//   StackId: "STRING_VALUE",
// };
}

// update stack
async function updateStack(config) {

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
    const span = tracer.scope().active();
    if (span !== null) {
        span.setTag('functionNamesToUninstrument', functionNamesToUninstrument)
    }
    console.log(`\n functionNamesToUninstrument: ${functionNamesToUninstrument}`)

    const uninstrumentedFunctionArns = [];
    for (let functionName of functionNamesToUninstrument) {
        console.log(`\n functionName in functionNamesToUninstrument : ${functionName}`)
        const functionArn = `arn:aws:lambda:${config.AWS_REGION}:${config.DD_AWS_ACCOUNT_NUMBER}:function:${functionName}`;
        await instrumentWithDatadogCi(functionArn, true, NODE, config, uninstrumentedFunctionArns);
    }
    await untagResourcesOfSlsTag(uninstrumentedFunctionArns, config);
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
