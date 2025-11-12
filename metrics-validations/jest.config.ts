import type { JestConfigWithTsJest } from "ts-jest";

export default {
  testEnvironment: "node",
  testMatch: ["**/metrics-validations/**+(test|spec).[jt]s?(x)"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {}],
  },
  testTimeout: 90000, // ms
} satisfies JestConfigWithTsJest;
