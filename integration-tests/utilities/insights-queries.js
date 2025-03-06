const {
  GetQueryResultsCommand,
  StartQueryCommand,
} = require("@aws-sdk/client-cloudwatch-logs");
const { sleep } = require("./sleep");
const { getLogsClient } = require("./aws-resources");
const { functionName } = require("../config.json");

const runQuery = async (queryString) => {
  const queryParams = {
    logGroupName: `/aws/lambda/${functionName}`,
    startTime: Date.now() - 30 * 60 * 1000, // 30 minutes ago in ms
    endTime: Date.now(),
    queryString,
  };

  const command = new StartQueryCommand(queryParams);

  const client = getLogsClient();

  const response = await client.send(command);
  const { queryId } = response;

  let i = 0;
  while (i < 10) {
    i += 1;
    await sleep(5000);
    const getCommand = new GetQueryResultsCommand({ queryId });

    const { status, results } = await client.send(getCommand);

    if (["Scheduled", "Running"].includes(status)) {
      continue;
    }
    return results;
  }
  throw new Error(`Timed out while waiting for query ${queryString}`);
};

exports.runQuery = runQuery;

const getFieldValueFromResults = (fieldName, results) =>
  results
    .map((result) => result.find((item) => item.field === fieldName))
    .map((item) => item.value);

const getTimestampsFromResults = (results) =>
  getFieldValueFromResults("@timestam", results);

exports.getTimestampsFromResults = getTimestampsFromResults;

const getMessageFromResults = (results) =>
  getFieldValueFromResults("@message", results);

exports.getMessageFromResults = getMessageFromResults;
