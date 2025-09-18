const config = {
  globalTeardown: "./post-test-validation.js",
  setupFilesAfterEnv: ["./jest-setup-after-env.js"],
  testMatch: ["**/integration-tests/**+(test|spec).[jt]s?(x)"],
  testTimeout: 90000, // ms
};

module.exports = config;
