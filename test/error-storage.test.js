const {
  identifyNewErrorsAndResolvedErrors,
  listErrors,
} = require("../src/error-storage");
const { FAILED, SKIPPED, SUCCEEDED } = require("../src/consts");

const mockS3 = {
  send: jest.fn(),
};

describe("listErrors test suite", () => {
  beforeEach(() => {
    jest.resetAllMocks();
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
    mockS3.send.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual(["key1", "key2"]);
    expect(mockS3.send).toHaveBeenCalledTimes(1);
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
    mockS3.send.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual(["key"]);
    expect(mockS3.send).toHaveBeenCalledTimes(1);
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
    mockS3.send.mockReturnValueOnce(mockResult1);
    mockS3.send.mockReturnValueOnce(mockResult2);
    mockS3.send.mockReturnValueOnce(mockResult3);

    const result = await listErrors(mockS3);

    expect(result).toStrictEqual(["key1", "key2", "key3", "key4", "key5"]);
    expect(mockS3.send).toHaveBeenCalledTimes(3);
  });

  test("handles no results", async () => {
    const mockResult = {
      IsTruncated: false,
      Contents: [],
    };
    mockS3.send.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual([]);
    expect(mockS3.send).toHaveBeenCalledTimes(1);
  });

  test("handles no results with undefined contents", async () => {
    const mockResult = {
      IsTruncated: false,
    };
    mockS3.send.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual([]);
    expect(mockS3.send).toHaveBeenCalledTimes(1);
  });
});

describe("identifyErrorsAndResolvedErrors test suite", () => {
  test.each([
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
  ])("%s", (_, instrumentOutcome, previousErrors, expected) => {
    const result = identifyNewErrorsAndResolvedErrors(
      instrumentOutcome,
      previousErrors,
    );
    expect(result).toStrictEqual(expected);
  });
});
