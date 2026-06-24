import { describe, test, expect, beforeEach, vi } from "vitest";

const cfnResponseMock = vi.hoisted(() => ({
  send: vi.fn(),
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
}));

vi.mock("module", async (importOriginal) => {
  const original = await importOriginal<typeof import("module")>();
  return {
    ...original,
    createRequire: (url: string | URL) => {
      const realRequire = original.createRequire(url);
      return (id: string) => {
        if (id === "cfn-response") return cfnResponseMock;
        return realRequire(id);
      };
    },
  };
});

vi.mock("@datadog/datadog-ci-plugin-lambda/functions/instrument", () => ({
  getInstrumentedFunctionConfig: vi.fn(),
}));

vi.mock("@datadog/datadog-ci-plugin-lambda/functions/uninstrument", () => ({
  getUninstrumentedFunctionConfig: vi.fn(),
}));

vi.mock("@datadog/datadog-ci-plugin-lambda/functions/commons", () => ({
  updateFunctionConfiguration: vi.fn(),
}));

import * as handler from "../src/handler";
import * as functions from "../src/functions";
import * as config from "../src/config";
import * as lambdaEvent from "../src/lambda-event";
import * as instrument from "../src/instrument";
import * as errorStorage from "../src/error-storage";
import { LAMBDA_EVENT } from "../src/consts";
import type { InstrumenterEvent } from "../src/lambda-event";
import type { Context } from "aws-lambda";

vi.mock("../src/lambda-event");
vi.mock("../src/config");
vi.mock("../src/functions");
vi.mock("../src/instrument");
vi.mock("../src/error-storage");

const mockedLambdaEvent = lambdaEvent as any;
const mockedFunctions = functions as any;
const mockedConfig = config as any;
const mockedInstrument = instrument as any;
const mockedErrorStorage = errorStorage as any;
const mockedCfnResponse = cfnResponseMock;

describe("handler lambda management events", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("Happy path", async () => {
    const event = {
      "detail-type": "AWS API Call via CloudTrail",
      source: "aws.lambda",
    };
    const context = "context";

    const lambdaFunction = { test: "VALUE" };
    mockedLambdaEvent.getFunctionFromLambdaEvent.mockResolvedValue(
      lambdaFunction,
    );
    mockedLambdaEvent.isLambdaManagementEvent.mockResolvedValue(true);

    const enrichedFunction = { hello: "World!" };
    mockedFunctions.enrichFunctionsWithTags.mockResolvedValue(
      enrichedFunction as any,
    );

    const configsResult = ["a"] as any;
    mockedConfig.getConfigsWithRetry.mockResolvedValue({
      configs: configsResult,
      configChanged: true,
    });
    mockedInstrument.instrumentFunctions.mockResolvedValue(true as any);

    await handler.handler(
      event as InstrumenterEvent,
      context as unknown as Context,
    );

    expect(mockedLambdaEvent.getFunctionFromLambdaEvent).toHaveBeenCalledWith(
      expect.anything(),
      event,
    );
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      [lambdaFunction],
    );
    expect(mockedConfig.getConfigsWithRetry).toHaveBeenCalledWith(
      expect.anything(),
      context,
    );
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      configsResult,
      enrichedFunction,
      expect.anything(),
      expect.anything(),
      LAMBDA_EVENT,
      undefined,
    );
    expect(mockedErrorStorage.putError).not.toHaveBeenCalled();
  });

  test("Calls putError when getting remote config fails", async () => {
    const event = {
      "detail-type": "AWS API Call via CloudTrail",
      source: "aws.lambda",
    };
    const context = "context";

    const lambdaFunction = { FunctionName: "TestFunction" };
    mockedLambdaEvent.getFunctionFromLambdaEvent.mockResolvedValue(
      lambdaFunction,
    );
    mockedLambdaEvent.isLambdaManagementEvent.mockResolvedValue(true);

    const enrichedFunction = { hello: "World!" };
    mockedFunctions.enrichFunctionsWithTags.mockResolvedValue(enrichedFunction);

    const error = () => {
      throw new Error("ERROR!");
    };
    mockedConfig.getConfigsWithRetry.mockImplementation(error);
    mockedInstrument.instrumentFunctions.mockResolvedValue(true);

    await expect(
      handler.handler(
        event as InstrumenterEvent,
        context as unknown as Context,
      ),
    ).rejects.toThrow("ERROR!");

    expect(mockedLambdaEvent.getFunctionFromLambdaEvent).toHaveBeenCalledWith(
      expect.anything(),
      event,
    );
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      [lambdaFunction],
    );
    expect(mockedConfig.getConfigsWithRetry).toHaveBeenCalledWith(
      expect.anything(),
      context,
    );
    expect(mockedInstrument.instrumentFunctions).not.toHaveBeenCalled();
    expect(mockedErrorStorage.putError).toHaveBeenCalledWith(
      expect.anything(),
      "TestFunction",
      expect.anything(),
    );
  });
});

describe("scheduled invocation events", () => {
  const event = {
    "event-type": "Scheduled Instrumenter Invocation",
  };
  const context = "context";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("Loads errors from s3", async () => {
    const configsResult = ["a"];

    mockedLambdaEvent.isScheduledInvocationEvent.mockResolvedValue(true);
    mockedConfig.getConfigsWithRetry.mockResolvedValue({
      configs: configsResult,
      configChanged: false,
    });
    mockedConfig.configHasChanged.mockResolvedValue(false);
    mockedErrorStorage.listErrors.mockResolvedValue(["function1", "function2"]);
    mockedErrorStorage.putError.mockResolvedValue(true);
    mockedErrorStorage.deleteError.mockResolvedValue(true);
    mockedInstrument.instrumentFunctions.mockResolvedValue(true);
    mockedFunctions.getLambdaFunction.mockResolvedValue({
      Configuration: { key: "configuration" },
      Tags: "tags",
    });
    mockedFunctions.enrichFunctionsWithTags.mockResolvedValue("A");
    mockedErrorStorage.identifyNewErrorsAndResolvedErrors.mockReturnValue({
      newErrors: [{ functionName: "name", reason: "reason" }],
      resolvedErrors: ["error!"],
    });

    await handler.handler(
      event as InstrumenterEvent,
      context as unknown as Context,
    );

    expect(mockedErrorStorage.listErrors).toHaveBeenCalledTimes(1);
    expect(mockedFunctions.getLambdaFunction).toHaveBeenCalledTimes(2);
    expect(mockedFunctions.getLambdaFunction).toHaveBeenCalledWith(
      expect.anything(),
      "function1",
    );
    expect(mockedFunctions.getLambdaFunction).toHaveBeenCalledWith(
      expect.anything(),
      "function2",
    );
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledTimes(1);
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledTimes(1);
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      configsResult,
      "A",
      expect.anything(),
      expect.anything(),
      undefined,
      undefined,
    );
    expect(mockedErrorStorage.putError).toHaveBeenCalledTimes(1);
    expect(mockedErrorStorage.putError).toHaveBeenCalledWith(
      expect.anything(),
      "name",
      "reason",
    );
    expect(mockedErrorStorage.deleteError).toHaveBeenCalledTimes(1);
    expect(mockedErrorStorage.deleteError).toHaveBeenCalledWith(
      expect.anything(),
      "error!",
    );
  });

  test("happy path", async () => {
    const allFunctions = [{ FunctionName: "function1" }];

    mockedLambdaEvent.isScheduledInvocationEvent.mockResolvedValue(true);
    mockedConfig.getConfigsWithRetry.mockResolvedValue({
      configs: ["a"],
      configChanged: true,
    });
    mockedConfig.deleteConfigHash.mockResolvedValue(true);
    mockedErrorStorage.listErrors.mockResolvedValue([]);
    mockedFunctions.getAllFunctions.mockResolvedValue(allFunctions);
    mockedFunctions.enrichFunctionsWithTags.mockResolvedValue(
      "enrichedFunctions",
    );
    mockedInstrument.instrumentFunctions.mockResolvedValue(true);
    mockedConfig.updateConfigHash.mockResolvedValue(true);
    mockedErrorStorage.identifyNewErrorsAndResolvedErrors.mockReturnValue({
      newErrors: [],
      resolvedErrors: [],
    });

    await handler.handler(
      event as InstrumenterEvent,
      context as unknown as Context,
    );

    expect(mockedConfig.getConfigsWithRetry).toHaveBeenCalledTimes(1);
    expect(mockedConfig.deleteConfigHash).toHaveBeenCalledTimes(1);
    expect(mockedErrorStorage.listErrors).toHaveBeenCalledTimes(1);
    expect(mockedFunctions.getAllFunctions).toHaveBeenCalledTimes(1);
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledTimes(1);
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledTimes(1);
    expect(mockedConfig.updateConfigHash).toHaveBeenCalledTimes(1);
  });
});

describe("stack delete events", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

    mockedLambdaEvent.isStackDeletedEvent.mockResolvedValue(true);
    mockedFunctions.getAllFunctions.mockResolvedValue("getAllFunctionsRV");
    mockedFunctions.enrichFunctionsWithTags.mockResolvedValue(
      "enrichFunctionsWithTagsRV",
    );
    mockedInstrument.instrumentFunctions.mockImplementation(
      (a: any, b: any, c: any, outcome: any) =>
        (outcome.uninstrument.succeeded.test = "1"),
    );
    mockedCfnResponse.send.mockResolvedValue(true);

    const res = await handler.handler(
      event as unknown as InstrumenterEvent,
      context as unknown as Context,
    );

    expect(mockedFunctions.getAllFunctions).toHaveBeenCalledTimes(1);
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledTimes(1);
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      "getAllFunctionsRV",
    );
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledTimes(1);
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      [],
      "enrichFunctionsWithTagsRV",
      expect.anything(),
      expect.anything(),
      "CloudformationDeleteEvent",
      undefined,
    );
    expect(mockedCfnResponse.send).toHaveBeenCalledTimes(1);
    expect(mockedCfnResponse.send).toHaveBeenCalledWith(
      event,
      context,
      "SUCCESS",
    );
    expect(res.uninstrument.succeeded.test).toStrictEqual("1");
    expect(mockedErrorStorage.emptyBucket).toHaveBeenCalledTimes(1);
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

    mockedLambdaEvent.isStackDeletedEvent.mockResolvedValue(true);
    mockedFunctions.getAllFunctions.mockResolvedValue("getAllFunctionsRV");
    mockedFunctions.enrichFunctionsWithTags.mockResolvedValue(
      "enrichFunctionsWithTagsRV",
    );
    mockedInstrument.instrumentFunctions.mockImplementation(
      (a: any, b: any, c: any, outcome: any) =>
        (outcome.uninstrument.failed.test = "1"),
    );
    mockedCfnResponse.send.mockResolvedValue(true);

    const res = await handler.handler(
      event as unknown as InstrumenterEvent,
      context as unknown as Context,
    );

    expect(mockedFunctions.getAllFunctions).toHaveBeenCalledTimes(1);
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledTimes(1);
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      "getAllFunctionsRV",
    );
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledTimes(1);
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      [],
      "enrichFunctionsWithTagsRV",
      expect.anything(),
      expect.anything(),
      "CloudformationDeleteEvent",
      undefined,
    );
    expect(mockedCfnResponse.send).toHaveBeenCalledTimes(1);
    expect(mockedCfnResponse.send).toHaveBeenCalledWith(
      event,
      context,
      "FAILED",
      {
        failed: ["test"],
      },
    );
    expect(res.uninstrument.failed.test).toStrictEqual("1");
  });
});

describe("stack create events", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

    mockedLambdaEvent.isStackCreatedEvent.mockResolvedValue(true);
    const configsResult = ["configs"];
    mockedConfig.getConfigsWithRetry.mockResolvedValue({
      configs: configsResult,
      configChanged: true,
    });
    mockedFunctions.getAllFunctions.mockResolvedValue("getAllFunctionsRV");
    mockedFunctions.enrichFunctionsWithTags.mockResolvedValue(
      "enrichFunctionsWithTagsRV",
    );
    mockedInstrument.instrumentFunctions.mockImplementation(
      (a: any, b: any, c: any, outcome: any) =>
        (outcome.instrument.succeeded.test = "1"),
    );
    mockedCfnResponse.send.mockResolvedValue(true);

    const res = await handler.handler(
      event as unknown as InstrumenterEvent,
      context as unknown as Context,
    );

    expect(mockedFunctions.getAllFunctions).toHaveBeenCalledTimes(1);
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledTimes(1);
    expect(mockedFunctions.enrichFunctionsWithTags).toHaveBeenCalledWith(
      expect.anything(),
      "getAllFunctionsRV",
    );
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledTimes(1);
    expect(mockedInstrument.instrumentFunctions).toHaveBeenCalledWith(
      expect.anything(),
      ["configs"],
      "enrichFunctionsWithTagsRV",
      expect.anything(),
      expect.anything(),
      "CloudformationCreateEvent",
      undefined,
    );
    expect(mockedCfnResponse.send).toHaveBeenCalledTimes(1);
    expect(mockedCfnResponse.send).toHaveBeenCalledWith(
      event,
      context,
      "SUCCESS",
    );
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

    mockedLambdaEvent.isStackCreatedEvent.mockResolvedValue(true);
    mockedConfig.getConfigsWithRetry.mockImplementation(() => {
      throw new Error();
    });

    await handler.handler(
      event as unknown as InstrumenterEvent,
      context as unknown as Context,
    );

    expect(mockedCfnResponse.send).toHaveBeenCalledTimes(1);
    expect(mockedCfnResponse.send).toHaveBeenCalledWith(
      event,
      context,
      "SUCCESS",
    );
  });
});
