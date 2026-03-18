import { describe, test, expect, beforeEach, vi } from "vitest";

import {
  identifyNewErrorsAndResolvedErrors,
  listErrors,
  emptyBucket,
} from "../src/error-storage";
import { FAILED, SKIPPED, SUCCEEDED } from "../src/consts";
import type { S3Client } from "@aws-sdk/client-s3";

const mockSend = vi.fn();
const mockS3 = {
  send: mockSend,
} as unknown as S3Client;

describe("listErrors test suite", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("handles one page of results", async () => {
    const mockResult = {
      IsTruncated: false,
      Contents: [
        {
          Key: "errors/key1.json",
        },
        {
          Key: "errors/key2.json",
        },
      ],
    };
    mockSend.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual(["key1", "key2"]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("handles when errors/ is a folder object and should be filtered in the result", async () => {
    const mockResult = {
      IsTruncated: false,
      Contents: [
        {
          Key: "errors/",
        },
        {
          Key: "errors/key.json",
        },
      ],
    };
    mockSend.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual(["key"]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("handles multiple pages of results", async () => {
    const mockResult1 = {
      IsTruncated: true,
      Contents: [
        {
          Key: "errors/key1.json",
        },
        {
          Key: "errors/key2.json",
        },
      ],
      NextContinuationToken: "A",
    };
    const mockResult2 = {
      IsTruncated: true,
      Contents: [
        {
          Key: "errors/key3.json",
        },
        {
          Key: "errors/key4.json",
        },
      ],
      NextContinuationToken: "B",
    };
    const mockResult3 = {
      IsTruncated: false,
      Contents: [
        {
          Key: "errors/key5.json",
        },
      ],
    };
    mockSend.mockReturnValueOnce(mockResult1);
    mockSend.mockReturnValueOnce(mockResult2);
    mockSend.mockReturnValueOnce(mockResult3);

    const result = await listErrors(mockS3);

    expect(result).toStrictEqual(["key1", "key2", "key3", "key4", "key5"]);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  test("handles no results", async () => {
    const mockResult = {
      IsTruncated: false,
      Contents: [],
    };
    mockSend.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual([]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("handles no results with undefined contents", async () => {
    const mockResult = {
      IsTruncated: false,
    };
    mockSend.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual([]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe("identifyErrorsAndResolvedErrors test suite", () => {
  test.each<
    [string, any, string[], { newErrors: any[]; resolvedErrors: string[] }]
  >([
    [
      "nothing happened, no errors, nothing returned",
      {
        instrument: {
          [FAILED]: {},
          [SKIPPED]: {},
          [SUCCEEDED]: {},
        },
        uninstrument: {
          [FAILED]: {},
          [SKIPPED]: {},
          [SUCCEEDED]: {},
        },
      },
      [],
      {
        newErrors: [],
        resolvedErrors: [],
      },
    ],
    [
      "previous error not in results",
      {
        instrument: {
          [FAILED]: {},
          [SKIPPED]: {},
          [SUCCEEDED]: {},
        },
        uninstrument: {
          [FAILED]: {},
          [SKIPPED]: {},
          [SUCCEEDED]: {},
        },
      },
      ["I'm not here!"],
      {
        newErrors: [],
        resolvedErrors: [],
      },
    ],
    [
      "only success / skips, no errors, nothing returned",
      {
        instrument: {
          [FAILED]: {},
          [SKIPPED]: {
            function1: {},
          },
          [SUCCEEDED]: {
            function2: {},
          },
        },
        uninstrument: {
          [FAILED]: {},
          [SKIPPED]: {
            function1: {},
          },
          [SUCCEEDED]: {
            function1: {},
          },
        },
      },
      [],
      {
        newErrors: [],
        resolvedErrors: [],
      },
    ],
    [
      "failures are added to the newErrors",
      {
        instrument: {
          [FAILED]: {
            failure1: {
              reason: "failure1 - reason",
            },
          },
          [SKIPPED]: {
            function1: {},
          },
          [SUCCEEDED]: {
            function2: {},
          },
        },
        uninstrument: {
          [FAILED]: {
            failure2: {
              reason: "failure2 - reason",
            },
          },
          [SKIPPED]: {
            function1: {},
          },
          [SUCCEEDED]: {
            function1: {},
          },
        },
      },
      [],
      {
        newErrors: [
          {
            functionName: "failure1",
            reason: "failure1 - reason",
          },
          {
            functionName: "failure2",
            reason: "failure2 - reason",
          },
        ],
        resolvedErrors: [],
      },
    ],
    [
      "successes and skips are added to the resolvedErrors",
      {
        instrument: {
          [FAILED]: {},
          [SKIPPED]: {
            function1: {},
          },
          [SUCCEEDED]: {
            function2: {},
          },
        },
        uninstrument: {
          [FAILED]: {},
          [SKIPPED]: {
            function3: {},
          },
          [SUCCEEDED]: {
            function4: {},
          },
        },
      },
      ["function1", "function4"],
      {
        newErrors: [],
        resolvedErrors: ["function1", "function4"],
      },
    ],
    [
      "both failures and successes get mapped in the same execution",
      {
        instrument: {
          [FAILED]: {
            failure1: {
              reason: "failure1 - reason",
            },
            failure1a: {
              reason: "failure1a - reason",
            },
          },
          [SKIPPED]: {
            function1: {},
            function1a: {},
          },
          [SUCCEEDED]: {
            function2: {},
          },
        },
        uninstrument: {
          [FAILED]: {
            failure2: {
              reason: "failure2 - reason",
            },
            failure2a: {
              reason: "failure2a - reason",
            },
          },
          [SKIPPED]: {
            function3: {},
            function3a: {},
          },
          [SUCCEEDED]: {
            function4: {},
          },
        },
      },
      ["function1", "function1a", "failure1a", "function4", "I do not exist!"],
      {
        newErrors: [
          {
            functionName: "failure1",
            reason: "failure1 - reason",
          },
          {
            functionName: "failure2",
            reason: "failure2 - reason",
          },
          {
            functionName: "failure2a",
            reason: "failure2a - reason",
          },
        ],
        resolvedErrors: ["function1", "function1a", "function4"],
      },
    ],
  ])(
    "%s",
    (
      _: string,
      instrumentOutcome: any,
      previousErrors: string[],
      expected: { newErrors: any[]; resolvedErrors: string[] },
    ) => {
      const result = identifyNewErrorsAndResolvedErrors(
        instrumentOutcome,
        previousErrors,
      );
      expect(result).toStrictEqual(expected);
    },
  );
});

describe("emptyBucket test suite", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("handles empty bucket", async () => {
    const mockResult = {
      IsTruncated: false,
      Contents: [],
    };
    mockSend.mockReturnValue(mockResult);

    await emptyBucket(mockS3);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: process.env.DD_S3_BUCKET,
        }),
      }),
    );
  });

  test("handles empty bucket with undefined contents", async () => {
    const mockResult = {
      IsTruncated: false,
    };
    mockSend.mockReturnValue(mockResult);

    await emptyBucket(mockS3);

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("deletes objects in single page", async () => {
    const mockListResult = {
      IsTruncated: false,
      Contents: [
        { Key: "errors/key1.json" },
        { Key: "errors/key2.json" },
        { Key: "other/file.txt" },
      ],
    };
    mockSend.mockReturnValueOnce(mockListResult);

    await emptyBucket(mockS3);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: process.env.DD_S3_BUCKET,
          Delete: {
            Objects: [
              { Key: "errors/key1.json" },
              { Key: "errors/key2.json" },
              { Key: "other/file.txt" },
            ],
            Quiet: true,
          },
        }),
      }),
    );
  });

  test("handles multiple pages of objects", async () => {
    const mockListResult1 = {
      IsTruncated: true,
      Contents: [{ Key: "errors/key1.json" }, { Key: "errors/key2.json" }],
      NextContinuationToken: "token1",
    };
    const mockListResult2 = {
      IsTruncated: false,
      Contents: [{ Key: "errors/key3.json" }],
    };

    mockSend
      .mockReturnValueOnce(mockListResult1)
      .mockReturnValueOnce(undefined) // delete command response
      .mockReturnValueOnce(mockListResult2)
      .mockReturnValueOnce(undefined); // delete command response

    await emptyBucket(mockS3);

    expect(mockSend).toHaveBeenCalledTimes(4);
    // First list call
    expect(mockSend).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: process.env.DD_S3_BUCKET,
        }),
      }),
    );
    // First delete call
    expect(mockSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({
          Delete: {
            Objects: [{ Key: "errors/key1.json" }, { Key: "errors/key2.json" }],
            Quiet: true,
          },
        }),
      }),
    );
    // Second list call with continuation token
    expect(mockSend).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: process.env.DD_S3_BUCKET,
          ContinuationToken: "token1",
        }),
      }),
    );
    // Second delete call
    expect(mockSend).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        input: expect.objectContaining({
          Delete: {
            Objects: [{ Key: "errors/key3.json" }],
            Quiet: true,
          },
        }),
      }),
    );
  });

  test("handles large number of objects requiring batching", async () => {
    // Create 1500 objects to test batching
    const objects = Array.from({ length: 1500 }, (_, i: number) => ({
      Key: `object${i}.json`,
    }));

    const mockListResult = {
      IsTruncated: false,
      Contents: objects,
    };
    mockSend.mockReturnValueOnce(mockListResult);

    await emptyBucket(mockS3);

    // Should be 1 list call + 2 delete calls (1000 + 500 objects)
    expect(mockSend).toHaveBeenCalledTimes(3);

    // First batch (objects 0-999)
    expect(mockSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({
          Delete: {
            Objects: objects.slice(0, 1000),
            Quiet: true,
          },
        }),
      }),
    );

    // Second batch (objects 1000-1499)
    expect(mockSend).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        input: expect.objectContaining({
          Delete: {
            Objects: objects.slice(1000, 1500),
            Quiet: true,
          },
        }),
      }),
    );
  });
});
