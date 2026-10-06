# Serverless Remote Instrumentation

The [remote instrumentation for AWS Lambda](https://docs.datadoghq.com/serverless/aws_lambda/remote_instrumentation/) feature allows you to easily bulk-instrument your lambda functions with Datadog.

This repository contains the remote instrumentation template and remote instrumenter lambda code for Datadog's Lambda Remote Instrumentation feature. The template can be found [here](https://github.com/DataDog/serverless-remote-instrumentation/blob/prod/template.yaml), and the remote instrumenter lambda code can be found [here](https://github.com/DataDog/serverless-remote-instrumentation/tree/prod/src).

New versions of remote instrumentation are published under [GitHub Releases](https://github.com/DataDog/serverless-remote-instrumentation/releases).

## Configuring the Datadog API key

The template accepts the Datadog API key either as plaintext (`DdApiKey`) or as a Secrets Manager secret (`DdApiKeySecretArn`). Exactly one of the two must be set.

| Parameter                 | Instrumented functions receive                      |
| ------------------------- | --------------------------------------------------- |
| `DdApiKey`                | `DD_API_KEY` set to the plaintext key               |
| `DdApiKeySecretArn`       | `DD_API_KEY_SECRET_ARN` set to the secret's ARN     |
| `DdApiKeySecretKmsKeyArn` | Optional, used with `DdApiKeySecretArn` (see below) |

### Using an AWS Secrets Manager secret

Store the API key as a **plaintext** secret value (not a JSON key/value pair), then pass its ARN as `DdApiKeySecretArn`. The plaintext key is never written to your functions' configuration; the Datadog Lambda Extension fetches it from Secrets Manager at startup.

The template grants the remote instrumenter permission to read the secret, but it does not modify the IAM roles of the functions it instruments. **Each instrumented function's execution role must be able to call `secretsmanager:GetSecretValue` on the secret.** If it can't, the function keeps running but its telemetry is dropped. One way to grant this to every function in the account without editing each role is a resource policy on the secret:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "aws:PrincipalAccount": "<YOUR_ACCOUNT_ID>" }
      }
    }
  ]
}
```

### Secrets encrypted with a customer managed KMS key

If the secret is encrypted with a customer managed KMS key rather than the default `aws/secretsmanager` key, also pass the key's ARN (not an alias) as `DdApiKeySecretKmsKeyArn`. The template grants the remote instrumenter `kms:Decrypt` on that key for Secrets Manager use. As with the secret itself, each instrumented function's execution role must also be allowed to call `kms:Decrypt` on the key, for example through the key policy:

```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "*" },
  "Action": "kms:Decrypt",
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "aws:PrincipalAccount": "<YOUR_ACCOUNT_ID>",
      "kms:ViaService": "secretsmanager.<SECRET_REGION>.amazonaws.com"
    }
  }
}
```

### Switching or rotating the key

When you update the stack to change how the key is provided (for example, from `DdApiKey` to `DdApiKeySecretArn`) or to point at a different secret, the stack update makes the remote instrumenter recheck every function it has instrumented on its next scheduled run (within about 5 minutes). Each function ends up with only the newly configured key source; any other Datadog API key variables (`DD_API_KEY`, `DD_API_KEY_SECRET_ARN`, `DD_API_KEY_SSM_ARN`, `DD_KMS_API_KEY`) are removed. Functions you instrumented manually are not touched.

Rotating the value _inside_ an existing secret requires no stack update, since functions keep referencing the same ARN.

Changing only the value of `DdApiKey` does not trigger that recheck, because the template never passes the plaintext key to anything CloudFormation compares between updates. Functions pick up the new key the next time they are rechecked for another reason, such as an instrumentation configuration change or an update to the function. Use `DdApiKeySecretArn` if you rotate keys regularly.
