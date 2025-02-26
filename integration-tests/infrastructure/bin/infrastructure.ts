#!/usr/bin/env node
import { App, SecretValue, Stack, Tags } from 'aws-cdk-lib';
import { AccountRootPrincipal, Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnInclude } from 'aws-cdk-lib/cloudformation-include';
import { Construct } from 'constructs';
import { region, account, roleName, stackName, functionName, trailName, bucketName, testLambdaRole } from '../../config.json';
import { readFileSync } from 'fs'

class TestingStack extends Stack {
  constructor(scope: Construct, id: string, props?: any) {
    super(scope, id, props);
    const assumedRole = new Role(this, 'AssumedRoleForTests', {
      assumedBy: new AccountRootPrincipal(),
      roleName,
    });

    assumedRole.addToPolicy(new PolicyStatement({
      actions: ['s3:*'],
      resources: [ `arn:aws:s3:::${bucketName}/*`, `arn:aws:s3:::${bucketName}` ],
    }));

    assumedRole.addToPolicy(new PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [ `arn:aws:lambda:${region}:${account}:function:${functionName}` ],
    }));

    assumedRole.addToPolicy(new PolicyStatement({
      actions: ['lambda:GetFunctionConfiguration', 'lambda:CreateFunction', 'lambda:DeleteFunction', 'lambda:TagResource'],
      resources: [ '*' ],
    }));

    assumedRole.addToPolicy(new PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [ `arn:aws:secretsmanager:${region}:${account}:secret:Remote_Instrumenter*` ],
    }));

    assumedRole.addToPolicy(new PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [ `arn:aws:iam::${account}:role/${testLambdaRole}` ],
    }));

    new Role(this, 'TestLambdaExecutionRole', {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      roleName: testLambdaRole,
    });

    const version = readFileSync('scripts/.layers/version', { encoding: 'utf8', flag: 'r' }).trim()

    new CfnInclude(this, 'ImportedRemoteInstrumenterTemplate', { 
      templateFile: 'template.yaml',
      parameters: {
        EnableCodeSigningConfigurations: false,
        InstrumenterFunctionName: functionName,
        TrailName: trailName,
        DdSite: "datad0g.com",
        DdApiKey: SecretValue.secretsManager("Remote_Instrumenter_Test_API_Key_20250226"),
        BucketName: bucketName,
        DdRemoteInstrumentLayerAwsAccount: "425362996713",
        DdRemoteInstrumentLayerVersion: version,
      },
    });
  }
}

const app = new App();
const stack = new TestingStack(app, stackName, {
  env: { account, region },
});

Tags.of(stack).add('DD_PRESERVE_STACK', 'true');

app.synth();
