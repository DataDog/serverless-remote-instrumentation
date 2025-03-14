/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/metrics-validations/**+(test|spec).[jt]s?(x)"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {}],
  },
  testTimeout: 90000, // ms
};
