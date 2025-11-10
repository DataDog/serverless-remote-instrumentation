import { execSync } from "child_process";

interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

const creds: Record<string, Credentials> = {};

const getCredentials = (arn: string): Credentials => {
  if (!creds[arn]) {
    let command = `aws sts assume-role --role-arn ${arn} --role-session-name testing`;
    if (!process.env.GITLAB_CI) {
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

export { getCredentials };
