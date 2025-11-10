declare module "./config.json" {
  interface Config {
    account: string;
    region: string;
    functionName: string;
    ddSite: string;
    roleName: string;
    stackName: string;
    bucketName: string;
    testLambdaRole: string;
    apiSecretName: string;
    appSecretName: string;
    namingSeed?: string;
  }

  const config: Config;
  export default config;

  export const account: string;
  export const region: string;
  export const functionName: string;
  export const ddSite: string;
  export const roleName: string;
  export const stackName: string;
  export const bucketName: string;
  export const testLambdaRole: string;
  export const apiSecretName: string;
  export const appSecretName: string;
  export const namingSeed: string;
}
