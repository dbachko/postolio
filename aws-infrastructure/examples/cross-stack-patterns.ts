/**
 * Cross-Stack Dependencies in AWS CDK: Complete Examples
 * 
 * This file demonstrates various patterns for sharing resources between CDK stacks,
 * specifically focused on sharing API URLs and other configuration between stacks.
 */

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

// =====================================================================================
// PATTERN 1: Direct Stack References (Recommended for Single App)
// =====================================================================================

export class SourceStack extends cdk.Stack {
  public readonly apiEndpoint: string;
  public readonly apiGateway: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create API Gateway
    this.apiGateway = new apigateway.RestApi(this, 'Api', {
      restApiName: 'content-scheduler-api',
      description: 'Content Scheduler Microservice API',
    });

    // Store endpoint for direct reference
    this.apiEndpoint = this.apiGateway.url;

    // Export for CloudFormation cross-stack references
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.apiEndpoint,
      description: 'Content Scheduler API endpoint',
      exportName: `${this.stackName}-api-endpoint`,
    });
  }
}

export class ConsumerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, sourceStack: SourceStack, props?: cdk.StackProps) {
    super(scope, id, props);

    // APPROACH 1A: Direct property access (works within same CDK app)
    const apiUrl = sourceStack.apiEndpoint;

    // APPROACH 1B: Reference the actual resource (strongest coupling)
    const apiGateway = sourceStack.apiGateway;

    // Create secret with the API URL
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      description: 'Application secrets with ContentScheduler integration',
      secretObjectValue: {
        schedulerApiUrl: cdk.SecretValue.unsafePlainText(apiUrl),
        schedulerApiKey: cdk.SecretValue.unsafePlainText('generated-api-key'),
      },
    });

    // Output the successful integration
    new cdk.CfnOutput(this, 'SchedulerIntegration', {
      value: apiUrl,
      description: 'Successfully integrated ContentScheduler API',
    });
  }
}

// =====================================================================================
// PATTERN 2: CloudFormation Exports/Imports (Cross-App or Independent Deployments)
// =====================================================================================

export class ExportingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'content-scheduler-api',
    });

    // Export values for other stacks to import
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'Content Scheduler API endpoint',
      exportName: `${this.stackName}-api-endpoint`, // Must be unique across region
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: api.restApiId,
      description: 'Content Scheduler API ID',
      exportName: `${this.stackName}-api-id`,
    });
  }
}

export class ImportingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, exportingStackName: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import values from another stack
    const schedulerApiUrl = cdk.Fn.importValue(`${exportingStackName}-api-endpoint`);
    const schedulerApiId = cdk.Fn.importValue(`${exportingStackName}-api-id`);

    // Use imported values in resources
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      secretObjectValue: {
        schedulerApiUrl: cdk.SecretValue.unsafePlainText(schedulerApiUrl),
        // Generate API key based on stack information
        schedulerApiKey: cdk.SecretValue.unsafePlainText(
          cdk.Fn.select(0, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))
        ),
      },
    });

    // You can also reference the imported API Gateway
    const importedApi = apigateway.RestApi.fromRestApiId(this, 'ImportedApi', schedulerApiId);

    new cdk.CfnOutput(this, 'ImportedApiUrl', {
      value: schedulerApiUrl,
      description: 'Imported ContentScheduler API URL',
    });
  }
}

// =====================================================================================
// PATTERN 3: Systems Manager Parameter Store (Flexible, External Configuration)
// =====================================================================================

export class ParameterPublisherStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'content-scheduler-api',
    });

    // Store in Parameter Store
    new ssm.StringParameter(this, 'ApiUrlParameter', {
      parameterName: `/postolio/${this.stackName}/api-url`,
      stringValue: api.url,
      description: 'ContentScheduler API URL',
      tier: ssm.ParameterTier.STANDARD,
    });

    // Store additional configuration
    new ssm.StringParameter(this, 'ApiConfigParameter', {
      parameterName: `/postolio/${this.stackName}/config`,
      stringValue: JSON.stringify({
        apiUrl: api.url,
        apiId: api.restApiId,
        version: 'v1',
        timeout: 30000,
      }),
      description: 'ContentScheduler configuration',
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}

export class ParameterConsumerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, publisherStackName: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Read from Parameter Store
    const schedulerApiUrl = ssm.StringParameter.valueFromLookup(
      this, 
      `/postolio/${publisherStackName}/api-url`
    );

    // Create secret with parameter values
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      secretObjectValue: {
        schedulerApiUrl: cdk.SecretValue.unsafePlainText(schedulerApiUrl),
        schedulerApiKey: cdk.SecretValue.unsafePlainText('parameter-based-key'),
      },
    });

    new cdk.CfnOutput(this, 'ParameterBasedConfig', {
      value: schedulerApiUrl,
      description: 'API URL retrieved from Parameter Store',
    });
  }
}

// =====================================================================================
// PATTERN 4: Secrets Manager Cross-References (Secure Configuration)
// =====================================================================================

export class SecretPublisherStack extends cdk.Stack {
  public readonly configSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'content-scheduler-api',
    });

    // Create a shared configuration secret
    this.configSecret = new secretsmanager.Secret(this, 'SchedulerConfig', {
      description: 'ContentScheduler configuration and credentials',
      secretObjectValue: {
        apiUrl: cdk.SecretValue.unsafePlainText(api.url),
        apiId: cdk.SecretValue.unsafePlainText(api.restApiId),
        apiKey: cdk.SecretValue.unsafePlainText(
          // Generate a secure API key
          cdk.Fn.select(2, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))
        ),
        version: cdk.SecretValue.unsafePlainText('v1'),
      },
    });

    // Export secret ARN for other stacks
    new cdk.CfnOutput(this, 'ConfigSecretArn', {
      value: this.configSecret.secretArn,
      description: 'ContentScheduler configuration secret ARN',
      exportName: `${this.stackName}-config-secret-arn`,
    });
  }
}

export class SecretConsumerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, publisherStackName: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import secret ARN from another stack
    const configSecretArn = cdk.Fn.importValue(`${publisherStackName}-config-secret-arn`);

    // Reference the imported secret
    const schedulerConfig = secretsmanager.Secret.fromSecretCompleteArn(
      this, 
      'ImportedSchedulerConfig', 
      configSecretArn
    );

    // Use the secret values in your application
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      secretObjectValue: {
        // Reference values from the shared secret
        schedulerApiUrl: schedulerConfig.secretValueFromJson('apiUrl'),
        schedulerApiKey: schedulerConfig.secretValueFromJson('apiKey'),
        // Add your own secrets
        jwtSecret: cdk.SecretValue.unsafePlainText('your-jwt-secret'),
      },
    });

    new cdk.CfnOutput(this, 'SharedSecretIntegration', {
      value: 'Successfully integrated with shared ContentScheduler secret',
      description: 'Shared secret integration status',
    });
  }
}

// =====================================================================================
// BEST PRACTICES EXAMPLE: Production-Ready Cross-Stack Architecture
// =====================================================================================

interface CrossStackConfig {
  environment: 'dev' | 'staging' | 'prod';
  projectName: string;
  alertEmail?: string;
}

export class ProductionSourceStack extends cdk.Stack {
  public readonly apiEndpoint: string;
  public readonly configSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, config: CrossStackConfig, props?: cdk.StackProps) {
    super(scope, id, props);

    const { environment, projectName } = config;

    // Create API Gateway with environment-specific configuration
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${projectName}-${environment}-api`,
      description: `${projectName} API - ${environment} environment`,
      deployOptions: {
        stageName: environment,
        throttlingBurstLimit: environment === 'prod' ? 1000 : 100,
        throttlingRateLimit: environment === 'prod' ? 500 : 50,
      },
    });

    this.apiEndpoint = api.url;

    // Comprehensive configuration secret
    this.configSecret = new secretsmanager.Secret(this, 'Config', {
      description: `${projectName} configuration - ${environment}`,
      secretObjectValue: {
        apiUrl: cdk.SecretValue.unsafePlainText(api.url),
        apiId: cdk.SecretValue.unsafePlainText(api.restApiId),
        apiKey: cdk.SecretValue.unsafePlainText(
          // Generate environment-specific API key
          cdk.Fn.join('-', [
            environment,
            projectName,
            cdk.Fn.select(0, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))
          ])
        ),
        environment: cdk.SecretValue.unsafePlainText(environment),
        version: cdk.SecretValue.unsafePlainText('2.0'),
        endpoints: cdk.SecretValue.unsafePlainText(JSON.stringify({
          health: `${api.url}health`,
          schedules: `${api.url}schedules`,
          auth: `${api.url}auth`,
        })),
      },
    });

    // Multiple export strategies for maximum flexibility
    
    // 1. CloudFormation Exports
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.apiEndpoint,
      exportName: `${projectName}-${environment}-api-endpoint`,
    });

    new cdk.CfnOutput(this, 'ConfigSecretArn', {
      value: this.configSecret.secretArn,
      exportName: `${projectName}-${environment}-config-secret`,
    });

    // 2. Parameter Store
    new ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: `/${projectName}/${environment}/api/url`,
      stringValue: this.apiEndpoint,
    });

    // 3. Tagged outputs for discovery
    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('StackType', 'ContentScheduler');
  }
}

export class ProductionConsumerStack extends cdk.Stack {
  constructor(
    scope: Construct, 
    id: string, 
    sourceStack: ProductionSourceStack, 
    config: CrossStackConfig, 
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    const { environment, projectName } = config;

    // Import configuration from source stack
    const schedulerConfig = sourceStack.configSecret;

    // Create application secrets with integrated scheduler config
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      description: `${projectName} application secrets - ${environment}`,
      secretObjectValue: {
        // Scheduler integration
        schedulerApiUrl: schedulerConfig.secretValueFromJson('apiUrl'),
        schedulerApiKey: schedulerConfig.secretValueFromJson('apiKey'),
        schedulerEndpoints: schedulerConfig.secretValueFromJson('endpoints'),
        
        // Application-specific secrets
        jwtSecret: cdk.SecretValue.unsafePlainText(
          cdk.Fn.select(2, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))
        ),
        openaiApiKey: cdk.SecretValue.unsafePlainText('PLACEHOLDER_OPENAI_KEY'),
        environment: cdk.SecretValue.unsafePlainText(environment),
      },
    });

    // Grant the scheduler config secret read permissions to your application
    // (This would be done to your ECS task role or Lambda execution role)

    // Output integration status
    new cdk.CfnOutput(this, 'SchedulerIntegration', {
      value: sourceStack.apiEndpoint,
      description: 'ContentScheduler API integration endpoint',
    });

    new cdk.CfnOutput(this, 'ConfigurationStatus', {
      value: 'Successfully configured with ContentScheduler dependencies',
      description: 'Cross-stack integration status',
    });

    // Tag for resource discovery
    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('StackType', 'Application');
    cdk.Tags.of(this).add('DependsOn', sourceStack.stackName);
  }
}

// =====================================================================================
// DEPLOYMENT ORCHESTRATION EXAMPLE
// =====================================================================================

/**
 * Example of how to deploy stacks with dependencies in a single CDK app
 */
export function createCrossStackApp(): cdk.App {
  const app = new cdk.App();

  const environment = app.node.tryGetContext('environment') || 'dev';
  const projectName = 'postolio';
  const config: CrossStackConfig = { environment: environment as any, projectName };

  // Deploy source stack first
  const sourceStack = new ProductionSourceStack(
    app, 
    `${projectName}-scheduler-${environment}`, 
    config,
    {
      description: `ContentScheduler microservice - ${environment}`,
      tags: { Project: projectName, Environment: environment },
    }
  );

  // Deploy consumer stack with dependency
  const consumerStack = new ProductionConsumerStack(
    app, 
    `${projectName}-app-${environment}`, 
    sourceStack, 
    config,
    {
      description: `Postolio application - ${environment}`,
      tags: { Project: projectName, Environment: environment },
    }
  );

  // Explicit dependency (CDK detects this automatically, but being explicit is better)
  consumerStack.addDependency(sourceStack);

  return app;
}

/**
 * CLI Usage Examples:
 * 
 * 1. Deploy both stacks together:
 *    npx cdk deploy --app "npx ts-node examples/cross-stack-patterns.ts" --all
 * 
 * 2. Deploy with specific environment:
 *    npx cdk deploy --app "npx ts-node examples/cross-stack-patterns.ts" --context environment=prod --all
 * 
 * 3. Deploy only the source stack:
 *    npx cdk deploy postolio-scheduler-dev --app "npx ts-node examples/cross-stack-patterns.ts"
 * 
 * 4. Check differences:
 *    npx cdk diff --app "npx ts-node examples/cross-stack-patterns.ts" --all
 */

// Only execute if this file is run directly
if (require.main === module) {
  createCrossStackApp().synth();
}