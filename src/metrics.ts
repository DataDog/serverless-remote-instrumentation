import { request } from "https";
import { logger } from "./logger";

export async function submitInstrumentationLatency(
  deltaMs: number,
  functionArn: string,
): Promise<void> {
  const apiKey = process.env.DD_API_KEY;
  const site = process.env.DD_SITE ?? "datadoghq.com";

  if (!apiKey) {
    logger.warn("DD_API_KEY not set, skipping metric submission");
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    series: [
      {
        metric: "datadog.remote_instrumenter.lambda_management_event.instrumentation_latency",
        points: [[nowSec, [deltaMs]]],
        tags: functionArn ? [`function_arn:${functionArn}`] : [],
      },
    ],
  });

  return new Promise((resolve) => {
    const req = request(
      {
        hostname: `api.${site}`,
        path: "/api/v1/distribution_points",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "DD-API-KEY": apiKey,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 400) {
            logger.warn(
              `Failed to submit instrumentation latency metric: HTTP ${res.statusCode} ${responseBody}`,
            );
          }
          resolve();
        });
      },
    );

    req.on("error", (error) => {
      logger.warn(`Failed to submit instrumentation latency metric: ${error}`);
      resolve();
    });

    req.write(body);
    req.end();
  });
}
