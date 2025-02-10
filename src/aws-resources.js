const { LambdaClient } = require("@aws-sdk/client-lambda");

let lambdaClient;
const getLambdaClient = () => {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION,
    });
  }
  return lambdaClient;
};

exports.getLambdaClient = getLambdaClient;
