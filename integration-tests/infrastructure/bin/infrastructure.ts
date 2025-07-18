#!/usr/bin/env node
import { App, SecretValue, Stack, Tags } from 'aws-cdk-lib';
import { AccountRootPrincipal, Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnInclude } from 'aws-cdk-lib/cloudformation-include';
import { Construct } from 'constructs';
import { region, account, roleName, stackName, functionName, trailName, bucketName, testLambdaRole, ddSite, apiSecretName } from '../../config.json';
import { readFileSync, writeFileSync } from 'fs'
import { yamlParse, yamlDump } from 'yaml-cfn'


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
      resources: [
        `arn:aws:lambda:${region}:${account}:function:${functionName}`,
        `arn:aws:lambda:${region}:${account}:function:ri-test-*`,
      ],
    }));

    assumedRole.addToPolicy(new PolicyStatement({
      actions: ['lambda:GetFunctionConfiguration', 'lambda:CreateFunction', 'lambda:DeleteFunction', 'lambda:TagResource', 'lambda:GetLayerVersion'],
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

    assumedRole.addToPolicy(new PolicyStatement({
      actions: ["logs:StartQuery", "logs:GetQueryResults"],
      resources: ["*"],
    }));

    new Role(this, 'TestLambdaExecutionRole', {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      roleName: testLambdaRole,
    });

    new CfnInclude(this, 'ImportedRemoteInstrumenterTemplate', { 
      templateFile: this.modifyTemplate(),
      parameters: {
        EnableCodeSigningConfigurations: false,
        InstrumenterFunctionName: functionName,
        TrailName: trailName,
        DdSite: ddSite,
        DdApiKey: SecretValue.secretsManager(apiSecretName),
        BucketName: bucketName,
      },
    });
  }

  modifyTemplate(): string {
    const modifiedPath = 'modified_template.yaml';
    const version = readFileSync('scripts/.layers/version', { encoding: 'utf8', flag: 'r' }).trim();
    const template = yamlParse(readFileSync('template.yaml', { encoding: 'utf8', flag: 'r' }));
    template.Mappings.Constants.DdRemoteInstrumentLayerAwsAccount.Number = account;
    template.Mappings.Constants.DdRemoteInstrumentLayerVersion.Version = version;
    template.Resources.LambdaFunction.Properties.Environment.Variables.DD_LOG_LEVEL = "INFO";
    template.Mappings.Constants.DdCIBypassSiteValidation.Bypass = true;
    writeFileSync(modifiedPath, yamlDump(template));
    return modifiedPath;
  }
}

const app = new App();
const stack = new TestingStack(app, stackName, {
  env: { account, region },
});

Tags.of(stack).add('DD_PRESERVE_STACK', 'true');

app.synth();
