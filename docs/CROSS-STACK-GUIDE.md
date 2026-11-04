# Cross-stack configuration

CDK stacks share environment-specific resource IDs and endpoints through SSM Parameter Store. Parameter paths include the environment, such as `/postolio/{environment}/auth/token-service-url`.

- Stack definitions: `packages/infra/cdk/lib/stacks/`
- Shared helpers: `packages/infra/cdk/lib/utils/cross-stack-utils.ts`
- Runtime parameter client: `packages/libs/service-parameters/src/index.ts`
- CDK entry point and stack selection: `packages/infra/cdk/bin/app.ts`

## Adding a shared value

1. Publish the value from the stack that owns the resource.
2. Use an environment-specific parameter path.
3. Resolve it in the consuming stack or runtime client.
4. Grant the consumer access to the parameter and resource.
5. Include the owning stack in the deployment order.

Do not hardcode deployed resource IDs. Check existing stack conventions before adding a parameter.

## Troubleshooting

For a missing value, check the AWS account, region, environment path, and whether the owning stack has been deployed. For access errors, check both SSM permissions and the target resource's IAM policy.

See [deployment scripts](../scripts/README.md) for stack order and environment options.
