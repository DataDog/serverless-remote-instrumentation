const VERSION = "1.0.0";

const axios = require("axios");
const cfnResponse = require("cfn-response"); // file will be auto-injected by CloudFormation
const datadogCi = require("@datadog/datadog-ci/dist/cli.js");
const tracer = require("dd-trace");
const { LambdaClient, GetFunctionCommand } = require("@aws-sdk/client-lambda");
const {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
  TagResourcesCommand,
  UntagResourcesCommand,
} = require("@aws-sdk/client-resource-groups-tagging-api");

const NODE = "node";
const PYTHON = "python";
const DD_SLS_REMOTE_INSTRUMENTER_VERSION = "dd_sls_remote_instrumenter_version";

// consts
const DENIED = "denied";
const FAILED = "failed";
const INSTRUMENT = "Instrument";
const IN_PROGRESS = "in_progress";
const LAMBDA_EVENT = "LambdaEvent";
const REMOTE_INSTRUMENTATION_STARTED = "RemoteInstrumentationStarted";
const REMOTE_INSTRUMENTATION_ENDED = "RemoteInstrumentationEnded";
const PROCESSING = "processing";
const SKIPPED = "skipped";
const SUCCEEDED = "succeeded";
const UNINSTRUMENT = "Uninstrument";

exports.handler = async (event, context) => {
  logger.logObject(event);
  const instrumentOutcome = {
    instrument: { succeeded: {}, failed: {}, skipped: {} },
    uninstrument: { succeeded: {}, failed: {}, skipped: {} },
  };

  const config = await getConfig();
  const allowListFunctionNames = getFunctionNamesFromString(config.AllowList);

  // One Lambda CloudTrail management event, only at most one Lambda will be updated
  if (
    Object.prototype.hasOwnProperty.call(event, "detail-type") &&
    Object.prototype.hasOwnProperty.call(event, "source") &&
    event.source === "aws.lambda"
  ) {
    const eventNamesToSkip = new Set([
      "AddPermission20150331",
      "AddPermission20150331v2",
      "DeleteFunction20150331",
      "PublishLayerVersion20181031",
      "RemovePermission20150331",
      "PutFunctionConcurrency20171031",
      "RemovePermission20150331v2",
      "UpdateFunctionCode20150331v2",
    ]);
    if (eventNamesToSkip.has(event.detail?.eventName)) {
      console.log(`${event.detail?.eventName} event is skipped.`);
      return;
    }
    if (
      event.detail.eventName === "UntagResource20170331v2" ||
      event.detail.eventName === "TagResource20170331v2"
    ) {
      console.log(
        "TODO: Processing of (Un)TagResource20170331v2 is not yet implemented yet.",
      );
      return;
    }
    logger.emitFrontEndEvent(
      REMOTE_INSTRUMENTATION_STARTED,
      LAMBDA_EVENT,
      null,
      config,
    );
    await instrumentBySingleEvent(event, config, instrumentOutcome);
    logger.emitFrontEndEvent(
      REMOTE_INSTRUMENTATION_ENDED,
      LAMBDA_EVENT,
      instrumentOutcome,
      config,
    );

    // Stack created
  } else if (Object.prototype.hasOwnProperty.call(event, "RequestType")) {
    if (event.RequestType === "Delete") {
      console.log("Getting CloudFormation Delete event.");
      await cfnResponse.send(event, context, "SUCCESS"); // send to response to CloudFormation custom resource endpoint to continue stack deletion
      return;
    }
    logger.emitFrontEndEvent(
      REMOTE_INSTRUMENTATION_STARTED,
      "StackCreation",
      null,
      config,
    );
    await firstTimeInstrumentationByAllowList(
      allowListFunctionNames,
      config,
      instrumentOutcome,
    );
    await firstTimeInstrumentationByTagRule(config, instrumentOutcome);
    // send response to CloudFormation custom resource endpoint to continue stack creation
    await cfnResponse.send(event, context, "SUCCESS");
    logger.emitFrontEndEvent(
      REMOTE_INSTRUMENTATION_ENDED,
      "StackCreation",
      instrumentOutcome,
      config,
    );

    // Stack updated
  } else if (
    Object.prototype.hasOwnProperty.call(event, "detail-type") &&
    event["detail-type"] === "CloudFormation Stack Status Change" &&
    event.detail["status-details"].status === "UPDATE_COMPLETE"
  ) {
    // CloudTrail event triggered by CloudFormation stack update completed
    logger.emitFrontEndEvent(
      REMOTE_INSTRUMENTATION_STARTED,
      "StackUpdate",
      null,
      config,
    );
    await stackUpdateUninstrumentBasedOnAllowListAndTagRule(
      config,
      instrumentOutcome,
    );
    await stackUpdateInstrumentByAllowList(
      allowListFunctionNames,
      config,
      instrumentOutcome,
    );
    await stackUpdateInstrumentByTagRule(config, instrumentOutcome);
    logger.emitFrontEndEvent(
      REMOTE_INSTRUMENTATION_ENDED,
      "StackUpdate",
      instrumentOutcome,
      config,
    );
  } else {
    console.error("Unexpected event encountered. Please check event.");
  }
};

//// wrappers
// single
const instrumentBySingleEvent = tracer.wrap(
  "Instrument.BySingleLambdaEvent",
  instrumentByEvent,
);
// first time instrumentation
const firstTimeInstrumentationByAllowList = tracer.wrap(
  "FirstTimeBulkInstrument.ByAllowList",
  instrumentByFunctionNames,
);
const firstTimeInstrumentationByTagRule = tracer.wrap(
  "FirstTimeBulkInstrument.ByTagRule",
  instrumentationByTagRule,
);
// stack update
const stackUpdateUninstrumentBasedOnAllowListAndTagRule = tracer.wrap(
  "StackUpdate.CheckAnythingToUninstrument",
  uninstrumentBasedOnAllowListAndTagRule,
);
const stackUpdateInstrumentByAllowList = tracer.wrap(
  "StackUpdate.Instrument.ByAllowList",
  instrumentByFunctionNames,
);
const stackUpdateInstrumentByTagRule = tracer.wrap(
  "StackUpdate.Instrument.ByTagRule",
  instrumentationByTagRule,
);

async function getConfig() {
  // Get layer configs from CloudFormation params. If they don't exist, use latest layer from S3
  const response = await getLatestLayersFromS3();
  const layerVersions = {
    extensionVersion: process.env.DD_EXTENSION_LAYER_VERSION,
    pythonLayerVersion: process.env.DD_PYTHON_LAYER_VERSION,
    nodeLayerVersion: process.env.DD_NODE_LAYER_VERSION,
  };
  console.log(`process.env: ${JSON.stringify(process.env)}`);

  if (response.status === 200) {
    try {
      const jsonData = response.data;

      if (layerVersions.extensionVersion === "") {
        layerVersions.extensionVersion = getVersionFromLayerArn(
          jsonData,
          "Datadog-Extension",
        );
      }
      if (layerVersions.pythonLayerVersion === "") {
        layerVersions.pythonLayerVersion = getVersionFromLayerArn(
          jsonData,
          "Datadog-Python39",
        );
      }
      if (layerVersions.nodeLayerVersion === "") {
        layerVersions.nodeLayerVersion = getVersionFromLayerArn(
          jsonData,
          "Datadog-Node16-x",
        );
      }
    } catch (error) {
      console.error("Error parsing s3 layer JSON:", error);
    }
  }

  const config = {
    AWS_REGION: process.env.AWS_REGION,
    DD_AWS_ACCOUNT_NUMBER: process.env.DD_AWS_ACCOUNT_NUMBER,

    AllowList: process.env.DD_ALLOW_LIST,
    AllowListFunctionNameSet: new Set(
      getFunctionNamesFromString(process.env.DD_ALLOW_LIST),
    ),
    TagRule: process.env.DD_TAG_RULE,
    DenyList: process.env.DD_DENY_LIST,
    DenyListFunctionNameSet: new Set(
      getFunctionNamesFromString(process.env.DD_DENY_LIST),
    ),

    DD_EXTENSION_LAYER_VERSION: process.env.DD_EXTENSION_LAYER_VERSION,
    DD_PYTHON_LAYER_VERSION: process.env.DD_PYTHON_LAYER_VERSION,
    DD_NODE_LAYER_VERSION: process.env.DD_NODE_LAYER_VERSION,
    DD_LAYER_VERSIONS: layerVersions,

    MinimumMemorySize: process.env.DD_MinimumMemorySize,
  };
  logger.logObject({ ...config, ...{ eventName: "config" } });
  console.log(
    `AllowList: ${JSON.stringify([...config.AllowListFunctionNameSet])}`,
  );
  console.log(
    `DenyList: ${JSON.stringify([...config.DenyListFunctionNameSet])}`,
  );
  return config;
}

async function uninstrumentBasedOnAllowListAndTagRule(
  config,
  instrumentOutcome,
) {
  // get the functions with DD_SLS_REMOTE_INSTRUMENTER_VERSION tag
  const otherFilteringTags = { [DD_SLS_REMOTE_INSTRUMENTER_VERSION]: [] };
  const remoteInstrumentedFunctionNames =
    await getFunctionNamesByTagRuleOrOtherFilteringTags(
      config,
      otherFilteringTags,
    );
  console.log(
    `functions that is already instrumented: ${remoteInstrumentedFunctionNames}`,
  );

  const functionNamesByTagRule =
    await getFunctionNamesByTagRuleOrOtherFilteringTags(config);

  const remoteInstrumentedFunctionsSet = new Set(
    remoteInstrumentedFunctionNames,
  );
  const functionsThatShouldBeRemoteInstrumented = new Set(
    functionNamesByTagRule,
  );

  // uninstrument these functions:
  let functionsToBeUninstrumented;
  if (config.DenyList === "*") {
    functionsToBeUninstrumented = remoteInstrumentedFunctionNames;
    logger.logInstrumentOutcome(UNINSTRUMENT, IN_PROGRESS, "ALL");
  } else {
    functionsToBeUninstrumented = Array.from(
      remoteInstrumentedFunctionsSet,
    ).filter(
      (functionName) =>
        (!functionsThatShouldBeRemoteInstrumented.has(functionName) &&
          !config.AllowListFunctionNameSet.has(functionName)) ||
        config.DenyListFunctionNameSet.has(functionName),
    );
  }
  console.log(
    `functionsToBeUninstrumented: ${JSON.stringify(functionsToBeUninstrumented)}`,
  );
  await uninstrumentFunctions(
    functionsToBeUninstrumented,
    config,
    instrumentOutcome,
  );
}

async function uninstrumentFunctions(
  functionNamesToUninstrument,
  config,
  instrumentOutcome,
) {
  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  console.log(
    'waiting for 10 seconds for instrument to complete before running unistrument to avoid "The operation cannot be performed at this time. An update is in progress."',
  );
  await sleep(10000);

  const uninstrumentedFunctionArns = [];
  for (const functionName of functionNamesToUninstrument) {
    console.log(`functionName in functionNamesToUninstrument: ${functionName}`);
    const functionArn = `arn:aws:lambda:${config.AWS_REGION}:${config.DD_AWS_ACCOUNT_NUMBER}:function:${functionName}`;
    await instrumentWithDatadogCi(
      instrumentOutcome,
      functionArn,
      true,
      NODE,
      config,
      uninstrumentedFunctionArns,
    );
  }
  await untagResourcesOfSlsTag(uninstrumentedFunctionArns, config);
}

function getTagRuleFromConfig(config) {
  const tagRule = config.TagRule;
  if (tagRule === "") {
    return [];
  }
  const tagRuleTags = tagRule.split(",");
  console.log(
    `tags of TagRule from env var are: ${JSON.stringify(tagRuleTags)}`,
  );
  return tagRuleTags;
}

function getFunctionNamesFromString(s) {
  const functionNamesArray = s.split(",");
  console.log(
    "Function names parsed by getFunctionNamesFromString:",
    functionNamesArray,
  );
  return functionNamesArray;
}

function validateEvent(event) {
  // safety guard against unexpected event format that should have been filtered by EventBridge Rule

  const expectedEventNameSet = new Set([
    "UpdateFunctionConfiguration20150331v2",
    "CreateFunction20150331",
    "DeleteLayerVersion20181031",
  ]);
  if (event["detail-type"] !== "AWS API Call via CloudTrail") {
    throw new Error(
      `event.detail-type is unexpected. Event: ${JSON.stringify(event)}`,
    );
  }

  if (event.source !== "aws.lambda") {
    throw new Error(
      `event.source is not aws.lambda. Event: ${JSON.stringify(event)}`,
    );
  }

  if (!expectedEventNameSet.has(event.detail.eventName)) {
    throw new Error(
      `event.detail.eventName is not expected. Event: ${JSON.stringify(event)}`,
    );
  }
}

async function instrumentByEvent(event, config, instrumentOutcome) {
  validateEvent(event);

  let functionFromEventIsInAllowList = false;
  let functionName = event.detail.requestParameters?.functionName;

  // special handling for specific event
  // event.detail.requestParameters.functionName for update function event can be ARN or function name
  if (
    Object.prototype.hasOwnProperty.call(event, "detail") &&
    Object.prototype.hasOwnProperty.call(event.detail, "eventName") &&
    event.detail.eventName === "UpdateFunctionConfiguration20150331v2"
  ) {
    functionName = event.detail.responseElements.functionName;
    console.log(
      `The function name in the UpdateFunctionConfiguration20150331v2 event is: ${functionName}`,
    );
  }
  console.log(`The current function name is ${functionName}`);

  if (config.DenyList === "*") {
    logger.logInstrumentOutcome(INSTRUMENT, SKIPPED, functionName);
    return;
  }
  logger.debugLogs(
    LAMBDA_EVENT,
    PROCESSING,
    functionName,
    "Lambda management event is received and starting instrumentation",
  );

  // filter out functions that are on the DenyList
  if (config.DenyListFunctionNameSet.has(functionName)) {
    logger.debugLogs(
      LAMBDA_EVENT,
      PROCESSING,
      functionName,
      `function ${functionName} is on the DenyList ${JSON.stringify([...config.DenyListFunctionNameSet])}. Instrumentation has stopped.`,
    );
    return;
  }

  // check if lambda management events is for function that are in the allow list
  if (config.AllowListFunctionNameSet.has(functionName)) {
    functionFromEventIsInAllowList = true;
    logger.debugLogs(
      LAMBDA_EVENT,
      PROCESSING,
      functionName,
      `${functionName} in the AllowListFunctionNameSet: ${JSON.stringify([...config.AllowListFunctionNameSet])}`,
    );
  } else {
    logger.debugLogs(
      LAMBDA_EVENT,
      PROCESSING,
      functionName,
      `${functionName} is NOT in the AllowListFunctionNameSet: ${JSON.stringify([...config.AllowListFunctionNameSet])}`,
    );
  }

  // handle create function event for runtime and functionArn
  let functionArn = null;
  let runtime = event.detail?.responseElements?.runtime;
  if (event.detail.responseElements != null) {
    functionArn = event.detail.responseElements.functionArn;
  } else if (event.detail.eventName === "CreateFunction20150331") {
    // no functionArn field if create from AWS UI
    const functionName = event.detail.requestParameters.functionName;
    functionArn = `arn:aws:lambda:${event.region}:${event.account}:function:${functionName}`;

    if (runtime === null || runtime === undefined) {
      runtime = event.detail?.requestParameters?.runtime;
    }
  }

  // check if the function has the tags that pass TagRule
  if (!functionFromEventIsInAllowList) {
    // call get function api to get tags and check if the function should be instrumented by tags
    const params = {
      FunctionName: functionName,
    };
    const client = new LambdaClient({ region: config.AWS_REGION });
    const command = new GetFunctionCommand(params);

    try {
      // filter out already correctly instrumented functions
      const getFunctionCommandOutput = await client.send(command);

      const layers = getFunctionCommandOutput.Configuration.Layers || [];
      const targetLambdaRuntime =
        getFunctionCommandOutput.Configuration.Runtime || "";
      if (
        functionIsInstrumentedWithSpecifiedLayerVersions(
          layers,
          config,
          targetLambdaRuntime,
        )
      ) {
        logger.debugLogs(
          LAMBDA_EVENT,
          PROCESSING,
          functionName,
          `Function ${functionName} is already instrumented with correct extension and tracer layer versions! `,
        );
        return;
      }

      const specifiedTags = getTagRuleFromConfig(config); // tags: ['k1:v1', 'k2:v2']
      if (specifiedTags.length === 0) {
        logger.debugLogs(
          INSTRUMENT,
          SKIPPED,
          functionName,
          `The function is not in the AllowList and the tagRule is empty.`,
        );
        return;
      }
      if (
        typeof specifiedTags === "object" &&
        specifiedTags.length !== 0 &&
        !shouldBeRemoteInstrumentedByTag(
          getFunctionCommandOutput,
          specifiedTags,
          instrumentOutcome,
          functionName,
          null,
        )
      ) {
        logger.debugLogs(
          LAMBDA_EVENT,
          SKIPPED,
          functionName,
          `Skipping remote instrumentation for function ${functionName}. It does not fit TagRule nor is in the AllowList`,
        );
        return;
      }
      logger.debugLogs(
        LAMBDA_EVENT,
        PROCESSING,
        functionName,
        `${functionName} is not in the AllowList but matches TagRule`,
      );
    } catch (error) {
      logger.debugLogs(
        LAMBDA_EVENT,
        PROCESSING,
        functionName,
        `Error is caught for functionName ${functionName}. Skipping instrumenting this function. Error is: ${error}`,
      );
      return;
    }
  }

  if (
    belowRecommendedMemorySize(
      event,
      functionName,
      config,
      instrumentOutcome,
      functionArn,
    )
  ) {
    return;
  }

  // get runtime
  if (typeof runtime !== "string") {
    console.error(`unexpected event.responseElements.runtime: ${runtime}`);
  }
  const instrumentedFunctionArns = [];
  await instrumentWithDatadogCi(
    instrumentOutcome,
    functionArn,
    false,
    runtime,
    config,
    instrumentedFunctionArns,
  );
  await tagResourcesWithSlsTag(instrumentedFunctionArns, config);
}

function belowRecommendedMemorySize(
  event,
  functionName,
  config,
  instrumentOutcome,
  functionArn,
) {
  let currentMemorySize = 1; // in case there are unexpected eventNames
  // only need to check these 2 events
  if (event.detail.eventName === "CreateFunction20150331") {
    currentMemorySize = parseInt(event.detail?.requestParameters?.memorySize);
  } else if (
    event.detail.eventName === "UpdateFunctionConfiguration20150331v2"
  ) {
    currentMemorySize = parseInt(event.detail?.responseElements?.memorySize);
  }
  if (currentMemorySize < parseInt(config.MinimumMemorySize)) {
    logger.logInstrumentOutcome(
      INSTRUMENT,
      FAILED,
      functionName,
      null,
      null,
      null,
      `Current memory size ${currentMemorySize} MB is below threshold ${config.MinimumMemorySize} MB.`,
    );
    const message = `Current memory size ${currentMemorySize} MB is below threshold ${config.MinimumMemorySize} MB.`;
    logger.debugLogs(LAMBDA_EVENT, SKIPPED, functionName, message);
    instrumentOutcome.instrument.skipped[functionName] = {
      functionArn,
      reason: message,
    };
    return true;
  }
  return false;
}

function shouldBeRemoteInstrumentedByTag(
  getFunctionCommandOutput,
  specifiedTags,
  instrumentOutcome,
  functionName,
  functionArn,
) {
  const targetFunctionTagsObj = getFunctionCommandOutput.Tags; // {"env":"prod", "team":"serverless"}
  if (typeof targetFunctionTagsObj === "undefined") {
    console.log("no tags found on the function");
    return false;
  }

  const specifiedTagsKvMapping = getSpecifiedTagsKvMapping(specifiedTags); // {"env": ["staging", "prod"], "team": ["serverless"]}

  for (const [tag, targetedTagsValues] of Object.entries(
    specifiedTagsKvMapping,
  )) {
    if (!Object.prototype.hasOwnProperty.call(targetFunctionTagsObj, tag)) {
      const message = `this function should NOT be remote instrumented by tagRule because it does not have ${tag} tag`;
      instrumentOutcome.instrument.failed[functionName] = {
        functionArn,
        reason: message,
      };
      logger.logInstrumentOutcome(
        INSTRUMENT,
        SKIPPED,
        functionName,
        functionArn,
        null,
        null,
        message,
      );
      return false;
    }

    // targeted functions should have tag value (e.g. staging) in the targeted tags values (e.g. [staging, prod])
    if (!targetedTagsValues.includes(targetFunctionTagsObj[tag])) {
      const message = `this function should NOT be remote instrumented by tagRule because value of tag ${tag} : ${targetFunctionTagsObj[tag]} is not in ${targetedTagsValues}`;
      instrumentOutcome.instrument.failed[functionName] = {
        functionArn,
        reason: message,
      };
      logger.logInstrumentOutcome(
        INSTRUMENT,
        SKIPPED,
        functionName,
        functionArn,
        null,
        null,
        message,
      );
      return false;
    }
  }
  console.log("this function should be remote instrumented by tags");
  return true;
}

async function getFunctionNamesFromResourceGroupsTaggingAPI(
  tagFilters,
  config,
) {
  const client = new ResourceGroupsTaggingAPIClient({
    region: config.AWS_REGION,
  });
  const input = {
    TagFilters: tagFilters,
    ResourceTypeFilters: ["lambda:function"],
  };
  const getResourcesCommand = new GetResourcesCommand(input);
  let getResourcesCommandOutput = { ResourceTagMappingList: [] };
  try {
    getResourcesCommandOutput = await client.send(getResourcesCommand);
  } catch (error) {
    console.error(
      `Error: ${error}. Returning empty array for instrumenting functions by tags`,
    );
    return [];
  }

  console.log(
    `api call output of getResourcesCommandOutput: ${JSON.stringify(getResourcesCommandOutput)}`,
  );
  const functionArns = [];
  for (const resourceTagMapping of getResourcesCommandOutput.ResourceTagMappingList) {
    functionArns.push(resourceTagMapping.ResourceARN);
  }
  console.log(`functionArns: ${functionArns}`);

  if (functionArns.length === 0) {
    return [];
  }

  const functionNames = [];
  for (const functionArn of functionArns) {
    if (typeof functionArn === "string") {
      functionNames.push(functionArn.split(":")[6]);
    }
  }
  if (functionNames.length === 0) {
    console.log(
      `No functions to be instrumented by specified tags ${JSON.stringify(tagFilters)}.`,
    );
    return [];
  }
  console.log(`=== functionNames: ${functionNames}`);
  return functionNames;
}

async function instrumentationByTagRule(config, instrumentOutcome) {
  const functionNames =
    await getFunctionNamesByTagRuleOrOtherFilteringTags(config);
  await instrumentByFunctionNames(functionNames, config, instrumentOutcome);
}

async function getFunctionNamesByTagRuleOrOtherFilteringTags(
  config,
  otherFilteringTags = {},
) {
  // this function either use config to get filters from tagRule or use otherFilteringTags = { "service": ["service1", "service2"] }
  let tagsKvMapping = {};
  if (Object.keys(otherFilteringTags).length === 0) {
    const specifiedTags = getTagRuleFromConfig(config); // tags: ['k1:v1', 'k2:v2']
    console.log(`specifiedTags: ${specifiedTags}`);
    if (specifiedTags === undefined || specifiedTags.length === 0) {
      return;
    }
    console.log(`RemoteInstrumentTagsFromEnvVar: ${specifiedTags}`);
    tagsKvMapping = getSpecifiedTagsKvMapping(specifiedTags);
  } else {
    tagsKvMapping = otherFilteringTags;
  }

  console.log(
    `After merging tagsKvMapping and additionalFilteringTags, tagsKvMapping is ${JSON.stringify(tagsKvMapping)}`,
  );

  const tagFilters = [];
  for (const [key, value] of Object.entries(tagsKvMapping)) {
    if (value.length > 0) {
      tagFilters.push({
        Key: key,
        Values: value,
      });
    } else {
      // API returns all resources with `Key` no matter what `Values` field is
      tagFilters.push({
        Key: key,
      });
    }
  }
  console.log(`tagFilters: ${JSON.stringify(tagFilters)}`);

  const functionNames = await getFunctionNamesFromResourceGroupsTaggingAPI(
    tagFilters,
    config,
  );
  return functionNames;
}

function getSpecifiedTagsKvMapping(specifiedTags) {
  // return e.g. {"env": ["staging", "prod"], "team": ["serverless"]}
  const tagsKvMapping = {}; // default dict of list to hold values of the same key
  for (const tag of specifiedTags) {
    const [k, v] = tag.split(":");
    if (!Object.prototype.hasOwnProperty.call(tagsKvMapping, k)) {
      tagsKvMapping[k] = [];
    }
    tagsKvMapping[k].push(v);
  }
  console.log(`tagKvMapping: ${JSON.stringify(tagsKvMapping)}`);
  return tagsKvMapping;
}

async function instrumentByFunctionNames(
  functionNames,
  config,
  instrumentOutcome,
) {
  if (config.DenyList === "*") {
    return;
  }
  if (typeof functionNames !== "object" || functionNames.length === 0) {
    console.log("functionNames is empty in instrumentByFunctionNames().");
    return;
  }
  const ddAwsAccountNumber = config.DD_AWS_ACCOUNT_NUMBER;

  const client = new LambdaClient({ region: config.AWS_REGION });
  const instrumentedFunctionArns = [];
  for (const functionName of functionNames) {
    logger.log(`processing ${functionName}`, functionName, null);
    // console.log(`processing ${functionName}`)

    // filter out functions that are on the DenyList
    if (config.DenyListFunctionNameSet.has(functionName)) {
      console.log(
        `function ${functionName} is on the DenyList ${JSON.stringify(config.DenyListFunctionNameSet)}`,
      );
      continue;
    }

    const params = {
      FunctionName: functionName,
    };
    const command = new GetFunctionCommand(params);

    try {
      // filter out already instrumented functions
      const getFunctionCommandOutput = await client.send(command);

      console.log(
        `function config is: ${JSON.stringify(getFunctionCommandOutput.Configuration)} \n`,
      );

      // instrument checks
      const layers = getFunctionCommandOutput.Configuration.Layers || [];
      const functionArn = `arn:aws:lambda:${config.AWS_REGION}:${ddAwsAccountNumber}:function:${functionName}`;
      logger.log("instrumentByFunctionNames", functionName, functionArn);
      const runtime = getFunctionCommandOutput.Configuration?.Runtime;
      if (runtime === undefined) {
        console.error(
          `Unexpected runtime: ${runtime} on getFunctionCommandOutput.Configuration?.Runtime`,
        );
      }

      // checking if is already instrumented correctly
      if (
        functionIsInstrumentedWithSpecifiedLayerVersions(
          layers,
          config,
          runtime,
        )
      ) {
        const reason = `Function ${functionName} is already instrumented with correct extension and tracer layer versions! `;
        logger.logInstrumentOutcome(
          INSTRUMENT,
          SKIPPED,
          functionName,
          functionArn,
          config.DD_LAYER_VERSIONS.extensionVersion,
          runtime,
          reason,
        );
        instrumentOutcome.instrument.skipped[functionName] = {
          functionArn,
          reason,
        };
        continue;
      }

      // memory size check
      const currentMemorySize =
        getFunctionCommandOutput.Configuration.MemorySize;
      if (currentMemorySize < parseInt(config.MinimumMemorySize)) {
        const message = `Current memory size ${currentMemorySize} MB is below threshold ${config.MinimumMemorySize} MB.`;
        instrumentOutcome.instrument.skipped[functionName] = {
          functionArn,
          reason: message,
        };
        logger.logInstrumentOutcome(
          INSTRUMENT,
          SKIPPED,
          functionName,
          functionArn,
          null,
          runtime,
          `Current memory size ${currentMemorySize} MB is below ${config.MinimumMemorySize} MB`,
        );
        continue;
      }

      await instrumentWithDatadogCi(
        instrumentOutcome,
        functionArn,
        false,
        runtime,
        config,
        instrumentedFunctionArns,
      );
    } catch (error) {
      console.log(
        `Error is caught for functionName ${functionName}. Skipping instrumenting this function. Error is: ${error}`,
      );
    }
  }

  await tagResourcesWithSlsTag(instrumentedFunctionArns, config);
}

async function instrumentWithDatadogCi(
  instrumentOutcome,
  functionArn,
  uninstrument = false,
  runtime = NODE,
  config,
  operatedFunctionArns,
) {
  console.log(
    `instrumentWithDatadogCi, functionArns: ${operatedFunctionArns} , uninstrument: ${uninstrument}`,
  );

  const functionName = functionArn.split(":")[6];

  // skip instrumenter function
  if (functionName === process.env.DD_INSTRUMENTER_FUNCTION_NAME) {
    console.info(
      `Skipping instrumenting ${functionName} since it is the remote instrumenter function.`,
    );
    return;
  }

  // filter out functions that are on the DenyList
  if (
    uninstrument === false &&
    config.DenyListFunctionNameSet.has(functionName)
  ) {
    logger.debugLogs(
      "Instrument",
      DENIED,
      functionName,
      `function ${functionName} will not be instrumented because it is in the DenyList ${JSON.stringify(config.DenyListFunctionNameSet)}. Instrumentation stopped for this function.`,
    );
    return;
  }

  const cli = datadogCi.cli;
  const layerVersionObj = await getLayerAndRuntimeVersion(runtime, config);

  let command;
  if (uninstrument === false) {
    logger.logInstrumentOutcome(
      INSTRUMENT,
      IN_PROGRESS,
      functionName,
      functionArn,
      layerVersionObj.extensionVersion,
      runtime,
    );
    command = [
      "lambda",
      "instrument",
      "-f",
      functionArn,
      "-v",
      layerVersionObj.runtimeLayerVersion,
      "-e",
      layerVersionObj.extensionVersion,
    ];
  } else {
    logger.logInstrumentOutcome(
      UNINSTRUMENT,
      IN_PROGRESS,
      functionName,
      functionArn,
      layerVersionObj.extensionVersion,
      runtime,
    );
    command = [
      "lambda",
      "uninstrument",
      "-f",
      functionArn,
      "-r",
      config.AWS_REGION,
    ];
  }
  console.log(`datadog-ci command: ${JSON.stringify(command)}`);

  const commandExitCode = await cli.run(command);

  if (commandExitCode === 0) {
    if (uninstrument === true) {
      logger.logInstrumentOutcome(
        UNINSTRUMENT,
        SUCCEEDED,
        functionName,
        functionArn,
        layerVersionObj.extensionVersion,
        runtime,
      );
      instrumentOutcome.uninstrument[SUCCEEDED][functionName] = { functionArn };
    } else {
      logger.logInstrumentOutcome(
        INSTRUMENT,
        SUCCEEDED,
        functionName,
        functionArn,
        layerVersionObj.extensionVersion,
        runtime,
      );
      instrumentOutcome.instrument[SUCCEEDED][functionName] = { functionArn };
    }
    operatedFunctionArns.push(functionArn);
    console.log(
      `operatedFunctionArns: ${JSON.stringify(operatedFunctionArns)}`,
    );
  } else {
    if (uninstrument === true) {
      logger.logInstrumentOutcome(
        UNINSTRUMENT,
        FAILED,
        functionName,
        functionArn,
        layerVersionObj.extensionVersion,
        runtime,
      );
      instrumentOutcome.uninstrument[FAILED][functionName] = { functionArn };
    } else {
      logger.logInstrumentOutcome(
        INSTRUMENT,
        FAILED,
        functionName,
        functionArn,
        layerVersionObj.extensionVersion,
        runtime,
      );
      instrumentOutcome.instrument[FAILED][functionName] = { functionArn };
    }
  }
}

async function tagResourcesWithSlsTag(functionArns, config) {
  console.log(`functionArns to tag: ${functionArns}`);
  if (functionArns.length === 0) {
    return;
  }
  console.log(`version: ${DD_SLS_REMOTE_INSTRUMENTER_VERSION}:v${VERSION}`);

  const client = new ResourceGroupsTaggingAPIClient({
    region: config.AWS_REGION,
  });
  const input = {
    ResourceARNList: functionArns,
    Tags: { [DD_SLS_REMOTE_INSTRUMENTER_VERSION]: `v${VERSION}` }, // use [] to specify KEY is a variable
  };
  const tagResourcesCommand = new TagResourcesCommand(input);
  try {
    const tagResourcesCommandOutput = await client.send(tagResourcesCommand);
    console.log(
      `tagResourcesCommandOutput: ${JSON.stringify(tagResourcesCommandOutput)}`,
    );
  } catch (error) {
    console.error(`error: ${error.toString()} when tagging resources`);
  }
}

async function untagResourcesOfSlsTag(functionArns, config) {
  console.log(`functionArns to untag: ${functionArns}`);
  if (functionArns.length === 0) {
    return;
  }

  const client = new ResourceGroupsTaggingAPIClient({
    region: config.AWS_REGION,
  });
  const input = {
    ResourceARNList: functionArns,
    TagKeys: [DD_SLS_REMOTE_INSTRUMENTER_VERSION],
  };
  const untagResourcesCommand = new UntagResourcesCommand(input);
  try {
    const untagResourcesCommandOutput = await client.send(
      untagResourcesCommand,
    );
    console.log(
      `untagResourcesCommandOutput: ${JSON.stringify(untagResourcesCommandOutput)}`,
    );
  } catch (error) {
    console.error(`Error removing tags:`, error);
  }
}

function functionIsInstrumentedWithSpecifiedLayerVersions(
  layers,
  config,
  targetLambdaRuntime,
) {
  if (layers.length === 0) {
    return false;
  }

  // check the extension
  let targetLambdaExtensionLayerVersion = "-1";
  for (const layer of layers) {
    if (layer?.Arn?.includes("464622532012:layer:Datadog-Extension")) {
      targetLambdaExtensionLayerVersion = layer.Arn.split(":").at(-1);
      break;
    }
  }

  if (
    targetLambdaExtensionLayerVersion !==
    config.DD_LAYER_VERSIONS.extensionVersion
  ) {
    return false;
  }

  for (const layer of layers) {
    console.log(`\n runtime layer: ${JSON.stringify(layer)}`);
    if (layer?.Arn?.includes("464622532012:layer")) {
      // Datadog Layer
      if (
        layer.Arn.includes("464622532012:layer:Datadog-Python") &&
        targetLambdaRuntime.toLowerCase().includes("python")
      ) {
        return (
          layer.Arn.split(":").at(-1) ===
          config.DD_LAYER_VERSIONS.pythonLayerVersion
        );
      } else if (
        layer.Arn.includes("464622532012:layer:Datadog-Node") &&
        targetLambdaRuntime.toLowerCase().includes("node")
      ) {
        return (
          layer.Arn.split(":").at(-1) ===
          config.DD_LAYER_VERSIONS.nodeLayerVersion
        );
      }
    }
  }
  return true;
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
  }

  // if config failed to get from s3, use default
  if (result.extensionVersion === undefined) {
    result.extensionVersion = "53";
  }
  if (result.runtimeLayerVersion === undefined) {
    if (runtime.includes(NODE)) {
      result.runtimeLayerVersion = "98";
    } else if (runtime.includes(PYTHON)) {
      result.runtimeLayerVersion = "80";
    }
  }
  return result;
}

function getVersionFromLayerArn(jsonData, fieldToParse) {
  if (Object.prototype.hasOwnProperty.call(jsonData, fieldToParse)) {
    const parsedField = jsonData[fieldToParse];
    const arnSplitList = parsedField.split(":");
    return arnSplitList[arnSplitList.length - 1];
  }
  console.error(`${fieldToParse} is not a property of ${jsonData}`);
}

async function getLatestLayersFromS3() {
  const layerURL =
    "https://datadog-sls-layer-versions.s3.sa-east-1.amazonaws.com/latest.json";
  try {
    return await axios.get(layerURL);
  } catch (error) {
    console.error(error);
  }
}

class Logger {
  emitFrontEndEvent(ddSlsEventName, triggeredBy, instrumentOutcome, config) {
    console.log(
      JSON.stringify({
        ddSlsEventName,
        triggeredBy,
        outcome: instrumentOutcome,
        allowList: config.AllowList,
        denyList: config.DenyList,
        tagRule: config.TagRule,
      }),
    );
  }

  log(message, targetFunctionName = null, targetFunctionArn = null) {
    const logEntry = {
      message,
      targetFunctionName: targetFunctionName,
      targetFunctionArn: targetFunctionArn,
    };
    console.log(JSON.stringify(logEntry));
  }

  logInstrumentOutcome(
    ddSlsEventName,
    outcome,
    targetFunctionName = null,
    targetFunctionArn = null,
    expectedExtensionVersion = null,
    runtime = null,
    reason = null,
  ) {
    console.log(
      JSON.stringify({
        ddSlsEventName,
        outcome,
        targetFunctionName: targetFunctionName,
        targetFunctionArn: targetFunctionArn,
        expectedExtensionVersion,
        runtime,
        reason,
      }),
    );
  }

  debugLogs(ddSlsEventName, outcome, targetFunctionName, message = null) {
    console.log(
      JSON.stringify({
        ddSlsEventName,
        outcome,
        targetFunctionName: targetFunctionName,
        message,
      }),
    );
  }

  logObject(event) {
    console.log(JSON.stringify(event));
  }
}

const logger = new Logger();
