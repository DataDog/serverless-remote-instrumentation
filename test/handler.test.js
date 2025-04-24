const handler = require("../src/handler");
const functions = require("../src/functions");
const config = require("../src/config");
const lambdaEvent = require("../src/lambda-event");
const instrument = require("../src/instrument");
const errorStorage = require("../src/error-storage");
const { LAMBDA_EVENT } = require("../src/consts");
const cfnResponse = require("cfn-response");
const { baseConfigCache } = require("./test-utils");
jest.mock("../src/lambda-event");
jest.mock("../src/config");
jest.mock("../src/functions");
jest.mock("../src/instrument");
jest.mock("../src/error-storage");
jest.mock("cfn-response");

describe("handler lambda management events", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("Happy path", async () => {
    const event = {
      "detail-type": "AWS API Call via CloudTrail",
      source: "aws.lambda",
    };
    const context = "context";

    const lambdaFunction = { test: "VALUE" };
    lambdaEvent.getFunctionFromLambdaEvent.mockReturnValue(lambdaFunction);
    lambdaEvent.isLambdaManagementEvent.mockReturnValue(true);

    const enrichedFunction = { hello: "World!" };
    functions.enrichFunctionsWithTags.mockReturnValue(enrichedFunction);

    const configsResult = ["a"];
    config.getConfigs.mockReturnValue(configsResult);
    instrument.instrumentFunctions.mockReturnValue(true);

    await handler.handler(event, context);

    expect(lambdaEvent.getFunctionFromLambdaEvent).toHaveBeenCalledWith(
      expect.anything(),
      event,
    );
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      [lambdaFunction],
    );
    expect(config.getConfigs).toHaveBeenCalledWith(
      expect.anything(),
      context,
      baseConfigCache,
    );
    expect(instrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      configsResult,
      enrichedFunction,
      expect.anything(),
      expect.anything(),
      LAMBDA_EVENT,
    );
    expect(errorStorage.putError).not.toHaveBeenCalled();
  });

  test("Calls putError when getting remote config fails", async () => {
    const event = {
      "detail-type": "AWS API Call via CloudTrail",
      source: "aws.lambda",
    };
    const context = "context";

    const lambdaFunction = { FunctionName: "TestFunction" };
    lambdaEvent.getFunctionFromLambdaEvent.mockReturnValue(lambdaFunction);
    lambdaEvent.isLambdaManagementEvent.mockReturnValue(true);

    const enrichedFunction = { hello: "World!" };
    functions.enrichFunctionsWithTags.mockReturnValue(enrichedFunction);

    const error = () => {
      throw new Error("ERROR!");
    };
    config.getConfigs.mockImplementation(error);
    instrument.instrumentFunctions.mockReturnValue(true);

    await expect(handler.handler(event, context)).rejects.toThrow("ERROR!");

    expect(lambdaEvent.getFunctionFromLambdaEvent).toHaveBeenCalledWith(
      expect.anything(),
      event,
    );
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      [lambdaFunction],
    );
    expect(config.getConfigs).toHaveBeenCalledWith(
      expect.anything(),
      context,
      baseConfigCache,
    );
    expect(instrument.instrumentFunctions).not.toHaveBeenCalled();
    expect(errorStorage.putError).toHaveBeenCalledWith(
      expect.anything(),
      "TestFunction",
      expect.anything(),
    );
  });
});

describe("scheduled invocation events", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("Loads errors from s3", async () => {
    const event = {
      "event-type": "Scheduled Instrumenter Invocation",
    };
    const context = "context";
    const configsResult = ["a"];

    lambdaEvent.isScheduledInvocationEvent.mockReturnValue(true);
    config.getConfigs.mockReturnValue(configsResult);
    config.configHasChanged.mockReturnValue(false);
    errorStorage.listErrors.mockReturnValue(["function1", "function2"]);
    errorStorage.putError.mockReturnValue(true);
    errorStorage.deleteError.mockReturnValue(true);
    instrument.instrumentFunctions.mockReturnValue(true);
    functions.getLambdaFunction.mockReturnValue({
      Configuration: { key: "configuration" },
      Tags: "tags",
    });
    functions.enrichFunctionsWithTags.mockReturnValue("A");
    errorStorage.identifyNewErrorsAndResolvedErrors.mockReturnValue({
      newErrors: [{ functionName: "name", reason: "reason" }],
      resolvedErrors: ["error!"],
    });

    await handler.handler(event, context);

    expect(errorStorage.listErrors).toHaveBeenCalledTimes(1);
    expect(functions.getLambdaFunction).toHaveBeenCalledTimes(2);
    expect(functions.getLambdaFunction).toHaveBeenCalledWith(
      expect.anything(),
      "function1",
    );
    expect(functions.getLambdaFunction).toHaveBeenCalledWith(
      expect.anything(),
      "function2",
    );
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledTimes(1);
    expect(instrument.instrumentFunctions).toHaveBeenCalledTimes(1);
    expect(instrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      configsResult,
      "A",
      expect.anything(),
      expect.anything(),
    );
    expect(errorStorage.putError).toHaveBeenCalledTimes(1);
    expect(errorStorage.putError).toHaveBeenCalledWith(
      expect.anything(),
      "name",
      "reason",
    );
    expect(errorStorage.deleteError).toHaveBeenCalledTimes(1);
    expect(errorStorage.deleteError).toHaveBeenCalledWith(
      expect.anything(),
      "error!",
    );
  });
});

describe("stack delete events", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("successfully uninstruments and calls back with success", async () => {
    const event = {
      RequestType: "Delete",
      ResponseURL: "url",
      ResourceType: "AWS::CloudFormation::CustomResource",
      StackId: "fakeStackId",
      PhysicalResourceId: "fakePhysicalResourceId",
      RequestId: "fakeRequestId",
    };
    const context = "context";

    lambdaEvent.isStackDeletedEvent.mockReturnValue(true);
    functions.getAllFunctions.mockReturnValue("getAllFunctionsRV");
    functions.enrichFunctionsWithTags.mockReturnValue(
      "enrichFunctionsWithTagsRV",
    );
    instrument.instrumentFunctions.mockImplementation(
      (a, b, c, outcome) => (outcome.uninstrument.succeeded.test = "1"),
    );
    cfnResponse.send.mockReturnValue(true);

    const res = await handler.handler(event, context);

    expect(functions.getAllFunctions).toHaveBeenCalledTimes(1);
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledTimes(1);
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      "getAllFunctionsRV",
    );
    expect(instrument.instrumentFunctions).toHaveBeenCalledTimes(1);
    expect(instrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      [],
      "enrichFunctionsWithTagsRV",
      expect.anything(),
      expect.anything(),
      "CloudformationDeleteEvent",
    );
    expect(cfnResponse.send).toHaveBeenCalledTimes(1);
    expect(cfnResponse.send).toHaveBeenCalledWith(event, context, "SUCCESS");
    expect(res.uninstrument.succeeded.test).toStrictEqual("1");
  });

  test("fails to uninstrument and calls back with fail", async () => {
    const event = {
      RequestType: "Delete",
      ResponseURL: "url",
      ResourceType: "AWS::CloudFormation::CustomResource",
      StackId: "fakeStackId",
      PhysicalResourceId: "fakePhysicalResourceId",
      RequestId: "fakeRequestId",
    };
    const context = "context";

    lambdaEvent.isStackDeletedEvent.mockReturnValue(true);
    functions.getAllFunctions.mockReturnValue("getAllFunctionsRV");
    functions.enrichFunctionsWithTags.mockReturnValue(
      "enrichFunctionsWithTagsRV",
    );
    instrument.instrumentFunctions.mockImplementation(
      (a, b, c, outcome) => (outcome.uninstrument.failed.test = "1"),
    );
    cfnResponse.send.mockReturnValue(true);

    const res = await handler.handler(event, context);

    expect(functions.getAllFunctions).toHaveBeenCalledTimes(1);
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledTimes(1);
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      "getAllFunctionsRV",
    );
    expect(instrument.instrumentFunctions).toHaveBeenCalledTimes(1);
    expect(instrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      [],
      "enrichFunctionsWithTagsRV",
      expect.anything(),
      expect.anything(),
      "CloudformationDeleteEvent",
    );
    expect(cfnResponse.send).toHaveBeenCalledTimes(1);
    expect(cfnResponse.send).toHaveBeenCalledWith(event, context, "FAILED", {
      failed: ["test"],
    });
    expect(res.uninstrument.failed.test).toStrictEqual("1");
  });
});

describe("stack create events", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("successfully instruments and calls back with success", async () => {
    const event = {
      RequestType: "Create",
      ResponseURL: "url",
      ResourceType: "AWS::CloudFormation::CustomResource",
      StackId: "fakeStackId",
      PhysicalResourceId: "fakePhysicalResourceId",
      RequestId: "fakeRequestId",
    };
    const context = "context";

    lambdaEvent.isStackCreatedEvent.mockReturnValue(true);
    const configsResult = ["configs"];
    config.getConfigs.mockReturnValue(configsResult);
    functions.getAllFunctions.mockReturnValue("getAllFunctionsRV");
    functions.enrichFunctionsWithTags.mockReturnValue(
      "enrichFunctionsWithTagsRV",
    );
    instrument.instrumentFunctions.mockImplementation(
      (a, b, c, outcome) => (outcome.instrument.succeeded.test = "1"),
    );
    cfnResponse.send.mockReturnValue(true);

    const res = await handler.handler(event, context);

    expect(functions.getAllFunctions).toHaveBeenCalledTimes(1);
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledTimes(1);
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      "getAllFunctionsRV",
    );
    expect(instrument.instrumentFunctions).toHaveBeenCalledTimes(1);
    expect(instrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      ["configs"],
      "enrichFunctionsWithTagsRV",
      expect.anything(),
      expect.anything(),
      "CloudformationCreateEvent",
    );
    expect(cfnResponse.send).toHaveBeenCalledTimes(1);
    expect(cfnResponse.send).toHaveBeenCalledWith(event, context, "SUCCESS");
    expect(res.instrument.succeeded.test).toStrictEqual("1");
  });

  test("throwing an error should still result in SUCCESS being sent", async () => {
    const event = {
      RequestType: "Create",
      ResponseURL: "url",
      ResourceType: "AWS::CloudFormation::CustomResource",
      StackId: "fakeStackId",
      PhysicalResourceId: "fakePhysicalResourceId",
      RequestId: "fakeRequestId",
    };
    const context = "context";

    lambdaEvent.isStackCreatedEvent.mockReturnValue(true);
    config.getConfigs.mockImplementation(() => {
      throw new Error();
    });

    await handler.handler(event, context);

    expect(cfnResponse.send).toHaveBeenCalledTimes(1);
    expect(cfnResponse.send).toHaveBeenCalledWith(event, context, "SUCCESS");
  });
});
