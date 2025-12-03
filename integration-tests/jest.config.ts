import type { JestConfigWithTsJest } from "ts-jest";

export default {
  testEnvironment: "node",
  // globalTeardown: "./post-test-validation.ts",
  setupFilesAfterEnv: ["./jest-setup-after-env.ts"],
  // testMatch: ["**/integration-tests/**+(test|spec).[jt]s?(x)"],
  testMatch: ["**/integration-tests/updater.test.ts"],
  testTimeout: 90000, // ms
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {}],
  },
} satisfies JestConfigWithTsJest;
