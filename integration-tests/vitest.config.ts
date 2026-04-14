import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["integration-tests/**/*.test.ts"],
    testTimeout: 90_000,
    retry: process.env.CI ? 3 : 0,
    fileParallelism: false,
    globalSetup: ["./integration-tests/vitest-global-setup.ts"],
    reporters: ["verbose"],
  },
});
