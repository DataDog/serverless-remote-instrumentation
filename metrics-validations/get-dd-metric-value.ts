import { client, v2 } from "@datadog/datadog-api-client";
import { MetricsAggregator } from "@datadog/datadog-api-client/dist/packages/datadog-api-client-v2";
const { account, region, functionName } = require("../integration-tests/config.json");
const { getApiKey, getAppKey } = require("../integration-tests/utilities/datadog-keys.js");
import { get } from "lodash";

let metricsClient: v2.MetricsApi;

const getDDApiMetricsClient = async () => {
  if (!metricsClient) {
    const configurationOpts = {
      authMethods: {
        apiKeyAuth: await getApiKey(),
        appKeyAuth: await getAppKey(),
      },
    };
    const config = client.createConfiguration(configurationOpts);
    config.setServerVariables({
      site: "datad0g.com",
    });
    metricsClient = new v2.MetricsApi(config);
  }
  return metricsClient;
};

exports.getDDApiMetricsClient = getDDApiMetricsClient;

const getDDMetricValue = async ({ aggregator="sum", metricName, size }: {
  metricName: string;
  size?: number; // time range size in ms, defaults to 30 minutes,
  aggregator?: MetricsAggregator;
}) => {
  const to = new Date().getTime();
  const from = to - (size || 1000 * 60 * 30);
  const metricsClient = await getDDApiMetricsClient();
  const query: v2.MetricsApiQueryScalarDataRequest = {
    body: {
      data: {
        attributes: {
          formulas: [
            {
              formula: "metricValue",
            },
          ],
          from,
          to,
          queries: [
            {
              aggregator,
              dataSource: "metrics",
              query: `${aggregator}:${metricName}{functionname:${functionName},region:${region},aws_account:${account}}`,
              name: "metricValue",
            },
          ],
        },
        type: "scalar_request",
      },
    },
  };
  const result = await metricsClient.queryScalarData(query);
  const metricValue = result.data?.attributes?.columns?.find(item => get(item, 'name') === "metricValue");
  return get(metricValue, ["values", 0], 0);
};

export default getDDMetricValue;
