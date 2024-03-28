const VERSION = '1.0.0'

const axios = require('axios');
const cfnResponse = require("cfn-response");  // file will be auto-injected by CloudFormation
const datadogCi = require('@datadog/datadog-ci/dist/cli.js');
const tracer = require('dd-trace')
const {LambdaClient, GetFunctionCommand} = require("@aws-sdk/client-lambda");
const {
    ResourceGroupsTaggingAPIClient,
    GetResourcesCommand,
    TagResourcesCommand,
    UntagResourcesCommand,
} = require("@aws-sdk/client-resource-groups-tagging-api");

const NODE = "node"
const PYTHON = "python"
const RUBY = "ruby"
const JAVA = "java"
const DOTNET = "dotnet"
const DD_SLS_REMOTE_INSTRUMENTER_VERSION = "dd_sls_remote_instrumenter_version"


exports.handler = async (event, context, callback) => {

    console.log('\n event:', JSON.stringify(event))
    console.log(`\n process: ${JSON.stringify(process.env)}`)

    const config = await getConfig();
    const functionNamesToInstrument = getFunctionNamesFromString(config.AllowList)

    // *** Instrument ***
    // CloudTrail Lambda event
    if (event.hasOwnProperty("detail-type") && event.hasOwnProperty("source") && event.source === "aws.lambda") {
        const eventNamesToSkip = new Set(["DeleteFunction20150331", "AddPermission20150331"])
        if (eventNamesToSkip.has(event.detail?.eventName)) {
            return;
        }
        await instrumentWithEvents_withTrace(event, functionNamesToInstrument, config);
        return;  // do not run initial bulk instrument nor uninstrument
    }

    // initial instrumentation for CloudFormation lifeCycle custom resource
    if (event.hasOwnProperty("RequestType")) {
        if (event.RequestType === "Delete") {
            console.log(`\n === Getting CloudFormation Delete event.`);
            await cfnResponse.send(event, context, "SUCCESS");  // send to response to CloudFormation custom resource endpoint to continue stack deletion
            return;  // do not continue with initial instrumentation
        }
        await initialInstrumentationByAllowList_withTrace(functionNamesToInstrument, config);
        await initialInstrumentationByTagRule_withTrace(config);
        console.log(`\n === sending SUCCESS back to cloudformation`);
        await cfnResponse.send(event, context, "SUCCESS");  // send to response to CloudFormation custom resource endpoint to continue stack creation

        // Stack Updated
    } else if (event.hasOwnProperty("detail-type")
        && event["detail-type"] === "CloudFormation Stack Status Change"
        && event.detail !== undefined
        && event.detail["status-details"] !== undefined
        && event.detail["status-details"].status === "UPDATE_COMPLETE") {
        // CloudTrail event triggered by CloudFormation stack update completed
        await initialInstrumentationByAllowList_withTrace(functionNamesToInstrument, config);
        await initialInstrumentationByTagRule_withTrace(config);
        console.log(`Re-instrument when CloudFormation stack is updated.`)
    }

    // *** Uninstrument ***
    // TODO: change denylist functions to be checked before instrumentation
    if (config.DenyList !== '') {
        const functionNamesToUninstrument = getFunctionNamesFromString(config.DenyList)
        await uninstrumentFunctions_withTrace(functionNamesToUninstrument, config);
        return `✅↩ Lambda uninstrument already-remote-instrumented function(s) finished without failing.`;
    }
    return `✅ Lambda instrument function(s) finished without failing.`;
};

const uninstrumentFunctions_withTrace = tracer.wrap("BulkUninstrumentFunctions", uninstrumentFunctions)
const instrumentWithEvents_withTrace = tracer.wrap('Instrument.SingleEvent', instrumentWithEvent)

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
        DenyListFunctionNameSet: new Set(getFunctionNamesFromString(process.env.DenyList)),

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

async function uninstrumentFunctions(functionNamesToUninstrument, config) {
    function sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    console.log(`\n waiting for 5 seconds for instrument to complete before running unistrument to avoid "The operation cannot be performed at this time. An update is in progress."`)
    await sleep(5000);

    const uninstrumentedFunctionArns = [];
    for (let functionName of functionNamesToUninstrument) {
        console.log(`\n functionName in functionNamesToUninstrument : ${functionName}`)
        const functionArn = `arn:aws:lambda:${config.AWS_REGION}:${config.DD_AWS_ACCOUNT_NUMBER}:function:${functionName}`;
        await instrumentWithDatadogCi(functionArn, true, NODE, config, uninstrumentedFunctionArns);
    }
    await untagResourcesOfSlsTag(uninstrumentedFunctionArns, config);
}

function getRemoteInstrumentTagsFromConfig(config) {
    const ddRemoteInstrumentLambdaTags = config.TagRule
    const tags = ddRemoteInstrumentLambdaTags.split(',')
    console.log(`tags from env var are: ${JSON.stringify(tags)}`);
    return tags
}

function getFunctionNamesFromString(s) {
    const functionNamesArray = s.split(',');
    console.log("Functions specified to be instrumented/uninstrumented are:", functionNamesArray)
    return functionNamesArray;
}

function validateEventIsExpected(event) {
    // safety guard against unexpected event format that should have been filtered by EventBridge Rule

    const expectedEventNameSet = new Set(["UpdateFunctionConfiguration20150331v2", "CreateFunction20150331", "DeleteLayerVersion20181031"])
    if (event["detail-type"] !== "AWS API Call via CloudTrail") {
        throw new Error(`event.detail-type is unexpected. Event: ${JSON.stringify(event)}`)
    }

    if (event["source"] !== "aws.lambda") {
        throw new Error(`event.source is not aws.lambda. Event: ${JSON.stringify(event)}`)
    }

    if (!expectedEventNameSet.has(event["detail"]["eventName"])) {
        throw new Error(`event.detail.eventName is not expected. Event: ${JSON.stringify(event)}`);
        return false;
    }
}

async function instrumentWithEvent(event, specifiedFunctionNames, config) {
    if (event["detail"]["eventName"] === 'UntagResource20170331v2' ||
        event["detail"]["eventName"] === 'TagResource20170331v2') {
        console.log(`TODO: (Un)TagResource20170331v2 is not yet implemented yet.`)
        return;
    }
    // not sure why instrumenter is receiving this event. but skipping for now.
    if (event["detail"]["eventName"] === 'AddPermission20150331v2') {
        console.log(`An "AddPermission20150331v2" event is received. Do nothing and end the invocation now.`)
        return;
    }
    // not sure why instrumenter is receiving this event. but skipping for now.
    if (event["detail"]["eventName"] === 'UpdateFunctionCode20150331v2') {
        console.log(`An "UpdateFunctionCode20150331v2" event is received. Do nothing and end the invocation now.`)
        return;
    }

    validateEventIsExpected(event)

    const specifiedFunctionNameSet = new Set(specifiedFunctionNames)

    let functionFromEventIsInAllowList = false;
    let functionName = event.detail.requestParameters.functionName;

    // special handling for specific event
    // event.detail.requestParameters.functionName for update function event can be ARN or function name
    if (event.hasOwnProperty("detail") && event.detail.hasOwnProperty("eventName") && event.detail.eventName === "UpdateFunctionConfiguration20150331v2") {
        let actuallyFunctionArn = event.detail.requestParameters.functionName;
        let arnParts = actuallyFunctionArn.split(':');
        functionName = arnParts[arnParts.length - 1];
        console.log(`actuallyFunctionArn: ${actuallyFunctionArn}  arnParts: ${JSON.stringify(arnParts)}  functionName:${functionName}`);
    }

    // check if lambda management events is for function that are specified to be instrumented
    if (specifiedFunctionNameSet.has(functionName)) {
        functionFromEventIsInAllowList = true
        console.log(`=== ${functionName} in the specifiedFunctionNameSet: ${JSON.stringify(specifiedFunctionNames)} ===`)
    } else {
        console.log(`=== ${functionName} is NOT in the specifiedFunctionNameSet: ${JSON.stringify(specifiedFunctionNames)} ===`)
    }

    // check if the function has the tags that pass TagRule
    if (!functionFromEventIsInAllowList) {
        // call get function api to get tags and check if the function should be instrumented by tags
        const params = {
            FunctionName: functionName
        };
        const client = new LambdaClient({region: config.AWS_REGION});
        const command = new GetFunctionCommand(params);

        // aws-vault exec sso-serverless-sandbox-account-admin-8h -- aws lambda get-function --function-name test-ci-instrument-kimi --region sa-east-1
        try {
            // filter out already correctly instrumented functions
            const getFunctionCommandOutput = await client.send(command);

            const layers = getFunctionCommandOutput.Configuration.Layers || [];
            const targetLambdaRuntime = getFunctionCommandOutput.Configuration.Runtime || "";
            if (functionIsInstrumentedWithSpecifiedLayerVersions(layers, config, targetLambdaRuntime)) {
                console.log(`\n=== Function ${functionName} is already instrumented with correct extension and tracer layer versions! `);
                return;
            }

            const specifiedTags = getRemoteInstrumentTagsFromConfig(config)  // tags: ['k1:v1', 'k2:v2']
            if (typeof (specifiedTags) === "object" && specifiedTags.length !== 0 && !shouldBeRemoteInstrumentedByTag(getFunctionCommandOutput, specifiedTags)) {
                console.log(`\n=== Skipping remote instrumentation for function ${functionName}. It should not be remote instrumented by TagRule nor by AllowList`)
                return;
            }
        } catch (error) {
            // simply skip this current instrumentation of the function.
            console.log(`\nError is caught for functionName ${functionName}. Skipping instrumenting this function. Error is: ${error}`);
        }
    }

    // handle create function event
    let functionArn = null;
    let runtime = event.detail?.responseElements?.runtime;
    if (event.detail.responseElements != null) {
        functionArn = event.detail.responseElements.functionArn;
    } else if (event.detail.eventName === 'CreateFunction20150331') {
        // no functionArn field if create from AWS UI
        let account = event.account;
        let region = event.region;
        let functionName = event.detail.requestParameters.functionName;
        functionArn = `arn:aws:lambda:${region}:${account}:function:${functionName}`

        if (runtime === null || runtime === undefined) {
            runtime = event.detail?.requestParameters?.runtime;
        }
    }

    // get runtime
    if (typeof (runtime) !== "string") {
        console.error(`unexpected event.responseElements.runtime: ${runtime}`);
    }
    const instrumentedFunctionArns = [];
    await instrumentWithDatadogCi(functionArn, false, runtime, config, instrumentedFunctionArns);
    await tagResourcesWithSlsTag(instrumentedFunctionArns, config);
}

function shouldBeRemoteInstrumentedByTag(getFunctionCommandOutput, specifiedTags) {
    const awsFunctionTags = getFunctionCommandOutput.Tags;  // {"env:prod", "team":"serverless"}
    if (typeof (awsFunctionTags) === 'undefined') {
        console.log(`=== no tags found on the function`)
        return false;
    }

    const specifiedTagsKvMapping = getSpecifiedTagsKvMapping(specifiedTags);  // {"env": ["staging", "prod"], "team": ["serverless"]}

    for (const [k, shouldBeInstrumentedValueList] of Object.entries(specifiedTagsKvMapping)) {
        if (!awsFunctionTags.hasOwnProperty(k)) {
            console.log(`=== this function should NOT be remote instrumented by tags`);
            return false;
        }

        // AWS resource with tag k should have value specified in the list
        if (!shouldBeInstrumentedValueList.includes(awsFunctionTags[k])) {
            console.log(`=== this function should NOT be remote instrumented by tags`);
            return false;
        }
    }
    console.log(`=== this function should be remote instrumented by tags`);
    return true;
}

async function getFunctionNamesFromResourceGroupsTaggingAPI(tagFilters, config) {
    // aws-vault exec sso-serverless-sandbox-account-admin-8h -- aws resourcegroupstaggingapi get-resources --tag-filters Key=DD_AUTO_INSTRUMENT_ENABLED,Values=true --resource-type-filters="lambda:function" --region sa-east-1
    // aws-vault exec sso-serverless-sandbox-account-admin-8h -- aws resourcegroupstaggingapi get-resources --tag-filters Key=createdBy,Values=kimi --resource-type-filters="lambda:function" --region sa-east-1
    const client = new ResourceGroupsTaggingAPIClient({region: config.AWS_REGION});
    const input = {
        TagFilters: tagFilters,
        ResourceTypeFilters: ["lambda:function"]
    }
    const getResourcesCommand = new GetResourcesCommand(input);
    let getResourcesCommandOutput = {ResourceTagMappingList: []};
    try {
        getResourcesCommandOutput = await client.send(getResourcesCommand);
    } catch (error) {
        console.error(`\n error: ${error}. \n Returning empty array for instrumenting functions by tags`);
        return [];
    }

    console.log(`=== api call output of getResourcesCommandOutput: ${JSON.stringify(getResourcesCommandOutput)}`)
    const functionArns = [];
    for (let resourceTagMapping of getResourcesCommandOutput.ResourceTagMappingList) {
        functionArns.push(resourceTagMapping.ResourceARN);
    }
    console.log(`== functionArns: ${functionArns}`);

    if (functionArns.length === 0) {
        return [];
    }

    const functionNames = [];
    for (let functionArn of functionArns) {
        if (typeof (functionArn) === 'string') {
            functionNames.push(functionArn.split(":")[6]);
        }
    }
    if (functionNames.length === 0) {
        console.log(`No functions to be instrumented by specified tags ${JSON.stringify(specifiedTags)}.`);
        return [];
    }
    console.log(`=== functionNames: ${functionNames}`);
    return functionNames;
}

const initialInstrumentationByTagRule_withTrace = tracer.wrap('BulkInstrument.SpecifiedTags', initialInstrumentationByTagRule)

async function initialInstrumentationByTagRule(config) {
    const specifiedTags = getRemoteInstrumentTagsFromConfig(config);  // tags: ['k1:v1', 'k2:v2']
    console.log(`== specifiedTags: ${specifiedTags}`);
    if (specifiedTags === undefined || specifiedTags.length === 0) {
        return;
    }
    console.log(`== RemoteInstrumentTagsFromEnvVar: ${specifiedTags}`);

    const tagKvMapping = getSpecifiedTagsKvMapping(specifiedTags);

    const tagFilters = [];
    for (const [key, value] of Object.entries(tagKvMapping)) {
        tagFilters.push({
            Key: key,
            Values: value,
        })
    }
    console.log(`== tagFilters: ${JSON.stringify(tagFilters)}`);

    const functionNames = await getFunctionNamesFromResourceGroupsTaggingAPI(tagFilters, config);
    await initialInstrumentationByAllowList_withTrace(functionNames, config);
}

function getSpecifiedTagsKvMapping(specifiedTags) {  // return e.g. {"env": ["staging", "prod"], "team": ["serverless"]}
    const tagKvMapping = {};  // default dict of list to hold values of the same key
    for (let tag of specifiedTags) {
        let [k, v] = tag.split(':');
        if (!tagKvMapping.hasOwnProperty(k)) {
            tagKvMapping[k] = []
        }
        tagKvMapping[k].push(v)
    }
    console.log(`== tagKvMapping: ${JSON.stringify(tagKvMapping)}`)
    return tagKvMapping;
}

const initialInstrumentationByAllowList_withTrace = tracer.wrap('BulkInstrument.SpecifiedFunctionNames', initialInstrumentationByAllowList)

async function initialInstrumentationByAllowList(functionNames, config) {
    if (typeof (functionNames) !== 'object' || functionNames.length === 0) {
        console.log(`functionNames is empty in initialInstrumentationWithNames().`);
        return;
    }
    const ddAwsAccountNumber = config.DD_AWS_ACCOUNT_NUMBER

    const client = new LambdaClient({region: config.AWS_REGION});
    const instrumentedFunctionArns = [];
    for (let functionName of functionNames) {
        console.log(`=== processing ${functionName}`)
        if (config.DenyListFunctionNameSet.contains(functionName)){
            console.log(`function ${functionName} is in the DenyList ${JSON.stringify(config.DenyListFunctionNameSet)}`)
            continue;
        }

        // call get function api
        const params = {
            FunctionName: functionName
        };
        const command = new GetFunctionCommand(params);

        // aws-vault exec sso-serverless-sandbox-account-admin-8h -- aws lambda get-function --function-name test-ci-instrument-kimi --region sa-east-1
        try {
            // filter out already instrumented functions
            const getFunctionCommandOutput = await client.send(command);

            console.log(`=== function config is: ${JSON.stringify(getFunctionCommandOutput.Configuration)} \n`)
            const layers = getFunctionCommandOutput.Configuration.Layers || [];
            const targetLambdaRuntime = getFunctionCommandOutput.Configuration.Runtime || "";
            if (functionIsInstrumentedWithSpecifiedLayerVersions(layers, config, targetLambdaRuntime)) {
                console.log(`\n=== Function ${functionName} is already instrumented with correct extension and tracer layer versions! `);
                continue;
            }

            // instrument
            let functionArn = `arn:aws:lambda:${config.AWS_REGION}:${ddAwsAccountNumber}:function:${functionName}`;
            let runtime = getFunctionCommandOutput.Configuration?.Runtime;
            if (runtime === undefined) {
                console.error(`Unexpected runtime: ${runtime} on getFunctionCommandOutput.Configuration?.Runtime`)
            }
            await instrumentWithDatadogCi(functionArn, false, runtime, config, instrumentedFunctionArns);
        } catch (error) {
            // simply skip this current instrumentation of the function.
            console.log(`Error is caught for functionName ${functionName}. Skipping instrumenting this function. Error is: ${error}`);
        }
    }

    await tagResourcesWithSlsTag(instrumentedFunctionArns, config);
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

async function tagResourcesWithSlsTag(functionArns, config) {
    console.log(`\n functionArns to tag: ${functionArns}`)
    if (functionArns.length === 0) {
        return;
    }
    console.log(`\n version: ${DD_SLS_REMOTE_INSTRUMENTER_VERSION}:v${VERSION}`);

    const client = new ResourceGroupsTaggingAPIClient({region: config.AWS_REGION});
    const input = {
        ResourceARNList: functionArns,
        Tags: {DD_SLS_REMOTE_INSTRUMENTER_VERSION: `v${VERSION}`}
    }
    const tagResourcesCommand = new TagResourcesCommand(input);
    try {
        const tagResourcesCommandOutput = await client.send(tagResourcesCommand);
        console.log(`\n tagResourcesCommandOutput: ${JSON.stringify(tagResourcesCommandOutput)}`)
    } catch (error) {
        console.error(`\n error: ${error.toString()} when tagging resources`);
    }
}

async function untagResourcesOfSlsTag(functionArns, config) {
    console.log(`\n functionArns to untag: ${functionArns}`)
    if (functionArns.length === 0) {
        return;
    }

    const client = new ResourceGroupsTaggingAPIClient({region: config.AWS_REGION});
    const input = {
        ResourceARNList: functionArns,
        TagKeys: [DD_SLS_REMOTE_INSTRUMENTER_VERSION]
    }
    const untagResourcesCommand = new UntagResourcesCommand(input);
    try {
        const untagResourcesCommandOutput = await client.send(untagResourcesCommand);
        console.log(`=== api call output of getResourcesCommand: ${JSON.stringify(untagResourcesCommandOutput.ResourceTagMappingList)}`)
    } catch (error) {
        console.error(`\n error: ${error.toString()} when untagging resources`);
    }
}


function functionIsInstrumentedWithSpecifiedLayerVersions(layers, config, targetLambdaRuntime) {
    if (layers.length === 0) {
        return false;
    }

    // check the extension
    let targetLambdaExtensionLayerVersion = '-1';
    for (let layer of layers) {
        if (layer?.Arn?.includes("464622532012:layer:Datadog-Extension")) {
            console.log(`\n layer: ${JSON.stringify(layer)}`)
            targetLambdaExtensionLayerVersion = layer.Arn.split(':').at(-1);
            break;
        }
    }

    if (targetLambdaExtensionLayerVersion !== config.DD_LAYER_VERSIONS.extensionVersion) {
        // return early so that we run datadog-ci with specified versions in the config
        return false;
    }

    for (let layer of layers) {
        console.log(`\n runtime layer: ${JSON.stringify(layer)}`)
        if (layer?.Arn?.includes("464622532012:layer")) {  // Datadog Layer
            if (layer.Arn.includes("464622532012:layer:Datadog-Python") && targetLambdaRuntime.toLowerCase().includes("python")) {
                return layer.Arn.split(':').at(-1) === config.DD_LAYER_VERSIONS.pythonLayerVersion;
            } else if (layer.Arn.includes("464622532012:layer:Datadog-Node") && targetLambdaRuntime.toLowerCase().includes("node")) {
                return layer.Arn.split(':').at(-1) === config.DD_LAYER_VERSIONS.nodeLayerVersion;
            } else if (layer.Arn.includes("464622532012:layer:Datadog-Ruby") && targetLambdaRuntime.toLowerCase().includes("ruby")) {
                return layer.Arn.split(':').at(-1) === config.DD_LAYER_VERSIONS.rubyLayerVersion;
            } else if (layer.Arn.includes("464622532012:layer:dd-trace-java") && targetLambdaRuntime.toLowerCase().includes("java")) {
                return layer.Arn.split(':').at(-1) === config.DD_LAYER_VERSIONS.javaLayerVersion;
            } else if (layer.Arn.includes("464622532012:layer:dd-trace-dotnet") && targetLambdaRuntime.toLowerCase().includes("dotnet")) {
                return layer.Arn.split(':').at(-1) === config.DD_LAYER_VERSIONS.dotnetLayerVersion;
            }
        }
    }
    return true;  // extension version is correct and tracer version is correct too
}


async function getLayerAndRuntimeVersion(runtime, config) {
    const result = {
        runtimeLayerVersion: null,
        extensionVersion: config.DD_LAYER_VERSIONS.extensionVersion,
    };

    // use config settings
    if (runtime.includes(NODE)) {
        result.runtimeLayerVersion = config.DD_LAYER_VERSIONS.nodeLayerVersion;
    } else if (runtime.includes(PYTHON)) {
        result.runtimeLayerVersion = config.DD_LAYER_VERSIONS.pythonLayerVersion;
    } else if (runtime.includes(RUBY)) {
        result.runtimeLayerVersion = config.DD_LAYER_VERSIONS.rubyLayerVersion;
    } else if (runtime.includes(JAVA)) {
        result.runtimeLayerVersion = config.DD_LAYER_VERSIONS.javaLayerVersion;
    } else if (runtime.includes(DOTNET)) {
        result.runtimeLayerVersion = config.DD_LAYER_VERSIONS.dotnetLayerVersion;
    }

    // set default version, if config settings is undefined (get from s3 failed and no pinned version from CloudFormation parameters)
    if (result.extensionVersion === undefined) {
        result.extensionVersion = '53'
    }
    if (result.runtimeLayerVersion === undefined) {
        if (runtime.includes(NODE)) {
            result.runtimeLayerVersion = '98';
        } else if (runtime.includes(PYTHON)) {
            result.runtimeLayerVersion = '80';
        } else if (runtime.includes(RUBY)) {
            result.runtimeLayerVersion = '20';
        } else if (runtime.includes(JAVA)) {
            result.runtimeLayerVersion = '10';
        } else if (runtime.includes(DOTNET)) {
            result.runtimeLayerVersion = '9';
        }
    }
    return result;
}

function getVersionFromLayerArn(jsonData, fieldToParse) {
    if (jsonData.hasOwnProperty(fieldToParse)) {
        const parsedField = jsonData[fieldToParse];
        const arn_split_list = parsedField.split(':');
        return arn_split_list[arn_split_list.length - 1];
    }
    console.error(`${fieldToParse} is not a property of ${jsonData}`)
}

async function getLatestLayersFromS3() {
    const layerURL = 'https://datadog-sls-layer-versions.s3.sa-east-1.amazonaws.com/latest.json';
    try {
        return await axios.get(layerURL);
    } catch (error) {
        console.error(error);
    }
}
