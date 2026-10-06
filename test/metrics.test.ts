import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockSend, mockGetSecretsManagerClient } = vi.hoisted(() => {
  const mockSend = vi.fn();
  return {
    mockSend,
    mockGetSecretsManagerClient: vi.fn(() => ({ send: mockSend })),
  };
});

vi.mock("../src/aws-resources", () => ({
  getSecretsManagerClient: mockGetSecretsManagerClient,
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  GetSecretValueCommand: vi.fn().mockImplementation(function (input: any) {
    return { input };
  }),
}));

vi.mock("../src/logger", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getApiKey,
  resetCachedApiKey,
  submitInstrumentationMetrics,
} from "../src/metrics";

const SECRET_ARN =
  "arn:aws:secretsmanager:eu-west-1:123456789012:secret:dd-api-key-AbCdEf";

describe("getApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCachedApiKey();
    vi.stubEnv("DD_API_KEY", "");
    vi.stubEnv("DD_API_KEY_SECRET_ARN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers DD_API_KEY when set", async () => {
    vi.stubEnv("DD_API_KEY", "plain-key");
    vi.stubEnv("DD_API_KEY_SECRET_ARN", SECRET_ARN);
    expect(await getApiKey()).toBe("plain-key");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns undefined when neither is set", async () => {
    expect(await getApiKey()).toBeUndefined();
  });

  it("fetches the secret from the secret's region and caches it", async () => {
    vi.stubEnv("DD_API_KEY_SECRET_ARN", SECRET_ARN);
    mockSend.mockResolvedValue({ SecretString: "secret-key\n" });

    expect(await getApiKey()).toBe("secret-key");
    expect(await getApiKey()).toBe("secret-key");

    expect(mockGetSecretsManagerClient).toHaveBeenCalledWith("eu-west-1");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toEqual({ SecretId: SECRET_ARN });
  });
});

describe("submitInstrumentationMetrics", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetCachedApiKey();
    vi.stubEnv("DD_API_KEY", "");
    vi.stubEnv("DD_API_KEY_SECRET_ARN", SECRET_ARN);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the key resolved from the secret", async () => {
    mockSend.mockResolvedValue({ SecretString: "secret-key" });
    fetchMock.mockResolvedValue({ ok: true });

    await submitInstrumentationMetrics(1, 2, 3, "arn");

    expect(fetchMock.mock.calls[0][1].headers["DD-API-KEY"]).toBe("secret-key");
  });

  it("skips submission when the secret cannot be fetched", async () => {
    mockSend.mockRejectedValue(new Error("AccessDenied"));

    await submitInstrumentationMetrics(1, 2, 3, "arn");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refetches the secret after a 403", async () => {
    mockSend.mockResolvedValue({ SecretString: "secret-key" });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    await submitInstrumentationMetrics(1, 2, 3, "arn");
    await submitInstrumentationMetrics(1, 2, 3, "arn");

    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
