const { listErrors } = require("../src/error-storage");

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
      Contents: [{
        Key: 'errors/key1.json',
      }, {
        Key: 'errors/key2.json',
      }]
    };
    mockS3.send.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual(['key1', 'key2']);
    expect(mockS3.send).toHaveBeenCalledTimes(1);
  });

  test("handles multiple pages of results", async () => {
    const mockResult1 = {
      IsTruncated: true,
      Contents: [{
        Key: 'errors/key1.json',
      }, {
        Key: 'errors/key2.json',
      }],
      NextContinuationToken: 'A',
    };
    const mockResult2 = {
      IsTruncated: true,
      Contents: [{
        Key: 'errors/key3.json',
      }, {
        Key: 'errors/key4.json',
      }],
      NextContinuationToken: 'B',
    };
    const mockResult3 = {
      IsTruncated: false,
      Contents: [{
        Key: 'errors/key5.json',
      }],
    };
    mockS3.send.mockReturnValueOnce(mockResult1);
    mockS3.send.mockReturnValueOnce(mockResult2);
    mockS3.send.mockReturnValueOnce(mockResult3);

    const result = await listErrors(mockS3);

    expect(result).toStrictEqual(['key1', 'key2', 'key3', 'key4', 'key5']);
    expect(mockS3.send).toHaveBeenCalledTimes(3);
  });

  test("handles no results", async () => {
    const mockResult = {
      IsTruncated: false,
      Contents: []
    };
    mockS3.send.mockReturnValue(mockResult);
    const result = await listErrors(mockS3);

    expect(result).toStrictEqual([]);
    expect(mockS3.send).toHaveBeenCalledTimes(1);
  });
});
