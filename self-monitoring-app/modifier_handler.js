const {CloudFormationClient, CreateStackCommand, UpdateStackCommand, DeleteStackCommand} = require("@aws-sdk/client-cloudformation"); // CommonJS import

exports.handler = async (event, context, callback) => {

    console.log('\n event:', JSON.stringify(event))
    console.log(`\n process: ${JSON.stringify(process.env)}`)
    const config = await getConfig();
    await uninstrument(config);
    await sleep(30000);

    return `✅ Hi dog.`;
};

// delete stack
async function deleteStack(config) {

}

// create stack
async function createStack(config) {
    const clientConfig = {}
    const client = new CloudFormationClient(clientConfig);
    const input = { // CreateStackInput
        StackName: "STRING_VALUE", // required
        TemplateBody: "STRING_VALUE",
        TemplateURL: "STRING_VALUE",
        Parameters: [ // Parameters
            { // Parameter
                ParameterKey: "STRING_VALUE",
                ParameterValue: "STRING_VALUE",
                UsePreviousValue: true || false,
                ResolvedValue: "STRING_VALUE",
            },
        ],
        DisableRollback: true || false,
        RollbackConfiguration: { // RollbackConfiguration
            RollbackTriggers: [ // RollbackTriggers
                { // RollbackTrigger
                    Arn: "STRING_VALUE", // required
                    Type: "STRING_VALUE", // required
                },
            ],
            MonitoringTimeInMinutes: Number("int"),
        },
        TimeoutInMinutes: Number("int"),
        NotificationARNs: [ // NotificationARNs
            "STRING_VALUE",
        ],
        Capabilities: [ // Capabilities
            "CAPABILITY_IAM" || "CAPABILITY_NAMED_IAM" || "CAPABILITY_AUTO_EXPAND",
        ],
        ResourceTypes: [ // ResourceTypes
            "STRING_VALUE",
        ],
        RoleARN: "STRING_VALUE",
        OnFailure: "DO_NOTHING" || "ROLLBACK" || "DELETE",
        StackPolicyBody: "STRING_VALUE",
        StackPolicyURL: "STRING_VALUE",
        Tags: [ // Tags
            { // Tag
                Key: "STRING_VALUE", // required
                Value: "STRING_VALUE", // required
            },
        ],
        ClientRequestToken: "STRING_VALUE",
        EnableTerminationProtection: true || false,
        RetainExceptOnCreate: true || false,
    };
    const command = new CreateStackCommand(input);
    const response = await client.send(command);
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
    var layerVersions = {
        extensionVersion: process.env.DD_EXTENSION_LAYER_VERSION,
        pythonLayerVersion: process.env.DD_PYTHON_LAYER_VERSION,
        nodeLayerVersion: process.env.DD_NODE_LAYER_VERSION,
    }

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
        DD_LAYER_VERSIONS: layerVersions,
    };
    console.log(`\n config: ${JSON.stringify(config)}`)
    return config;
}
