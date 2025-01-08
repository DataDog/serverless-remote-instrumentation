const { execSync } = require("child_process");

const creds = {};

const getCredentials = (arn) => {
  if (!creds[arn]) {
    const output = execSync(
      "aws-vault exec sso-serverless-sandbox-account-admin -- " +
        `aws sts assume-role --role-arn ${arn} --role-session-name testing`,
      { encoding: "utf-8" },
    );
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
