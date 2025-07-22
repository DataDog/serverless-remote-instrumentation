jest.mock("@aws-sdk/client-resource-groups-tagging-api", () => ({
  TagResourcesCommand: jest.fn().mockImplementation((input) => ({
    input,
    constructor: { name: "TagResourcesCommand" },
  })),
  UntagResourcesCommand: jest.fn().mockImplementation((input) => ({
    input,
    constructor: { name: "UntagResourcesCommand" },
  })),
}));

jest.mock("../src/logger", () => ({
  logger: {
    log: jest.fn(),
    error: jest.fn(),
  },
}));

const {
  tagResourcesWithSlsTag,
  untagResourcesOfSlsTag,
} = require("../src/tag");

describe("Tag Functions", () => {
  let mockClient;
  let mockSend;

  beforeEach(() => {
    mockSend = jest.fn();
    mockClient = {
      send: mockSend,
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("tagResourcesWithSlsTag", () => {
    it("should not attempt to tag when functionArns is empty", async () => {
      await tagResourcesWithSlsTag(mockClient, []);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should call send with correct parameters for single function", async () => {
      const functionArns = [
        "arn:aws:lambda:us-east-1:123456789012:function:test",
      ];
      mockSend.mockResolvedValue({});

      await tagResourcesWithSlsTag(mockClient, functionArns);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.constructor.name).toBe("TagResourcesCommand");
      expect(callArgs.input.ResourceARNList).toEqual(functionArns);
    });

    it("should process exactly 20 resources in a single batch", async () => {
      const functionArns = Array.from(
        { length: 20 },
        (_, i) => `arn:aws:lambda:us-east-1:123456789012:function:test-${i}`,
      );
      mockSend.mockResolvedValue({});

      await tagResourcesWithSlsTag(mockClient, functionArns);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.input.ResourceARNList).toHaveLength(20);
    });

    it("should process 21 resources in two batches", async () => {
      const functionArns = Array.from(
        { length: 21 },
        (_, i) => `arn:aws:lambda:us-east-1:123456789012:function:test-${i}`,
      );
      mockSend.mockResolvedValue({});

      await tagResourcesWithSlsTag(mockClient, functionArns);

      expect(mockSend).toHaveBeenCalledTimes(2);

      // First batch should have 20 resources
      const firstCallArgs = mockSend.mock.calls[0][0];
      expect(firstCallArgs.input.ResourceARNList).toHaveLength(20);

      // Second batch should have 1 resource
      const secondCallArgs = mockSend.mock.calls[1][0];
      expect(secondCallArgs.input.ResourceARNList).toHaveLength(1);
    });

    it("should process 40 resources in two batches of 20 each", async () => {
      const functionArns = Array.from(
        { length: 40 },
        (_, i) => `arn:aws:lambda:us-east-1:123456789012:function:test-${i}`,
      );
      mockSend.mockResolvedValue({});

      await tagResourcesWithSlsTag(mockClient, functionArns);

      expect(mockSend).toHaveBeenCalledTimes(2);

      // Both batches should have 20 resources
      const firstCallArgs = mockSend.mock.calls[0][0];
      const secondCallArgs = mockSend.mock.calls[1][0];
      expect(firstCallArgs.input.ResourceARNList).toHaveLength(20);
      expect(secondCallArgs.input.ResourceARNList).toHaveLength(20);
    });
  });

  describe("untagResourcesOfSlsTag", () => {
    it("should not attempt to untag when functionArns is empty", async () => {
      await untagResourcesOfSlsTag(mockClient, []);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should call send with correct parameters for single function", async () => {
      const functionArns = [
        "arn:aws:lambda:us-east-1:123456789012:function:test",
      ];
      mockSend.mockResolvedValue({});

      await untagResourcesOfSlsTag(mockClient, functionArns);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.constructor.name).toBe("UntagResourcesCommand");
      expect(callArgs.input.ResourceARNList).toEqual(functionArns);
    });

    it("should process exactly 20 resources in a single batch", async () => {
      const functionArns = Array.from(
        { length: 20 },
        (_, i) => `arn:aws:lambda:us-east-1:123456789012:function:test-${i}`,
      );
      mockSend.mockResolvedValue({});

      await untagResourcesOfSlsTag(mockClient, functionArns);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.input.ResourceARNList).toHaveLength(20);
    });

    it("should process 21 resources in two batches", async () => {
      const functionArns = Array.from(
        { length: 21 },
        (_, i) => `arn:aws:lambda:us-east-1:123456789012:function:test-${i}`,
      );
      mockSend.mockResolvedValue({});

      await untagResourcesOfSlsTag(mockClient, functionArns);

      expect(mockSend).toHaveBeenCalledTimes(2);

      // First batch should have 20 resources
      const firstCallArgs = mockSend.mock.calls[0][0];
      expect(firstCallArgs.input.ResourceARNList).toHaveLength(20);

      // Second batch should have 1 resource
      const secondCallArgs = mockSend.mock.calls[1][0];
      expect(secondCallArgs.input.ResourceARNList).toHaveLength(1);
    });

    it("should process 40 resources in two batches of 20 each", async () => {
      const functionArns = Array.from(
        { length: 40 },
        (_, i) => `arn:aws:lambda:us-east-1:123456789012:function:test-${i}`,
      );
      mockSend.mockResolvedValue({});

      await untagResourcesOfSlsTag(mockClient, functionArns);

      expect(mockSend).toHaveBeenCalledTimes(2);

      // Both batches should have 20 resources
      const firstCallArgs = mockSend.mock.calls[0][0];
      const secondCallArgs = mockSend.mock.calls[1][0];
      expect(firstCallArgs.input.ResourceARNList).toHaveLength(20);
      expect(secondCallArgs.input.ResourceARNList).toHaveLength(20);
    });
  });
});
