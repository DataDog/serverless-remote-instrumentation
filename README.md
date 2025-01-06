
# Serverless Remote Instrumentation
This Repo owned by Serverless Onboarding and Enablement team contains the code for...
- The AWS Remote Instrumenter Lambda function
- "self-monitoring" app that's meant for testing the remote instrumentation feature
- Scripts for publishing the built instrumenter code as layers

### What is Remote Instrumentation?
Remote Instrumentation is a feature that's built by the Serverless Onboarding and Enablement team to let users set up Datadog monitoring on their Lambda functions automatically. Users would configure tag based rules for targetting selected lambda functions which will then be instrumented to send enhanced metrics, logs and traces to Datadog.

**Note:** Datadog's Web UI will have a page under Serverless views that will be used to configure targetting rules. The code for that page will be found inside the Web UI repo.

### AWS Remote Instrumenter Lambda
This is a lambda function that will be deployed in the customers' accounts. This lambda function will be provided the targetting rules based on which it will instrument other lambda functions. It uses datadog-ci commands under the hood to perform necessary instrumentation operations.
