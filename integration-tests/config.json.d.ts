declare const config: {
  region: string;
  account: string;
  stackName: string;
  testLambdaRole: string;
  functionName: string;
  bucketName: string;
  roleName: string;
  namingSeed: string;
  ddSite: string;
  version: string;
  apiSecretName: string;
  appSecretName: string;
  containerImageFunctionName: string;
};

export = config;
