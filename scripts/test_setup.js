const { stackName } = require("../integration-tests/config.json");
const { execSync } = require("child_process");

// Need to yarn install since the publish script removes node modules
execSync(`yarn install`, {
  encoding: "utf-8",
  stdio: "inherit",
});

execSync(`cdk synth && cdk deploy --require-approval never ${stackName}`, {
  encoding: "utf-8",
  stdio: "inherit",
});
