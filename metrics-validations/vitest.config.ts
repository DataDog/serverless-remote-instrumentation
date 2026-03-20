import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["metrics-validations/**/*.test.ts"],
    testTimeout: 90_000,
  },
});
