const { execSync } = require("child_process");

const creds = {};

const getCredentials = (arn) => {
  if (!creds[arn]) {
    let command = `aws sts assume-role --role-arn ${arn} --role-session-name testing`;
    if (!process.env.RUNNING_IN_GITHUB_ACTION) {
      command = `aws-vault exec sso-serverless-sandbox-account-admin -- ${command}`;
    }

    const output = execSync(command, { encoding: "utf-8" });
    const misNamedCreds = JSON.parse(output).Credentials;
    creds[arn] = {
      accessKeyId: misNamedCreds.AccessKeyId,
      secretAccessKey: misNamedCreds.SecretAccessKey,
      sessionToken: misNamedCreds.SessionToken,
    };
  }
  return creds[arn];
};

exports.getCredentials = getCredentials;
