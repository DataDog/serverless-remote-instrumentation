const { execSync } = require("child_process");
const { existsSync, readFileSync, writeFileSync } = require("fs");

const generateTestConfig = () => {
  const configPath = "integration-tests/config.json";
  let config;

  if (existsSync(configPath)) {
    config = JSON.parse(
      readFileSync(configPath, { encoding: "utf8", flag: "r" }).trim(),
    );
  } else {
    let namingSeed = "";
    if (process.env.USER) {
      namingSeed = process.env.USER;
    } else if (process.env.RUNNING_IN_GITHUB_ACTION) {
      namingSeed = process.env.PR_TITLE;
    }
    // Remove any non alphanumeric characters to fit stack name constraints
    namingSeed = namingSeed.replace(/[\W_]+/g, "");

    config = {
      region: "ca-central-1",
      account: "425362996713",
      stackName: `RemoteInstrumenterTestStack${namingSeed}`,
      functionName: `remote-instrumenter-testing-${namingSeed}`,
      bucketName: `remote-instrumenter-testing-bucket-${namingSeed}`,
      roleName: `remote-instrumenter-testing-${namingSeed}`,
      trailName: `datadog-serverless-instrumentation-trail-testing-${namingSeed}`,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
  return config;
};

exports.generateTestConfig = generateTestConfig;

const config = generateTestConfig();

console.log(`Using config\n${JSON.stringify(config)}`);

const { stackName } = config;

// Need to yarn install since the publish script removes node modules
execSync(`yarn install`, {
  encoding: "utf-8",
  stdio: "inherit",
});

execSync(`cdk synth && cdk deploy --require-approval never ${stackName}`, {
  encoding: "utf-8",
  stdio: "inherit",
});
