#!/bin/bash

# Unless explicitly stated otherwise all files in this repository are licensed
# under the Apache License Version 2.0.
# This product includes software developed at Datadog (https://www.datadoghq.com/).
# Copyright 2024 Datadog, Inc.

# Usage: ./publish_self_monit_template.sh <Desired Version> <Account [serverless-sandbox|prod]>
# e.g.  ./publish_self_monit_template.sh 0.0.1 serverless-sandbox
# When publishing to serverless-sandbox, the template version number is NOT updated and no github release is created!

set -e

CURRENT_VERSION=$(grep -o 'Version: \d\+\.\d\+\.\d\+' template.yaml | cut -d' ' -f2)

# Read the desired version
if [ -z "$1" ]; then
    echo "ERROR: You must specify a desired version number"
    exit 1
elif [[ ! $1 =~ [0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "ERROR: You must use a semantic version (e.g. 3.1.4)"
    exit 1
else
    SAMPLE_APP_VERSION=$1
fi

# Check account parameter
VALID_ACCOUNTS=("serverless-sandbox" "prod")
if [ -z "$2" ]; then
    echo "ERROR: You must pass an account parameter. Please choose serverless-sandbox or prod."
    exit 1
fi
if [[ ! "${VALID_ACCOUNTS[@]}" =~ $2 ]]; then
    echo "ERROR: The account parameter was invalid. Please choose serverless-sandbox or prod."
    exit 1
fi

ACCOUNT="${2}"

if [ "$ACCOUNT" = "serverless-sandbox" ]; then
    BUCKET="datadog-cloudformation-template-serverless-sandbox"
fi
if [ "$ACCOUNT" = "prod" ]; then
    BUCKET="datadog-cloudformation-template"
fi

function aws-login() {
    cfg=( "$@" )
    shift
    if [ "$ACCOUNT" = "prod" ] ; then
        aws-vault exec prod-engineering --  ${cfg[@]}
    else
        aws-vault exec sso-serverless-sandbox-account-admin-8h --  ${cfg[@]}
    fi
}

echo "Injecting lambda code into CloudFormation template"
rm -rf dist
mkdir dist

awk -v STRING_TO_REPLACE="INJECT_ENTRY_FUNCTION_CODE_PLACEHOLDER" -f inject_inline_code.awk modifier_handler.js template.yaml > dist/template.yaml

# Validate the template
echo "Validating template.yaml..."
aws-login aws cloudformation validate-template --template-body file://dist/template.yaml
echo "Uploading the CloudFormation Template"

aws-login aws s3 cp dist/template.yaml s3://${BUCKET}/aws/remote-instrument-self-monitor-dev/${SAMPLE_APP_VERSION}.yaml
aws-login aws s3 cp dist/template.yaml s3://${BUCKET}/aws/remote-instrument-self-monitor-dev/latest.yaml
TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/remote-instrument-self-monitor-dev/latest.yaml"
echo "CURRENT_VERSION: $CURRENT_VERSION"
echo "SAMPLE_APP_VERSION: $SAMPLE_APP_VERSION"
echo "ACCOUNT: $ACCOUNT"
echo "TEMPLATE_URL: $TEMPLATE_URL"
echo "BUCKET: $BUCKET"
#fi

echo "Done uploading the CloudFormation template!"
echo
echo "Here is the CloudFormation quick launch URL:"
echo "https://console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=remote-instrument-self-monitor&templateURL=${TEMPLATE_URL}"
echo
echo "Serverless Self-Monitoring App for Remote Instrument release process complete!"
