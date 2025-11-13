import { Config } from "jest";

export default {
  rootDir: "..",
  testMatch: ["**/test/**+(test|spec).[jt]s?(x)"],
  transform: {
    "^.+\\.tsx?$": "<rootDir>/test/import-meta-transformer.cjs",
  },
} satisfies Config;
