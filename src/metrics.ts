import { DD_API_KEY, DD_SITE, INSTRUMENTATION_LATENCY_METRIC } from "./consts";
import { logger } from "./logger";

export async function submitInstrumentationLatency(
  deltaMs: number,
  functionArn: string,
): Promise<void> {
  const apiKey = process.env[DD_API_KEY];
  const site = process.env[DD_SITE] ?? "datadoghq.com";

  if (!apiKey) {
    logger.warn("DD_API_KEY not set, skipping metric submission");
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    series: [
      {
        metric: INSTRUMENTATION_LATENCY_METRIC,
        points: [[nowSec, [deltaMs]]],
        tags: functionArn ? [`function_arn:${functionArn}`] : [],
      },
    ],
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
        `Failed to submit instrumentation latency metric: HTTP ${response.status} ${responseBody}`,
      );
    }
  } catch (error) {
    logger.warn(`Failed to submit instrumentation latency metric: ${error}`);
  }
}
