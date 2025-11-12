import {
  GetQueryResultsCommand,
  StartQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { sleep } from "./sleep";
import { getLogsClient } from "./aws-resources";
import { functionName } from "../config.json";

const runQuery = async (queryString: string): Promise<any[]> => {
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

const getFieldValueFromResults = (
  fieldName: string,
  results: any[],
): string[] =>
  results
    .map((result) => result.find((item: any) => item.field === fieldName))
    .map((item) => item.value);

const getTimestampsFromResults = (results: any[]): string[] =>
  getFieldValueFromResults("@timestamp", results);

const getMessageFromResults = (results: any[]): string[] =>
  getFieldValueFromResults("@message", results);

export { runQuery, getTimestampsFromResults, getMessageFromResults };
