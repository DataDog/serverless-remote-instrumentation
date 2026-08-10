#!/usr/bin/env node
import { App, CfnOutput, SecretValue, Stack, RemovalPolicy, Duration, Tags } from 'aws-cdk-lib';
import { AccountRootPrincipal, Role, ServicePrincipal, PolicyStatement, CompositePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction, Runtime, Code, Version, CfnFunction } from 'aws-cdk-lib/aws-lambda';
import { Distribution, LambdaEdgeEventType, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { CfnInclude } from 'aws-cdk-lib/cloudformation-include';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import path from 'path';
import { region, account, roleName, stackName, functionName, bucketName, testLambdaRole, ddSite, apiSecretName } from '../../config.json';
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
      actions: [
        'lambda:GetFunctionConfiguration',
        'lambda:CreateFunction',
        'lambda:DeleteFunction',
        'lambda:TagResource',
        'lambda:GetLayerVersion',
        'lambda:ListTags',
        'lambda:GetPolicy',
        'lambda:UpdateFunctionConfiguration',
      ],
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

    assumedRole.addToPolicy(new PolicyStatement({
      actions: ["cloudformation:DescribeStacks"],
      resources: ["*"],
    }));

    assumedRole.addToPolicy(new PolicyStatement({
      actions: ["cloudfront:ListDistributions"],
      resources: ["*"],
    }));

    new Role(this, 'TestLambdaExecutionRole', {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      roleName: testLambdaRole,
    });

    // Minimal Lambda container image used by tests that verify the instrumenter
    // skips container-image functions gracefully. CDK builds and pushes this to
    // the CDK bootstrap ECR repo during `cdk deploy`, keyed by Dockerfile hash
    // so it only rebuilds when the Dockerfile changes.
    const testContainerImage = new DockerImageAsset(this, 'TestContainerImage', {
      directory: path.join(__dirname, '../../test-container'),
      platform: Platform.LINUX_AMD64,
    });
    new CfnOutput(this, 'TestContainerImageUri', {
      value: testContainerImage.imageUri,
    });

    new CfnInclude(this, 'ImportedRemoteInstrumenterTemplate', {
      templateFile: this.modifyTemplate(),
      parameters: {
        EnableCodeSigningConfigurations: false,
        UseExistingCloudTrailTrail: true,
        DdSite: ddSite,
        DdApiKey: SecretValue.secretsManager(apiSecretName),
        BucketName: bucketName,
      },
    });

    if (region === 'us-east-1') {
      // S3 bucket used as the CloudFront origin. Lambda@Edge functions need a
      // real origin to be associated with a distribution.
      const originBucket = new Bucket(this, 'EdgeFunctionOriginBucket', {
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

      // Lambda@Edge requires the execution role to trust edgelambda.amazonaws.com
      // in addition to lambda.amazonaws.com.
      const edgeFunctionRole = new Role(this, 'EdgeFnExecRole', {
        assumedBy: new CompositePrincipal(
          new ServicePrincipal('lambda.amazonaws.com'),
          new ServicePrincipal('edgelambda.amazonaws.com'),
        ),
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });

      const edgeFunction = new LambdaFunction(this, 'EdgeFn', {
        runtime: Runtime.NODEJS_24_X,
        handler: 'index.handler',
        code: Code.fromInline(`
'use strict';
exports.handler = (event, context, callback) => {
  const response = event.Records[0].cf.response;
  callback(null, response);
};
        `),
        role: edgeFunctionRole,
        memorySize: 128,
        timeout: Duration.seconds(5),
      });
      edgeFunction.applyRemovalPolicy(RemovalPolicy.RETAIN);

      // Lambda@Edge requires a published version (not $LATEST). CloudFormation
      // registers the function as Lambda@Edge when it sees LambdaFunctionAssociations
      // on the distribution pointing to a specific version ARN.
      // RETAIN so CloudFormation does not try to delete the version while
      // CloudFront replicas still exist.
      const edgeFunctionVersion = new Version(this, 'EdgeFnVersion', {
        lambda: edgeFunction,
        removalPolicy: RemovalPolicy.RETAIN,
      });

      new Distribution(this, 'EdgeFunctionDistribution', {
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(originBucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          edgeLambdas: [
            {
              functionVersion: edgeFunctionVersion,
              eventType: LambdaEdgeEventType.ORIGIN_RESPONSE,
            },
          ],
        },
      });

      new CfnOutput(this, 'EdgeFunctionName', {
        value: edgeFunction.functionName,
      });
    }
  }

  modifyTemplate(): string {
    const modifiedPath = 'modified_template.yaml';
    const version = readFileSync(`${process.env.SCRIPTS_PATH}/.layers/version`, { encoding: 'utf8', flag: 'r' }).trim();
    const template = yamlParse(readFileSync('template.yaml', { encoding: 'utf8', flag: 'r' }));
    template.Mappings.Constants.DdRemoteInstrumentLayerAwsAccount.Number = account;
    template.Mappings.Constants.DdRemoteInstrumentLayerVersion.Version = version;
    template.Mappings.Constants.InstrumenterFunctionName.Name = functionName;
    template.Resources.LambdaFunction.Properties.Environment.Variables.DD_LOG_LEVEL = "INFO";
    // Timeout at 5 minutes since sometimes we run into cases where the custom resource hangs.
    template.Resources.CloudFormationLifeCycle.Properties.ServiceTimeout = 300;
    template.Mappings.Constants.DdCIBypassSiteValidation.Bypass = true;
    template.Mappings.Constants.DdInternalSendDebugInformation.Enabled = true;
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
