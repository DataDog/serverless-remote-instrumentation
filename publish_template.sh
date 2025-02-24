#!/bin/bash

# Unless explicitly stated otherwise all files in this repository are licensed
# under the Apache License Version 2.0.
# This product includes software developed at Datadog (https://www.datadoghq.com/).
# Copyright 2024 Datadog, Inc.

# Usage: ./publish_template.sh <Desired Version> <Account [serverless-sandbox|prod]>
# e.g.  ./publish_cf_template.sh 0.5.1 serverless-sandbox
# When publishing to serverless-sandbox, the template version number is NOT updated and no github release is created!

set -e

TEMPLATE_VERSION=$(grep -o 'Version: \d\+\.\d\+\.\d\+' template.yaml | cut -d' ' -f2)

# Read the desired version
if [ -z $TEMPLATE_VERSION ]; then
    echo "ERROR: You must specify a desired version number"
    exit 1
elif [[ ! $TEMPLATE_VERSION =~ [0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "ERROR: You must use a semantic version (e.g. 3.1.4)"
    exit 1
else
    SAMPLE_APP_VERSION=$TEMPLATE_VERSION
fi

# Check account parameter
VALID_ACCOUNTS=("serverless-sandbox" "prod")
if [ -z $ACCOUNT ]; then
    echo "ERROR: You must pass an ACOUNT parameter. Please choose serverless-sandbox or prod."
    exit 1
fi
if [[ ! "${VALID_ACCOUNTS[@]}" =~ $ACCOUNT ]]; then
    echo "ERROR: The ACCOUNT parameter was invalid. Please choose serverless-sandbox or prod."
    exit 1
fi

if [ "$ACCOUNT" = "serverless-sandbox" ]; then
    BUCKET="datadog-cloudformation-template-serverless-sandbox"
fi
if [ "$ACCOUNT" = "prod" ]; then
    BUCKET="datadog-cloudformation-template"
fi


echo "Injecting lambda code into CloudFormation template"
rm -rf dist
mkdir dist

#awk -v STRING_TO_REPLACE="INJECT_ENTRY_FUNCTION_CODE_PLACEHOLDER" -f inject_inline_code.awk handler.js template.yaml > dist/template.yaml
cp template.yaml dist/template.yaml

# Validate the template
echo "Validating template.yaml..."
aws cloudformation validate-template --template-body file://dist/template.yaml
echo "Uploading the CloudFormation Template"
if [ "$ACCOUNT" = "prod" ]; then
    # # Make sure we are on the prod branch
    # BRANCH=$(git rev-parse --abbrev-ref HEAD)
    # if [ $BRANCH != "prod" ]; then
    #     echo "ERROR: Not on the prod branch, aborting."
    #     exit 1
    # fi

    # # Confirm to proceed
    # echo
    # read -p "About to bump the version from ${CURRENT_VERSION} to ${SAMPLE_APP_VERSION}, create a release of v${SAMPLE_APP_VERSION} on GitHub, upload the template.yaml to s3://${BUCKET}/aws/remote-instrument/${SAMPLE_APP_VERSION}.yaml. Continue (y/n)?" CONT
    # if [ "$CONT" != "y" ]; then
    #     echo "Exiting..."
    #     exit 1
    # fi

    # # Get the latest code
    # git pull origin prod

    # # Create a release branch
    # RELEASE_BRANCH="release/${SAMPLE_APP_VERSION}"
    # git checkout -b $RELEASE_BRANCH

    # # Bump version number in template.yml
    # echo "Bumping the version number to ${SAMPLE_APP_VERSION}..."
    # perl -pi -e "s/Version: [0-9\.]+/Version: ${SAMPLE_APP_VERSION}/g" template.yaml
    # perl -pi -e "s/Version: [0-9\.]+/Version: ${SAMPLE_APP_VERSION}/g" dist/template.yaml

    # # Commit version number changes to git
    # echo "Committing version number change..."
    # git add template.yaml
    # git commit -m "Bump version from ${CURRENT_VERSION} to ${SAMPLE_APP_VERSION}"
    # git push origin $RELEASE_BRANCH

    # git tag v${SAMPLE_APP_VERSION}

    # git push origin v${SAMPLE_APP_VERSION}

    aws s3 cp dist/template.yaml s3://${BUCKET}/aws/remote-instrument/${SAMPLE_APP_VERSION}.yaml \
        --grants read=uri=http://acs.amazonaws.com/groups/global/AllUsers
    aws s3 cp dist/template.yaml s3://${BUCKET}/aws/remote-instrument/latest.yaml \
        --grants read=uri=http://acs.amazonaws.com/groups/global/AllUsers
    TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/remote-instrument/latest.yaml"
else
    aws s3 cp dist/template.yaml s3://${BUCKET}/aws/remote-instrument-dev/${SAMPLE_APP_VERSION}.yaml
    aws s3 cp dist/template.yaml s3://${BUCKET}/aws/remote-instrument-dev/latest.yaml
    TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/remote-instrument-dev/latest.yaml"
    echo "CURRENT_VERSION: $CURRENT_VERSION"
    echo "SAMPLE_APP_VERSION: $SAMPLE_APP_VERSION"
    echo "ACCOUNT: $ACCOUNT"
    echo "TEMPLATE_URL: $TEMPLATE_URL"
    echo "BUCKET: $BUCKET"
fi

echo "Done uploading the CloudFormation template!"
echo
echo "Here is the CloudFormation quick launch URL:"
echo "https://console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=datadog-remote-instrument&templateURL=${TEMPLATE_URL}"
echo
echo "Serverless Sample App release process complete!"

# if [ "$ACCOUNT" = "prod" ] ; then
#     echo "Create and merge a pull request with the version bumps:"
#     echo "https://github.com/DataDog/Serverless-Remote-Instrumentation/pull/new/$RELEASE_BRANCH"
#     echo "Create the release with the pushed tag in GitHub:"
#     echo "https://github.com/DataDog/Serverless-Remote-Instrumentation/releases/new?tag=v$SAMPLE_APP_VERSION&title=v$SAMPLE_APP_VERSION"
# fi
