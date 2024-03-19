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

    // Get layer configs from CloudFormation params. If they don't exist, use latest layer from S3
    const response = await getLatestLayersFromS3();
    var layerVersions = {
        extensionVersion: process.env.DD_EXTENSION_LAYER_VERSION,
        pythonLayerVersion: process.env.DD_PYTHON_LAYER_VERSION,
        nodeLayerVersion: process.env.DD_NODE_LAYER_VERSION,
        javaLayerVersion: process.env.DD_JAVA_LAYER_VERSION,
        dotnetLayerVersion: process.env.DD_DOTNET_LAYER_VERSION,
        rubyLayerVersion: process.env.DD_RUBY_LAYER_VERSION,
    }

    if (response.status === 200) {  // only modify result obj if getting data back from the api call
        try {
            const jsonData = response.data

            if (layerVersions.extensionVersion === "") {
                layerVersions.extensionVersion = getVersionFromLayerArn(jsonData, 'Datadog-Extension');
            }
            if (layerVersions.pythonLayerVersion === "") {
                layerVersions.pythonLayerVersion = getVersionFromLayerArn(jsonData, 'Datadog-Python39');
            }
            if (layerVersions.nodeLayerVersion === "") {
                layerVersions.nodeLayerVersion = getVersionFromLayerArn(jsonData, 'Datadog-Node16-x')
            }
            if (layerVersions.javaLayerVersion === "") {
                layerVersions.javaLayerVersion = getVersionFromLayerArn(jsonData, 'dd-trace-java')
            }
            if (layerVersions.dotnetLayerVersion === "") {
                layerVersions.dotnetLayerVersion = getVersionFromLayerArn(jsonData, 'dd-trace-dotnet')
            }
            if (layerVersions.rubyLayerVersion === "") {
                layerVersions.rubyLayerVersion = getVersionFromLayerArn(jsonData, 'Datadog-Ruby3-2')
            }
        } catch (error) {
            console.error('Error parsing s3 layer JSON:', error);
        }
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
        DD_JAVA_LAYER_VERSION: process.env.DD_JAVA_LAYER_VERSION,
        DD_DOTNET_LAYER_VERSION: process.env.DD_DOTNET_LAYER_VERSION,
        DD_RUBY_LAYER_VERSION: process.env.DD_RUBY_LAYER_VERSION,
        DD_LAYER_VERSIONS: layerVersions,
    };
    console.log(`\n config: ${JSON.stringify(config)}`)
    return config;
}
