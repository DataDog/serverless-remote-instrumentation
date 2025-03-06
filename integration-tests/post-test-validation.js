const {
  getTimestampsFromResults,
  runQuery,
} = require("./utilities/insights-queries");

const assertNoSecretsInLogs = async () => {
  const secretKeys = [
    "DD_API_KEY",
    "DATADOG_API_KEY",
    "AWS_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ];

  const queryResults = await runQuery(
    `fields @message, @timestamp | filter @message like /"(${secretKeys.join("|")})":"[A-Za-z0-9_-]+"/ | limit 10`,
  );

  if (queryResults.length) {
    throw new Error(
      `Found API keys in logs at least at times ${JSON.stringify(getTimestampsFromResults(queryResults))}`,
    );
  }
};

const postTestValidations = async () => {
  console.log("Post test validations running");
  const tests = [assertNoSecretsInLogs];
  const results = await Promise.allSettled(tests.map((func) => func()));
  let anyErrors = false;
  results.forEach((result) => {
    if (result.status === "rejected") {
      anyErrors = true;
      console.log(result.reason);
    }
  });

  if (anyErrors) {
    throw new Error("\n\nAfter test validations failed\n\n");
  }
  console.log("Post test validations successful");
  return true;
};

module.exports = postTestValidations;
