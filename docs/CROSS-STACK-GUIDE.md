# Cross-Stack Dependencies in AWS CDK: Complete Guide

This guide demonstrates how to pass outputs from one CDK stack (ContentScheduler-dev) to another CDK stack (Postolio-dev) programmatically, with a focus on sharing API URLs, configuration, and establishing proper dependencies.

## 🎯 Overview

When building microservices architectures with AWS CDK, you often need to share resources and configuration between stacks. This guide covers:

1. **Stack Dependencies** - How to establish proper deployment order
2. **Resource Sharing** - Multiple patterns for sharing API URLs and configuration
3. **Secrets Management** - Secure configuration storage and access
4. **Best Practices** - Production-ready patterns and error handling

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Approach 1: Direct Stack References](#approach-1-direct-stack-references-recommended)
- [Approach 2: CloudFormation Exports/Imports](#approach-2-cloudformation-exportsimports)
- [Approach 3: Systems Manager Parameter Store](#approach-3-systems-manager-parameter-store)
- [Approach 4: Secrets Manager Cross-References](#approach-4-secrets-manager-cross-references)
- [Deployment Strategies](#deployment-strategies)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## 🚀 Quick Start

### Option 1: Unified Deployment (Recommended)

Deploy both stacks together with automatic dependency resolution:

```bash
# Deploy both stacks with cross-stack dependencies
npx cdk deploy --app "npx ts-node bin/unified-app.ts" --context environment=dev --all

# Or use the deployment script
./scripts/deploy-cross-stack.sh dev unified
```

### Option 2: Sequential Deployment

Deploy stacks one after another:

```bash
# Deploy scheduler first
npx cdk deploy ContentScheduler-dev --app "npx ts-node bin/scheduler-app.ts" --context environment=dev

# Deploy main application with imported values
npx cdk deploy Postolio-dev --app "npx ts-node bin/app.ts" --context environment=dev
```

## 📦 Approach 1: Direct Stack References (Recommended)

**Best for:** Single CDK application with multiple stacks

### Implementation

#### 1. ContentScheduler Stack (Source)

```typescript
// lib/scheduler/content-scheduler-stack.ts
export class ContentSchedulerStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ContentSchedulerStackProps) {
    super(scope, id, props);

    // Create API Gateway
    this.api = new apigateway.RestApi(this, "SchedulerApi", {
      restApiName: `postolio-scheduler-${props.environment}-api`,
    });

    this.apiEndpoint = this.api.url;

    // Export for CloudFormation cross-stack references
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: this.apiEndpoint,
      exportName: `postolio-scheduler-${props.environment}-api-endpoint`,
    });
  }
}
```

#### 2. Postolio Stack (Consumer)

```typescript
// lib/stacks/postolio-stack.ts
export interface PostolioStackProps extends cdk.StackProps {
  contentSchedulerStack?: ContentSchedulerStack; // Direct stack reference
}

export class PostolioStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PostolioStackProps) {
    super(scope, id, props);

    // Get API URL from direct stack reference or import
    const schedulerApiUrl = props.contentSchedulerStack
      ? props.contentSchedulerStack.apiEndpoint
      : cdk.Fn.importValue(`postolio-scheduler-${environment}-api-endpoint`);

    // Add to application secrets
    const appSecrets = new secretsmanager.Secret(this, "AppSecrets", {
      secretObjectValue: {
        schedulerApiUrl: cdk.SecretValue.unsafePlainText(schedulerApiUrl),
        schedulerApiKey: cdk.SecretValue.unsafePlainText("generated-key"),
        // ... other secrets
      },
    });
  }
}
```

#### 3. Unified App Deployment

```typescript
// bin/unified-app.ts
const app = new cdk.App();

// Deploy ContentScheduler first
const contentSchedulerStack = new ContentSchedulerStack(
  app,
  "ContentScheduler-dev",
  {
    environment: "dev",
  },
);

// Deploy Postolio with direct reference
const postolioStack = new PostolioStack(app, "Postolio-dev", {
  environment: "dev",
  contentSchedulerStack, // Pass direct reference
});

// Establish explicit dependency
postolioStack.addDependency(contentSchedulerStack);
```

### Advantages ✅

- Compile-time validation of dependencies
- Type-safe resource access
- Automatic dependency detection
- IDE autocompletion and refactoring support

### Disadvantages ❌

- Requires both stacks in the same CDK app
- Tight coupling between stacks
- Cannot deploy stacks independently

## 📡 Approach 2: CloudFormation Exports/Imports

**Best for:** Independent stack deployments and cross-region sharing

### Implementation

#### 1. Export from Source Stack

```typescript
export class ContentSchedulerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ContentSchedulerStackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, "SchedulerApi", {
      restApiName: "content-scheduler-api",
    });

    // Export values for cross-stack import
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: api.url,
      description: "Content Scheduler API endpoint",
      exportName: `postolio-scheduler-${props.environment}-api-endpoint`,
    });

    new cdk.CfnOutput(this, "ApiId", {
      value: api.restApiId,
      description: "Content Scheduler API ID",
      exportName: `postolio-scheduler-${props.environment}-api-id`,
    });
  }
}
```

#### 2. Import in Consumer Stack

```typescript
export class PostolioStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PostolioStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // Import values from ContentScheduler stack
    const schedulerApiUrl = cdk.Fn.importValue(
      `postolio-scheduler-${environment}-api-endpoint`,
    );
    const schedulerApiId = cdk.Fn.importValue(
      `postolio-scheduler-${environment}-api-id`,
    );

    // Use imported values
    const appSecrets = new secretsmanager.Secret(this, "AppSecrets", {
      secretObjectValue: {
        schedulerApiUrl: cdk.SecretValue.unsafePlainText(schedulerApiUrl),
        schedulerApiKey: cdk.SecretValue.unsafePlainText(
          generateApiKey(this, "scheduler"),
        ),
        userPoolId: cdk.SecretValue.unsafePlainText(userPoolId),
      },
    });

    // Reference imported API Gateway (if needed)
    const importedApi = apigateway.RestApi.fromRestApiId(
      this,
      "ImportedSchedulerApi",
      schedulerApiId,
    );
  }
}
```

### Deployment

```bash
# Deploy ContentScheduler first
npx cdk deploy ContentScheduler-dev

# Then deploy Postolio
npx cdk deploy Postolio-dev
```

### Advantages ✅

- Stacks can be deployed independently
- Cross-region support
- No tight coupling between stacks
- Values are cached in CloudFormation

### Disadvantages ❌

- Export names must be unique across the region
- Runtime dependency validation only
- Difficult to refactor export names
- Cannot delete exporting stack while consumers exist

## 🗃️ Approach 3: Systems Manager Parameter Store

**Best for:** Flexible configuration and external integrations

### Implementation

#### 1. Store Parameters in Source Stack

```typescript
export class ContentSchedulerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ContentSchedulerStackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, "SchedulerApi", {
      restApiName: "content-scheduler-api",
    });

    // Store in Parameter Store
    new ssm.StringParameter(this, "ApiUrlParameter", {
      parameterName: `/postolio/${this.stackName}/api-url`,
      stringValue: api.url,
      description: "ContentScheduler API URL",
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "ConfigParameter", {
      parameterName: `/postolio/${this.stackName}/config`,
      stringValue: JSON.stringify({
        apiUrl: api.url,
        apiId: api.restApiId,
        version: "v1",
        timeout: 30000,
        endpoints: {
          health: `${api.url}health`,
          schedules: `${api.url}schedules`,
          auth: `${api.url}auth`,
        },
      }),
      description: "ContentScheduler configuration",
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
```

#### 2. Retrieve Parameters in Consumer Stack

```typescript
export class PostolioStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PostolioStackProps) {
    super(scope, id, props);

    const schedulerStackName = `ContentScheduler-${props.environment}`;

    // Read from Parameter Store
    const schedulerApiUrl = ssm.StringParameter.valueFromLookup(
      this,
      `/postolio/${schedulerStackName}/api-url`,
    );

    const schedulerConfig = ssm.StringParameter.valueFromLookup(
      this,
      `/postolio/${schedulerStackName}/config`,
    );

    // Use parameter values
    const appSecrets = new secretsmanager.Secret(this, "AppSecrets", {
      secretObjectValue: {
        schedulerApiUrl: cdk.SecretValue.unsafePlainText(schedulerApiUrl),
        schedulerConfig: cdk.SecretValue.unsafePlainText(schedulerConfig),
      },
    });
  }
}
```

### Advantages ✅

- Flexible parameter management
- Supports hierarchical organization
- External applications can read parameters
- Version history available
- Cross-account access possible

### Disadvantages ❌

- Requires Parameter Store permissions
- valueFromLookup() happens at synthesis time
- Additional AWS service dependency
- Limited to 4KB per parameter

## 🔐 Approach 4: Secrets Manager Cross-References

**Best for:** Secure configuration and credential sharing

### Implementation

#### 1. Create Shared Configuration Secret

```typescript
export class ContentSchedulerStack extends cdk.Stack {
  public readonly configSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: ContentSchedulerStackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, "SchedulerApi", {
      restApiName: "content-scheduler-api",
    });

    // Create shared configuration secret
    this.configSecret = new secretsmanager.Secret(this, "SchedulerConfig", {
      description: "ContentScheduler configuration and credentials",
      secretObjectValue: {
        apiUrl: cdk.SecretValue.unsafePlainText(api.url),
        apiId: cdk.SecretValue.unsafePlainText(api.restApiId),
        apiKey: cdk.SecretValue.unsafePlainText(
          generateApiKey(this, "scheduler"),
        ),
        version: cdk.SecretValue.unsafePlainText("v1"),
        endpoints: cdk.SecretValue.unsafePlainText(
          JSON.stringify({
            health: `${api.url}health`,
            schedules: `${api.url}schedules`,
            auth: `${api.url}auth`,
          }),
        ),
      },
    });

    // Export secret ARN
    new cdk.CfnOutput(this, "ConfigSecretArn", {
      value: this.configSecret.secretArn,
      description: "ContentScheduler configuration secret ARN",
      exportName: `postolio-scheduler-${props.environment}-config-secret-arn`,
    });
  }
}
```

#### 2. Import and Use Shared Secret

```typescript
export class PostolioStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PostolioStackProps) {
    super(scope, id, props);

    // Import secret ARN from ContentScheduler stack
    const configSecretArn = cdk.Fn.importValue(
      `postolio-scheduler-${props.environment}-config-secret-arn`,
    );

    // Reference the imported secret
    const schedulerConfig = secretsmanager.Secret.fromSecretArn(
      this,
      "ImportedSchedulerConfig",
      configSecretArn,
    );

    // Create application secrets that reference scheduler config
    const appSecrets = new secretsmanager.Secret(this, "AppSecrets", {
      secretObjectValue: {
        // Reference values from shared secret
        schedulerApiUrl: schedulerConfig.secretValueFromJson("apiUrl"),
        schedulerApiKey: schedulerConfig.secretValueFromJson("apiKey"),
        schedulerEndpoints: schedulerConfig.secretValueFromJson("endpoints"),

        // Add application-specific secrets
        jwtSecret: cdk.SecretValue.unsafePlainText("your-jwt-secret"),
        openaiApiKey: cdk.SecretValue.unsafePlainText("your-openai-key"),
      },
    });

    // Grant ECS task role access to scheduler config
    // schedulerConfig.grantRead(ecsTaskRole);
  }
}
```

### Advantages ✅

- Secure credential storage and rotation
- Fine-grained access control
- Audit trail for secret access
- Cross-account sharing possible
- Automatic encryption

### Disadvantages ❌

- Additional cost per secret
- Requires IAM permissions for access
- More complex setup
- Potential performance impact from API calls

## 🚀 Deployment Strategies

### Strategy 1: Unified Deployment

Deploy both stacks together with a single command:

```bash
# Using unified app
npx cdk deploy --app "npx ts-node bin/unified-app.ts" --context environment=dev --all

# Using deployment script
./scripts/deploy-cross-stack.sh dev unified
```

### Strategy 2: Sequential Deployment

Deploy stacks one after another:

```bash
# Option A: Manual sequential deployment
npx cdk deploy ContentScheduler-dev --app "npx ts-node bin/scheduler-app.ts" --context environment=dev
npx cdk deploy Postolio-dev --app "npx ts-node bin/app.ts" --context environment=dev

# Option B: Using deployment script
./scripts/deploy-cross-stack.sh dev sequential
```

### Strategy 3: Independent Deployment with Imports

Deploy stacks independently using CloudFormation imports:

```bash
# Deploy scheduler first (whenever needed)
npx cdk deploy ContentScheduler-dev --app "npx ts-node bin/scheduler-app.ts"

# Deploy consumer later (uses imports)
npx cdk deploy Postolio-dev --app "npx ts-node bin/app.ts"
```

## 🏆 Best Practices

### 1. Choose the Right Approach

- **Direct References**: Single CDK app, strong coupling acceptable
- **CloudFormation Exports**: Independent deployments, same region
- **Parameter Store**: Flexible configuration, external access needed
- **Secrets Manager**: Sensitive configuration, security paramount

### 2. Naming Conventions

Use consistent naming for exports and parameters:

```typescript
// Good: Predictable and structured
const exportName = `${projectName}-${stackName}-${environment}-${resourceType}`;
// Example: postolio-scheduler-dev-api-endpoint

// Bad: Inconsistent or unclear
const exportName = `MyApiUrl123`;
```

### 3. Error Handling

Always validate imported values and provide fallbacks:

```typescript
const schedulerApiUrl = props.contentSchedulerStack
  ? props.contentSchedulerStack.apiEndpoint
  : process.env.SCHEDULER_API_URL || "https://placeholder-api.com";

// Validate the URL format
if (!schedulerApiUrl.startsWith("https://")) {
  throw new Error("Scheduler API URL must use HTTPS");
}
```

### 4. Documentation

Document your cross-stack dependencies:

```typescript
/**
 * PostolioStack depends on:
 * - ContentSchedulerStack: API URL via direct reference or export
 * - Required exports: postolio-scheduler-{env}-api-endpoint
 * - Required permissions: secretsmanager:GetSecretValue on scheduler config
 */
export class PostolioStack extends cdk.Stack {
  // ...
}
```

### 5. Testing

Test your cross-stack deployments in CI/CD:

```yaml
# .github/workflows/deploy.yml
- name: Deploy ContentScheduler
  run: npx cdk deploy ContentScheduler-dev --require-approval never

- name: Verify ContentScheduler exports
  run: |
    aws cloudformation describe-stacks --stack-name ContentScheduler-dev \
      --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
      --output text

- name: Deploy Postolio
  run: npx cdk deploy Postolio-dev --require-approval never
```

### 6. Security

Protect sensitive configuration:

```typescript
// Good: Use Secrets Manager for sensitive data
const appSecrets = new secretsmanager.Secret(this, "AppSecrets", {
  secretObjectValue: {
    apiKey: cdk.SecretValue.unsafePlainText(generateSecureKey()),
  },
});

// Bad: Expose sensitive data in CloudFormation outputs
new cdk.CfnOutput(this, "ApiKey", {
  value: "super-secret-key-123", // DON'T DO THIS!
});
```

## 🔧 Using the Cross-Stack Utils

The provided utilities simplify cross-stack operations:

```typescript
import {
  CrossStackConfigManager,
  SchedulerIntegration,
} from "../lib/utils/cross-stack-utils";

// In ContentScheduler stack
const configManager = new CrossStackConfigManager(
  this,
  "postolio",
  environment,
);
const schedulerIntegration = new SchedulerIntegration(configManager);

schedulerIntegration.exportSchedulerConfig(
  api.url,
  generateApiKey(this, "scheduler"),
  { health: `${api.url}health`, schedules: `${api.url}schedules` },
);

// In Postolio stack
const configManager = new CrossStackConfigManager(
  this,
  "postolio",
  environment,
);
const schedulerIntegration = new SchedulerIntegration(configManager);

const schedulerConfig = schedulerIntegration.importSchedulerConfig(
  "ContentScheduler-dev",
);
const appSecrets =
  schedulerIntegration.createAppSecretsWithScheduler(schedulerConfig);
```

## 🐛 Troubleshooting

### Common Issues and Solutions

#### 1. Export Not Found

```bash
Error: No export named postolio-scheduler-dev-api-endpoint found
```

**Solution:**

- Verify the ContentScheduler stack was deployed successfully
- Check export names match exactly (case-sensitive)
- Ensure you're in the same AWS region

```bash
# List all exports in the region
aws cloudformation list-exports
```

#### 2. Circular Dependencies

```bash
Error: Circular dependency between stacks detected
```

**Solution:**

- Remove direct references between stacks
- Use CloudFormation exports/imports instead
- Refactor shared resources into a separate stack

#### 3. Parameter Not Found (SSM)

```bash
Error: Parameter /postolio/ContentScheduler-dev/api-url not found
```

**Solution:**

- Ensure parameter was created in the source stack
- Verify parameter name spelling and path structure
- Check SSM Parameter Store in AWS console

#### 4. Secret Access Denied

```bash
Error: AccessDenied when calling GetSecretValue
```

**Solution:**

- Ensure IAM permissions include `secretsmanager:GetSecretValue`
- Verify secret ARN is correct
- Check resource-based policies on the secret

#### 5. Stack Update Blocked

```bash
Error: Export cannot be deleted as it is in use by another stack
```

**Solution:**

- Update dependent stacks first to remove import references
- Or use a blue-green deployment strategy
- Consider using Parameter Store instead of exports

## 📚 Additional Resources

- [AWS CDK Cross-Stack References](https://docs.aws.amazon.com/cdk/v2/guide/resources.html#resources_cross_stack_refs)
- [CloudFormation Exports and Imports](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-exports.html)
- [Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)

## 📝 Example Commands

```bash
# View all stack outputs
aws cloudformation describe-stacks --stack-name ContentScheduler-dev --query 'Stacks[0].Outputs'

# Test ContentScheduler API
curl -X GET $(aws cloudformation describe-stacks --stack-name ContentScheduler-dev --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' --output text)/health

# List Parameter Store parameters
aws ssm get-parameters-by-path --path "/postolio/" --recursive

# View secret values (requires permissions)
aws secretsmanager get-secret-value --secret-id postolio-scheduler-dev-config-secret

# Deploy with context variables
npx cdk deploy --context environment=prod --context domainName=postolio.example --all
```
