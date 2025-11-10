const { applyFunctionTags } = require("../src/tag");

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

  describe("applyFunctionTags", () => {
    it("should process all resources successfully in the happy path", async () => {
      // Mock client and send
      const mockSend = jest.fn().mockResolvedValue({
        FailedResourcesMap: {},
      });
      const mockClient = { send: mockSend };

      // 25 ARNs to ensure batching (20 + 5)
      const functionArns = Array.from(
        { length: 25 },
        (_, i) => `arn:aws:lambda:us-east-1:123456789012:function:test-${i}`,
      );

      // Call the function
      await applyFunctionTags(mockClient, functionArns, "tagging", (batch) => ({
        input: { ResourceARNList: batch },
      }));

      // Should call send twice (20 + 5)
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[0][0].input.ResourceARNList).toHaveLength(20);
      expect(mockSend.mock.calls[1][0].input.ResourceARNList).toHaveLength(5);
    });
    it("should retry only failed resources when FailedResourcesMap has elements", async () => {
      // Prepare 25 ARNs (so two batches: 20 + 5)
      const functionArns = Array.from(
        { length: 25 },
        (_, i) => `arn:aws:lambda:us-east-1:123456789012:function:test-${i}`,
      );

      // First call: fail 2 resources in the first batch, succeed in the second batch
      const failedResources = {
        "arn:aws:lambda:us-east-1:123456789012:function:test-3": {
          ErrorCode: "SomeError",
        },
        "arn:aws:lambda:us-east-1:123456789012:function:test-7": {
          ErrorCode: "SomeError",
        },
        "arn:aws:lambda:us-east-1:123456789012:function:test-10": {
          ErrorCode: "InvalidParameterException",
        },
      };

      const secondBatchFailures = {
        "arn:aws:lambda:us-east-1:123456789012:function:test-22": {
          ErrorCode: "SomeError",
        },
      };

      const mockSend = jest
        .fn()
        // First batch: 2 failures
        .mockResolvedValueOnce({
          FailedResourcesMap: failedResources,
        })
        // Second batch: 1 failure
        .mockResolvedValueOnce({
          FailedResourcesMap: secondBatchFailures,
        })
        // Retry batch: only the failed ARNs, succeed
        .mockResolvedValueOnce({
          FailedResourcesMap: {},
        });

      const mockClient = { send: mockSend };

      await applyFunctionTags(mockClient, functionArns, "tagging", (batch) => ({
        input: { ResourceARNList: batch },
      }));

      // First call: 20 ARNs (first batch)
      expect(mockSend.mock.calls[0][0].input.ResourceARNList).toHaveLength(20);
      // Second call: 5 ARNs (second batch)
      expect(mockSend.mock.calls[1][0].input.ResourceARNList).toHaveLength(5);
      // Third call: 3 ARNs (the failed ones from both batches)
      expect(mockSend.mock.calls[2][0].input.ResourceARNList).toEqual([
        "arn:aws:lambda:us-east-1:123456789012:function:test-3",
        "arn:aws:lambda:us-east-1:123456789012:function:test-7",
        "arn:aws:lambda:us-east-1:123456789012:function:test-22",
      ]);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it("should throw error when resources fail after 3 tries", async () => {
      // Prepare 5 ARNs for testing
      const functionArns = Array.from(
        { length: 5 },
        (_, i) => `arn:aws:lambda:us-east-1:123456789012:function:test-${i}`,
      );

      // Persistent failures for 2 resources
      const persistentFailures = {
        "arn:aws:lambda:us-east-1:123456789012:function:test-1": {
          ErrorCode: "SomeError",
        },
        "arn:aws:lambda:us-east-1:123456789012:function:test-3": {
          ErrorCode: "AnotherError",
        },
      };

      // Mock will always return the same failures for all 3 attempts
      const mockSend = jest.fn().mockResolvedValue({
        FailedResourcesMap: persistentFailures,
      });

      const mockClient = { send: mockSend };

      // Expect the function to throw an error
      await expect(
        applyFunctionTags(mockClient, functionArns, "tagging", (batch) => ({
          input: { ResourceARNList: batch },
        })),
      ).rejects.toThrow(
        'Failed to process 2 resources after 3 tries ["arn:aws:lambda:us-east-1:123456789012:function:test-1","arn:aws:lambda:us-east-1:123456789012:function:test-3"]',
      );

      // Should have made exactly 3 attempts:
      // 1st attempt: all 5 ARNs
      // 2nd attempt: 2 failed ARNs
      // 3rd attempt: 2 failed ARNs again
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(mockSend.mock.calls[0][0].input.ResourceARNList).toHaveLength(5);
      expect(mockSend.mock.calls[1][0].input.ResourceARNList).toHaveLength(2);
      expect(mockSend.mock.calls[2][0].input.ResourceARNList).toHaveLength(2);
    });
  });
});
