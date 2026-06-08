import {
  DD_API_KEY,
  DD_SITE,
  EVENTBRIDGE_DELAY_METRIC,
  INSTRUMENTATION_LATENCY_METRIC,
  LAMBDA_PROCESSING_LATENCY_METRIC,
} from "./consts";
import { logger } from "./logger";

interface DistributionPoint {
  metric: string;
  value: number;
  tags: string[];
}

async function submitDistributionPoints(
  points: DistributionPoint[],
): Promise<void> {
  const apiKey = process.env[DD_API_KEY];
  const site = process.env[DD_SITE] ?? "datadoghq.com";

  if (!apiKey) {
    logger.warn("DD_API_KEY not set, skipping metric submission");
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    series: points.map(({ metric, value, tags }) => ({
      metric,
      points: [[nowSec, [value]]],
      tags,
    })),
  });

  try {
    const response = await fetch(
      `https://api.${site}/api/v1/distribution_points`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "DD-API-KEY": apiKey,
        },
        body,
      },
    );
    if (!response.ok) {
      const responseBody = await response.text();
      logger.warn(
        `Failed to submit metrics: HTTP ${response.status} ${responseBody}`,
      );
    }
  } catch (error) {
    logger.warn(`Failed to submit metrics: ${error}`);
  }
}

export async function submitInstrumentationMetrics(
  instrumentationLatencyMs: number,
  eventbridgeDelayMs: number,
  lambdaProcessingLatencyMs: number,
  functionArn: string,
): Promise<void> {
  const tags = functionArn ? [`function_arn:${functionArn}`] : [];
  await submitDistributionPoints([
    {
      metric: INSTRUMENTATION_LATENCY_METRIC,
      value: instrumentationLatencyMs,
      tags,
    },
    { metric: EVENTBRIDGE_DELAY_METRIC, value: eventbridgeDelayMs, tags },
    {
      metric: LAMBDA_PROCESSING_LATENCY_METRIC,
      value: lambdaProcessingLatencyMs,
      tags,
    },
  ]);
}
