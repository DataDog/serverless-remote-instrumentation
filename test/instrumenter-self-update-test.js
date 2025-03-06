const { updateInstrumenterDDTags } = require("../src/instrumenter-self-update");
const functions = require("../src/functions");

jest.mock("../src/functions");
const mockClient = {
  send: jest.fn(),
};
describe("updateInstrumenterDDTags", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });
  test("should update the instrumenter function's DD_TAGS environment variable if layer has changed", async () => {
    functions.getLambdaFunction.mockReturnValue({
      Configuration: {
        Layers: [
          {
            Arn: "arn:aws:lambda:ap-south-1:464622532012:layer:Datadog-Serverless-Remote-Instrumentation-ARM:2",
          },
        ],
        Environment: {
          Variables: {
            DD_TAGS: "instrumenter_layer_version:1",
          },
        },
      },
    });
    await updateInstrumenterDDTags(mockClient);
    expect(mockClient.send).toHaveBeenCalledTimes(1);
  });

  test("should return early if layer has not changed", async () => {
    functions.getLambdaFunction.mockReturnValue({
      Configuration: {
        Layers: [
          {
            Arn: "arn:aws:lambda:ap-south-1:464622532012:layer:Datadog-Serverless-Remote-Instrumentation-ARM:2",
          },
        ],
        Environment: {
          Variables: {
            DD_TAGS: "instrumenter_layer_version:2",
          },
        },
      },
    });
    await updateInstrumenterDDTags(mockClient);
    expect(mockClient.send).toHaveBeenCalledTimes(0);
  });

  test("should error when the remote instrumentation layer is not found", async () => {
    functions.getLambdaFunction.mockReturnValue({
      Configuration: {
        Layers: [{}],
        Environment: {
          Variables: {
            DD_TAGS: "instrumenter_layer_version:2",
          },
        },
      },
    });
    await expect(updateInstrumenterDDTags(mockClient)).rejects.toThrow();
  });
});
