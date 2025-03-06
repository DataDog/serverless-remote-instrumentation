const config = {
  globalTeardown: "./post-test-validation.js",
  testMatch: ["**/integration-tests/**+(test|spec).[jt]s?(x)"],
  testTimeout: 60000, // ms
};

module.exports = config;
