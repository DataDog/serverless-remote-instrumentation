const handler = require("../src/handler");
const functions = require("../src/functions");
const config = require("../src/config");
const lambdaEvent = require("../src/lambda-event");
const instrument = require("../src/instrument");
const errorStorage = require("../src/error-storage");
const { LAMBDA_EVENT } = require("../src/consts");

jest.mock("../src/lambda-event");
jest.mock("../src/config");
jest.mock("../src/functions");
jest.mock("../src/instrument");
jest.mock("../src/error-storage")

describe("handler lambda management events", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("Happy path", async () => {
    const event = {
      "detail-type": "AWS API Call via CloudTrail",
      source: "aws.lambda",
    };
    const context = 'context';

    const lambdaFunction = {test: 'VALUE'};
    lambdaEvent.getFunctionFromLambdaEvent.mockReturnValue(lambdaFunction);
    lambdaEvent.isLambdaManagementEvent.mockReturnValue(true);
   
    const enrichedFunction = {hello: "World!"};
    functions.enrichFunctionsWithTags.mockReturnValue(enrichedFunction);

    const configsResult = ['a'];
    config.getConfigs.mockReturnValue(configsResult);
    instrument.instrumentFunctions.mockReturnValue(true);

    await handler.handler(event, context);

    expect(lambdaEvent.getFunctionFromLambdaEvent).toHaveBeenCalledWith(expect.anything(), event);
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledWith(expect.anything(), [lambdaFunction]);
    expect(config.getConfigs).toHaveBeenCalledWith(context);
    expect(instrument.instrumentFunctions).toHaveBeenCalledWith(configsResult, enrichedFunction, expect.anything(), expect.anything(), LAMBDA_EVENT);
    expect(errorStorage.putError).not.toHaveBeenCalled();
  });

  test("Calls putError when getting remote config fails", async () => {
    const event = {
      "detail-type": "AWS API Call via CloudTrail",
      source: "aws.lambda",
    };
    const context = 'context';

    const lambdaFunction = {FunctionName: 'TestFunction'};
    lambdaEvent.getFunctionFromLambdaEvent.mockReturnValue(lambdaFunction);
    lambdaEvent.isLambdaManagementEvent.mockReturnValue(true);
   
    const enrichedFunction = {hello: "World!"};
    functions.enrichFunctionsWithTags.mockReturnValue(enrichedFunction);

    const error = () => {throw new Error("ERROR!")};
    config.getConfigs.mockImplementation(error);
    instrument.instrumentFunctions.mockReturnValue(true);

    await expect(handler.handler(event, context)).rejects.toThrow("ERROR!");

    expect(lambdaEvent.getFunctionFromLambdaEvent).toHaveBeenCalledWith(expect.anything(), event);
    expect(functions.enrichFunctionsWithTags).toHaveBeenCalledWith(expect.anything(), [lambdaFunction]);
    expect(config.getConfigs).toHaveBeenCalledWith(context);
    expect(instrument.instrumentFunctions).not.toHaveBeenCalled();
    expect(errorStorage.putError).toHaveBeenCalledWith(expect.anything(), 'TestFunction', expect.anything());
  });
});