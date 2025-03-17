import { MetricsAggregator } from "@datadog/datadog-api-client/dist/packages/datadog-api-client-v2";
import getDDMetricValue from "./get-dd-metric-value";

const metricThresholds: {
  metricName: string;
  threshold: number;
  aggregator: MetricsAggregator;
  comparison: "greaterThan" | "lessThan";
}[] = [{
  metricName: "aws.lambda.enhanced.invocations",
  threshold: 10,
  aggregator: "sum",
  comparison: "greaterThan",
}, {
  metricName: "aws.lambda.enhanced.errors",
  threshold: 1,
  aggregator: "sum",
  comparison: "lessThan",
}, {
  metricName: "aws.lambda.enhanced.duration",
  threshold: 5, // seconds
  aggregator: "avg",
  comparison: "lessThan",
}];

// Make the test names nice
metricThresholds.forEach(obj => Object.assign(obj, {toString: () => `${obj.aggregator} of metric ${obj.metricName} is ${obj.comparison} than ${obj.threshold}`}));

describe("Metrics Validations", () => {
  it.each(metricThresholds)("%s", async ({metricName, threshold, comparison, aggregator}) => {
    const rv = await getDDMetricValue({
      metricName,
      aggregator,
    });

    if (comparison === 'greaterThan') {
      expect(rv).toBeGreaterThan(threshold);
    } else if (comparison === 'lessThan') {
      expect(rv).toBeLessThan(threshold);
    }
  });
});
