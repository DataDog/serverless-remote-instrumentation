const { generateTestConfig } = require("./test_setup");
const { execSync } = require("child_process");

const { bucketName, stackName } = generateTestConfig();

if (require.main === module) {
  // This will fail because the bucket will have contents, but start the deletion
  // so that more things don't end up in the bucket while we try to delete
  try {
    execSync(`cdk synth && cdk destroy --force ${stackName}`, {
      encoding: "utf-8",
      stdio: "inherit",
    });
  } catch (e) {
    // Ignore
  }

  // Force the bucket to be deleted, this can fail if the bucket doesn't exist
  // like if we ran the teardown script twice, so ignore errors from it
  try {
    execSync(`aws s3 rb s3://${bucketName} --force`, {
      encoding: "utf-8",
      stdio: "inherit",
    });
  } catch (e) {
    // Ignore
  }

  // Now that the bucket is gone, delete the rest of the stack
  execSync(`cdk destroy --force ${stackName}`, {
    encoding: "utf-8",
    stdio: "inherit",
  });
}
