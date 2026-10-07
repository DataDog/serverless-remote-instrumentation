import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import {
  DD_API_KEY,
  DD_API_KEY_SECRET_ARN,
  DD_SITE,
  EVENTBRIDGE_DELAY_METRIC,
  INSTRUMENTATION_LATENCY_METRIC,
  LAMBDA_PROCESSING_LATENCY_METRIC,
} from "./consts";
import { logger } from "./logger";
import { getSecretsManagerClient } from "./aws-resources";

interface DistributionPoint {
  metric: string;
  value: number;
  tags: string[];
}

let cachedSecretApiKey: string | undefined;

export function resetCachedApiKey(): void {
  cachedSecretApiKey = undefined;
}

export async function getApiKey(): Promise<string | undefined> {
  const apiKey = process.env[DD_API_KEY];
  if (apiKey) {
    return apiKey;
  }
  const secretArn = process.env[DD_API_KEY_SECRET_ARN];
  if (!secretArn) {
    return undefined;
  }
  if (!cachedSecretApiKey) {
    // Secret ARN format: arn:aws:secretsmanager:REGION:ACCOUNT:secret:NAME
    const region = secretArn.split(":")[3];
    const response = await getSecretsManagerClient(region).send(
      new GetSecretValueCommand({ SecretId: secretArn }),
    );
    cachedSecretApiKey = response.SecretString?.trim() || undefined;
  }
  return cachedSecretApiKey;
}

async function submitDistributionPoints(
  points: DistributionPoint[],
): Promise<void> {
  const site = process.env[DD_SITE] ?? "datadoghq.com";

  let apiKey: string | undefined;
  try {
    apiKey = await getApiKey();
  } catch (error) {
    logger.warn(
      `Failed to fetch API key from ${DD_API_KEY_SECRET_ARN}, skipping metric submission: ${error}`,
    );
    return;
  }
  if (!apiKey) {
    logger.warn(
      `Neither ${DD_API_KEY} nor ${DD_API_KEY_SECRET_ARN} set, skipping metric submission`,
    );
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
      // The secret may have been rotated; refetch on the next submission
      if (response.status === 403) {
        resetCachedApiKey();
      }
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
