"use strict";
/**
 * Cross-Stack Dependencies in AWS CDK: Complete Examples
 *
 * This file demonstrates various patterns for sharing resources between CDK stacks,
 * specifically focused on sharing API URLs and other configuration between stacks.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCrossStackApp = exports.ProductionConsumerStack = exports.ProductionSourceStack = exports.SecretConsumerStack = exports.SecretPublisherStack = exports.ParameterConsumerStack = exports.ParameterPublisherStack = exports.ImportingStack = exports.ExportingStack = exports.ConsumerStack = exports.SourceStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
// =====================================================================================
// PATTERN 1: Direct Stack References (Recommended for Single App)
// =====================================================================================
class SourceStack extends cdk.Stack {
    apiEndpoint;
    apiGateway;
    constructor(scope, id, props) {
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
exports.SourceStack = SourceStack;
class ConsumerStack extends cdk.Stack {
    constructor(scope, id, sourceStack, props) {
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
exports.ConsumerStack = ConsumerStack;
// =====================================================================================
// PATTERN 2: CloudFormation Exports/Imports (Cross-App or Independent Deployments)
// =====================================================================================
class ExportingStack extends cdk.Stack {
    constructor(scope, id, props) {
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
exports.ExportingStack = ExportingStack;
class ImportingStack extends cdk.Stack {
    constructor(scope, id, exportingStackName, props) {
        super(scope, id, props);
        // Import values from another stack
        const schedulerApiUrl = cdk.Fn.importValue(`${exportingStackName}-api-endpoint`);
        const schedulerApiId = cdk.Fn.importValue(`${exportingStackName}-api-id`);
        // Use imported values in resources
        const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
            secretObjectValue: {
                schedulerApiUrl: cdk.SecretValue.unsafePlainText(schedulerApiUrl),
                // Generate API key based on stack information
                schedulerApiKey: cdk.SecretValue.unsafePlainText(cdk.Fn.select(0, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))),
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
exports.ImportingStack = ImportingStack;
// =====================================================================================
// PATTERN 3: Systems Manager Parameter Store (Flexible, External Configuration)
// =====================================================================================
class ParameterPublisherStack extends cdk.Stack {
    constructor(scope, id, props) {
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
exports.ParameterPublisherStack = ParameterPublisherStack;
class ParameterConsumerStack extends cdk.Stack {
    constructor(scope, id, publisherStackName, props) {
        super(scope, id, props);
        // Read from Parameter Store
        const schedulerApiUrl = ssm.StringParameter.valueFromLookup(this, `/postolio/${publisherStackName}/api-url`);
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
exports.ParameterConsumerStack = ParameterConsumerStack;
// =====================================================================================
// PATTERN 4: Secrets Manager Cross-References (Secure Configuration)
// =====================================================================================
class SecretPublisherStack extends cdk.Stack {
    configSecret;
    constructor(scope, id, props) {
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
                cdk.Fn.select(2, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))),
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
exports.SecretPublisherStack = SecretPublisherStack;
class SecretConsumerStack extends cdk.Stack {
    constructor(scope, id, publisherStackName, props) {
        super(scope, id, props);
        // Import secret ARN from another stack
        const configSecretArn = cdk.Fn.importValue(`${publisherStackName}-config-secret-arn`);
        // Reference the imported secret
        const schedulerConfig = secretsmanager.Secret.fromSecretCompleteArn(this, 'ImportedSchedulerConfig', configSecretArn);
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
exports.SecretConsumerStack = SecretConsumerStack;
class ProductionSourceStack extends cdk.Stack {
    apiEndpoint;
    configSecret;
    constructor(scope, id, config, props) {
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
                ])),
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
exports.ProductionSourceStack = ProductionSourceStack;
class ProductionConsumerStack extends cdk.Stack {
    constructor(scope, id, sourceStack, config, props) {
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
                jwtSecret: cdk.SecretValue.unsafePlainText(cdk.Fn.select(2, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))),
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
exports.ProductionConsumerStack = ProductionConsumerStack;
// =====================================================================================
// DEPLOYMENT ORCHESTRATION EXAMPLE
// =====================================================================================
/**
 * Example of how to deploy stacks with dependencies in a single CDK app
 */
function createCrossStackApp() {
    const app = new cdk.App();
    const environment = app.node.tryGetContext('environment') || 'dev';
    const projectName = 'postolio';
    const config = { environment: environment, projectName };
    // Deploy source stack first
    const sourceStack = new ProductionSourceStack(app, `${projectName}-scheduler-${environment}`, config, {
        description: `ContentScheduler microservice - ${environment}`,
        tags: { Project: projectName, Environment: environment },
    });
    // Deploy consumer stack with dependency
    const consumerStack = new ProductionConsumerStack(app, `${projectName}-app-${environment}`, sourceStack, config, {
        description: `Postolio application - ${environment}`,
        tags: { Project: projectName, Environment: environment },
    });
    // Explicit dependency (CDK detects this automatically, but being explicit is better)
    consumerStack.addDependency(sourceStack);
    return app;
}
exports.createCrossStackApp = createCrossStackApp;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3Jvc3Mtc3RhY2stcGF0dGVybnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjcm9zcy1zdGFjay1wYXR0ZXJucy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsaURBQW1DO0FBQ25DLHVFQUF5RDtBQUN6RCwrRUFBaUU7QUFDakUseURBQTJDO0FBRzNDLHdGQUF3RjtBQUN4RixrRUFBa0U7QUFDbEUsd0ZBQXdGO0FBRXhGLE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hCLFdBQVcsQ0FBUztJQUNwQixVQUFVLENBQXFCO0lBRS9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIscUJBQXFCO1FBQ3JCLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDcEQsV0FBVyxFQUFFLHVCQUF1QjtZQUNwQyxXQUFXLEVBQUUsb0NBQW9DO1NBQ2xELENBQUMsQ0FBQztRQUVILHNDQUFzQztRQUN0QyxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDO1FBRXZDLG1EQUFtRDtRQUNuRCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUNyQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFdBQVc7WUFDdkIsV0FBVyxFQUFFLGdDQUFnQztZQUM3QyxVQUFVLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxlQUFlO1NBQzdDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXZCRCxrQ0F1QkM7QUFFRCxNQUFhLGFBQWMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMxQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFdBQXdC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LFdBQVcsR0FBRyxJQUFJLHFCQUFxQixDQUMzQyxHQUFHLEVBQ0gsR0FBRyxXQUFXLGNBQWMsV0FBVyxFQUFFLEVBQ3pDLE1BQU0sRUFDTjtRQUNFLFdBQVcsRUFBRSxtQ0FBbUMsV0FBVyxFQUFFO1FBQzdELElBQUksRUFBRSxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRTtLQUN6RCxDQUNGLENBQUM7SUFFRix3Q0FBd0M7SUFDeEMsTUFBTSxhQUFhLEdBQUcsSUFBSSx1QkFBdUIsQ0FDL0MsR0FBRyxFQUNILEdBQUcsV0FBVyxRQUFRLFdBQVcsRUFBRSxFQUNuQyxXQUFXLEVBQ1gsTUFBTSxFQUNOO1FBQ0UsV0FBVyxFQUFFLDBCQUEwQixXQUFXLEVBQUU7UUFDcEQsSUFBSSxFQUFFLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFO0tBQ3pELENBQ0YsQ0FBQztJQUVGLHFGQUFxRjtJQUNyRixhQUFhLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBRXpDLE9BQU8sR0FBRyxDQUFDO0FBQ2IsQ0FBQztBQWxDRCxrREFrQ0M7QUFFRDs7Ozs7Ozs7Ozs7Ozs7R0FjRztBQUVILDRDQUE0QztBQUM1QyxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssTUFBTSxFQUFFO0lBQzNCLG1CQUFtQixFQUFFLENBQUMsS0FBSyxFQUFFLENBQUM7Q0FDL0IiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENyb3NzLVN0YWNrIERlcGVuZGVuY2llcyBpbiBBV1MgQ0RLOiBDb21wbGV0ZSBFeGFtcGxlc1xuICogXG4gKiBUaGlzIGZpbGUgZGVtb25zdHJhdGVzIHZhcmlvdXMgcGF0dGVybnMgZm9yIHNoYXJpbmcgcmVzb3VyY2VzIGJldHdlZW4gQ0RLIHN0YWNrcyxcbiAqIHNwZWNpZmljYWxseSBmb2N1c2VkIG9uIHNoYXJpbmcgQVBJIFVSTHMgYW5kIG90aGVyIGNvbmZpZ3VyYXRpb24gYmV0d2VlbiBzdGFja3MuXG4gKi9cblxuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQQVRURVJOIDE6IERpcmVjdCBTdGFjayBSZWZlcmVuY2VzIChSZWNvbW1lbmRlZCBmb3IgU2luZ2xlIEFwcClcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNsYXNzIFNvdXJjZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGFwaUVuZHBvaW50OiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBhcGlHYXRld2F5OiBhcGlnYXRld2F5LlJlc3RBcGk7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gQ3JlYXRlIEFQSSBHYXRld2F5XG4gICAgdGhpcy5hcGlHYXRld2F5ID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQXBpJywge1xuICAgICAgcmVzdEFwaU5hbWU6ICdjb250ZW50LXNjaGVkdWxlci1hcGknLFxuICAgICAgZGVzY3JpcHRpb246ICdDb250ZW50IFNjaGVkdWxlciBNaWNyb3NlcnZpY2UgQVBJJyxcbiAgICB9KTtcblxuICAgIC8vIFN0b3JlIGVuZHBvaW50IGZvciBkaXJlY3QgcmVmZXJlbmNlXG4gICAgdGhpcy5hcGlFbmRwb2ludCA9IHRoaXMuYXBpR2F0ZXdheS51cmw7XG5cbiAgICAvLyBFeHBvcnQgZm9yIENsb3VkRm9ybWF0aW9uIGNyb3NzLXN0YWNrIHJlZmVyZW5jZXNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcGlFbmRwb2ludCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29udGVudCBTY2hlZHVsZXIgQVBJIGVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1hcGktZW5kcG9pbnRgLFxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBDb25zdW1lclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgc291cmNlU3RhY2s6IFNvdXJjZVN0YWNrLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBBUFBST0FDSCAxQTogRGlyZWN0IHByb3BlcnR5IGFjY2VzcyAod29ya3Mgd2l0aGluIHNhbWUgQ0RLIGFwcClcbiAgICBjb25zdCBhcGlVcmwgPSBzb3VyY2VTdGFjay5hcGlFbmRwb2ludDtcblxuICAgIC8vIEFQUFJPQUNIIDFCOiBSZWZlcmVuY2UgdGhlIGFjdHVhbCByZXNvdXJjZSAoc3Ryb25nZXN0IGNvdXBsaW5nKVxuICAgIGNvbnN0IGFwaUdhdGV3YXkgPSBzb3VyY2VTdGFjay5hcGlHYXRld2F5O1xuXG4gICAgLy8gQ3JlYXRlIHNlY3JldCB3aXRoIHRoZSBBUEkgVVJMXG4gICAgY29uc3QgYXBwU2VjcmV0cyA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ0FwcFNlY3JldHMnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcGxpY2F0aW9uIHNlY3JldHMgd2l0aCBDb250ZW50U2NoZWR1bGVyIGludGVncmF0aW9uJyxcbiAgICAgIHNlY3JldE9iamVjdFZhbHVlOiB7XG4gICAgICAgIHNjaGVkdWxlckFwaVVybDogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChhcGlVcmwpLFxuICAgICAgICBzY2hlZHVsZXJBcGlLZXk6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoJ2dlbmVyYXRlZC1hcGkta2V5JyksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0IHRoZSBzdWNjZXNzZnVsIGludGVncmF0aW9uXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NjaGVkdWxlckludGVncmF0aW9uJywge1xuICAgICAgdmFsdWU6IGFwaVVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3VjY2Vzc2Z1bGx5IGludGVncmF0ZWQgQ29udGVudFNjaGVkdWxlciBBUEknLFxuICAgIH0pO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBBVFRFUk4gMjogQ2xvdWRGb3JtYXRpb24gRXhwb3J0cy9JbXBvcnRzIChDcm9zcy1BcHAgb3IgSW5kZXBlbmRlbnQgRGVwbG95bWVudHMpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBjbGFzcyBFeHBvcnRpbmdTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ0FwaScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiAnY29udGVudC1zY2hlZHVsZXItYXBpJyxcbiAgICB9KTtcblxuICAgIC8vIEV4cG9ydCB2YWx1ZXMgZm9yIG90aGVyIHN0YWNrcyB0byBpbXBvcnRcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogYXBpLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29udGVudCBTY2hlZHVsZXIgQVBJIGVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1hcGktZW5kcG9pbnRgLCAvLyBNdXN0IGJlIHVuaXF1ZSBhY3Jvc3MgcmVnaW9uXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpSWQnLCB7XG4gICAgICB2YWx1ZTogYXBpLnJlc3RBcGlJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29udGVudCBTY2hlZHVsZXIgQVBJIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1hcGktaWRgLFxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBJbXBvcnRpbmdTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIGV4cG9ydGluZ1N0YWNrTmFtZTogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBJbXBvcnQgdmFsdWVzIGZyb20gYW5vdGhlciBzdGFja1xuICAgIGNvbnN0IHNjaGVkdWxlckFwaVVybCA9IGNkay5Gbi5pbXBvcnRWYWx1ZShgJHtleHBvcnRpbmdTdGFja05hbWV9LWFwaS1lbmRwb2ludGApO1xuICAgIGNvbnN0IHNjaGVkdWxlckFwaUlkID0gY2RrLkZuLmltcG9ydFZhbHVlKGAke2V4cG9ydGluZ1N0YWNrTmFtZX0tYXBpLWlkYCk7XG5cbiAgICAvLyBVc2UgaW1wb3J0ZWQgdmFsdWVzIGluIHJlc291cmNlc1xuICAgIGNvbnN0IGFwcFNlY3JldHMgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdBcHBTZWNyZXRzJywge1xuICAgICAgc2VjcmV0T2JqZWN0VmFsdWU6IHtcbiAgICAgICAgc2NoZWR1bGVyQXBpVXJsOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KHNjaGVkdWxlckFwaVVybCksXG4gICAgICAgIC8vIEdlbmVyYXRlIEFQSSBrZXkgYmFzZWQgb24gc3RhY2sgaW5mb3JtYXRpb25cbiAgICAgICAgc2NoZWR1bGVyQXBpS2V5OiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KFxuICAgICAgICAgIGNkay5Gbi5zZWxlY3QoMCwgY2RrLkZuLnNwbGl0KCctJywgY2RrLkZuLnNlbGVjdCgyLCBjZGsuRm4uc3BsaXQoJy8nLCBjZGsuQXdzLlNUQUNLX0lEKSkpKVxuICAgICAgICApLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFlvdSBjYW4gYWxzbyByZWZlcmVuY2UgdGhlIGltcG9ydGVkIEFQSSBHYXRld2F5XG4gICAgY29uc3QgaW1wb3J0ZWRBcGkgPSBhcGlnYXRld2F5LlJlc3RBcGkuZnJvbVJlc3RBcGlJZCh0aGlzLCAnSW1wb3J0ZWRBcGknLCBzY2hlZHVsZXJBcGlJZCk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSW1wb3J0ZWRBcGlVcmwnLCB7XG4gICAgICB2YWx1ZTogc2NoZWR1bGVyQXBpVXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdJbXBvcnRlZCBDb250ZW50U2NoZWR1bGVyIEFQSSBVUkwnLFxuICAgIH0pO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBBVFRFUk4gMzogU3lzdGVtcyBNYW5hZ2VyIFBhcmFtZXRlciBTdG9yZSAoRmxleGlibGUsIEV4dGVybmFsIENvbmZpZ3VyYXRpb24pXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBjbGFzcyBQYXJhbWV0ZXJQdWJsaXNoZXJTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ0FwaScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiAnY29udGVudC1zY2hlZHVsZXItYXBpJyxcbiAgICB9KTtcblxuICAgIC8vIFN0b3JlIGluIFBhcmFtZXRlciBTdG9yZVxuICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdBcGlVcmxQYXJhbWV0ZXInLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgL3Bvc3RvbGlvLyR7dGhpcy5zdGFja05hbWV9L2FwaS11cmxgLFxuICAgICAgc3RyaW5nVmFsdWU6IGFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvbnRlbnRTY2hlZHVsZXIgQVBJIFVSTCcsXG4gICAgICB0aWVyOiBzc20uUGFyYW1ldGVyVGllci5TVEFOREFSRCxcbiAgICB9KTtcblxuICAgIC8vIFN0b3JlIGFkZGl0aW9uYWwgY29uZmlndXJhdGlvblxuICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdBcGlDb25maWdQYXJhbWV0ZXInLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgL3Bvc3RvbGlvLyR7dGhpcy5zdGFja05hbWV9L2NvbmZpZ2AsXG4gICAgICBzdHJpbmdWYWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBhcGlVcmw6IGFwaS51cmwsXG4gICAgICAgIGFwaUlkOiBhcGkucmVzdEFwaUlkLFxuICAgICAgICB2ZXJzaW9uOiAndjEnLFxuICAgICAgICB0aW1lb3V0OiAzMDAwMCxcbiAgICAgIH0pLFxuICAgICAgZGVzY3JpcHRpb246ICdDb250ZW50U2NoZWR1bGVyIGNvbmZpZ3VyYXRpb24nLFxuICAgICAgdGllcjogc3NtLlBhcmFtZXRlclRpZXIuU1RBTkRBUkQsXG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFBhcmFtZXRlckNvbnN1bWVyU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwdWJsaXNoZXJTdGFja05hbWU6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gUmVhZCBmcm9tIFBhcmFtZXRlciBTdG9yZVxuICAgIGNvbnN0IHNjaGVkdWxlckFwaVVybCA9IHNzbS5TdHJpbmdQYXJhbWV0ZXIudmFsdWVGcm9tTG9va3VwKFxuICAgICAgdGhpcywgXG4gICAgICBgL3Bvc3RvbGlvLyR7cHVibGlzaGVyU3RhY2tOYW1lfS9hcGktdXJsYFxuICAgICk7XG5cbiAgICAvLyBDcmVhdGUgc2VjcmV0IHdpdGggcGFyYW1ldGVyIHZhbHVlc1xuICAgIGNvbnN0IGFwcFNlY3JldHMgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdBcHBTZWNyZXRzJywge1xuICAgICAgc2VjcmV0T2JqZWN0VmFsdWU6IHtcbiAgICAgICAgc2NoZWR1bGVyQXBpVXJsOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KHNjaGVkdWxlckFwaVVybCksXG4gICAgICAgIHNjaGVkdWxlckFwaUtleTogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgncGFyYW1ldGVyLWJhc2VkLWtleScpLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQYXJhbWV0ZXJCYXNlZENvbmZpZycsIHtcbiAgICAgIHZhbHVlOiBzY2hlZHVsZXJBcGlVcmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBVUkwgcmV0cmlldmVkIGZyb20gUGFyYW1ldGVyIFN0b3JlJyxcbiAgICB9KTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQQVRURVJOIDQ6IFNlY3JldHMgTWFuYWdlciBDcm9zcy1SZWZlcmVuY2VzIChTZWN1cmUgQ29uZmlndXJhdGlvbilcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNsYXNzIFNlY3JldFB1Ymxpc2hlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGNvbmZpZ1NlY3JldDogc2VjcmV0c21hbmFnZXIuU2VjcmV0O1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ0FwaScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiAnY29udGVudC1zY2hlZHVsZXItYXBpJyxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBhIHNoYXJlZCBjb25maWd1cmF0aW9uIHNlY3JldFxuICAgIHRoaXMuY29uZmlnU2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnU2NoZWR1bGVyQ29uZmlnJywge1xuICAgICAgZGVzY3JpcHRpb246ICdDb250ZW50U2NoZWR1bGVyIGNvbmZpZ3VyYXRpb24gYW5kIGNyZWRlbnRpYWxzJyxcbiAgICAgIHNlY3JldE9iamVjdFZhbHVlOiB7XG4gICAgICAgIGFwaVVybDogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChhcGkudXJsKSxcbiAgICAgICAgYXBpSWQ6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoYXBpLnJlc3RBcGlJZCksXG4gICAgICAgIGFwaUtleTogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChcbiAgICAgICAgICAvLyBHZW5lcmF0ZSBhIHNlY3VyZSBBUEkga2V5XG4gICAgICAgICAgY2RrLkZuLnNlbGVjdCgyLCBjZGsuRm4uc3BsaXQoJy0nLCBjZGsuRm4uc2VsZWN0KDIsIGNkay5Gbi5zcGxpdCgnLycsIGNkay5Bd3MuU1RBQ0tfSUQpKSkpXG4gICAgICAgICksXG4gICAgICAgIHZlcnNpb246IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoJ3YxJyksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gRXhwb3J0IHNlY3JldCBBUk4gZm9yIG90aGVyIHN0YWNrc1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDb25maWdTZWNyZXRBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jb25maWdTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdDb250ZW50U2NoZWR1bGVyIGNvbmZpZ3VyYXRpb24gc2VjcmV0IEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tY29uZmlnLXNlY3JldC1hcm5gLFxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBTZWNyZXRDb25zdW1lclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHVibGlzaGVyU3RhY2tOYW1lOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIEltcG9ydCBzZWNyZXQgQVJOIGZyb20gYW5vdGhlciBzdGFja1xuICAgIGNvbnN0IGNvbmZpZ1NlY3JldEFybiA9IGNkay5Gbi5pbXBvcnRWYWx1ZShgJHtwdWJsaXNoZXJTdGFja05hbWV9LWNvbmZpZy1zZWNyZXQtYXJuYCk7XG5cbiAgICAvLyBSZWZlcmVuY2UgdGhlIGltcG9ydGVkIHNlY3JldFxuICAgIGNvbnN0IHNjaGVkdWxlckNvbmZpZyA9IHNlY3JldHNtYW5hZ2VyLlNlY3JldC5mcm9tU2VjcmV0Q29tcGxldGVBcm4oXG4gICAgICB0aGlzLCBcbiAgICAgICdJbXBvcnRlZFNjaGVkdWxlckNvbmZpZycsIFxuICAgICAgY29uZmlnU2VjcmV0QXJuXG4gICAgKTtcblxuICAgIC8vIFVzZSB0aGUgc2VjcmV0IHZhbHVlcyBpbiB5b3VyIGFwcGxpY2F0aW9uXG4gICAgY29uc3QgYXBwU2VjcmV0cyA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ0FwcFNlY3JldHMnLCB7XG4gICAgICBzZWNyZXRPYmplY3RWYWx1ZToge1xuICAgICAgICAvLyBSZWZlcmVuY2UgdmFsdWVzIGZyb20gdGhlIHNoYXJlZCBzZWNyZXRcbiAgICAgICAgc2NoZWR1bGVyQXBpVXJsOiBzY2hlZHVsZXJDb25maWcuc2VjcmV0VmFsdWVGcm9tSnNvbignYXBpVXJsJyksXG4gICAgICAgIHNjaGVkdWxlckFwaUtleTogc2NoZWR1bGVyQ29uZmlnLnNlY3JldFZhbHVlRnJvbUpzb24oJ2FwaUtleScpLFxuICAgICAgICAvLyBBZGQgeW91ciBvd24gc2VjcmV0c1xuICAgICAgICBqd3RTZWNyZXQ6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoJ3lvdXItand0LXNlY3JldCcpLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTaGFyZWRTZWNyZXRJbnRlZ3JhdGlvbicsIHtcbiAgICAgIHZhbHVlOiAnU3VjY2Vzc2Z1bGx5IGludGVncmF0ZWQgd2l0aCBzaGFyZWQgQ29udGVudFNjaGVkdWxlciBzZWNyZXQnLFxuICAgICAgZGVzY3JpcHRpb246ICdTaGFyZWQgc2VjcmV0IGludGVncmF0aW9uIHN0YXR1cycsXG4gICAgfSk7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQkVTVCBQUkFDVElDRVMgRVhBTVBMRTogUHJvZHVjdGlvbi1SZWFkeSBDcm9zcy1TdGFjayBBcmNoaXRlY3R1cmVcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuaW50ZXJmYWNlIENyb3NzU3RhY2tDb25maWcge1xuICBlbnZpcm9ubWVudDogJ2RldicgfCAnc3RhZ2luZycgfCAncHJvZCc7XG4gIHByb2plY3ROYW1lOiBzdHJpbmc7XG4gIGFsZXJ0RW1haWw/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBQcm9kdWN0aW9uU291cmNlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpRW5kcG9pbnQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IGNvbmZpZ1NlY3JldDogc2VjcmV0c21hbmFnZXIuU2VjcmV0O1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIGNvbmZpZzogQ3Jvc3NTdGFja0NvbmZpZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZpcm9ubWVudCwgcHJvamVjdE5hbWUgfSA9IGNvbmZpZztcblxuICAgIC8vIENyZWF0ZSBBUEkgR2F0ZXdheSB3aXRoIGVudmlyb25tZW50LXNwZWNpZmljIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdBcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogYCR7cHJvamVjdE5hbWV9LSR7ZW52aXJvbm1lbnR9LWFwaWAsXG4gICAgICBkZXNjcmlwdGlvbjogYCR7cHJvamVjdE5hbWV9IEFQSSAtICR7ZW52aXJvbm1lbnR9IGVudmlyb25tZW50YCxcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgc3RhZ2VOYW1lOiBlbnZpcm9ubWVudCxcbiAgICAgICAgdGhyb3R0bGluZ0J1cnN0TGltaXQ6IGVudmlyb25tZW50ID09PSAncHJvZCcgPyAxMDAwIDogMTAwLFxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gNTAwIDogNTAsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hcGlFbmRwb2ludCA9IGFwaS51cmw7XG5cbiAgICAvLyBDb21wcmVoZW5zaXZlIGNvbmZpZ3VyYXRpb24gc2VjcmV0XG4gICAgdGhpcy5jb25maWdTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdDb25maWcnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogYCR7cHJvamVjdE5hbWV9IGNvbmZpZ3VyYXRpb24gLSAke2Vudmlyb25tZW50fWAsXG4gICAgICBzZWNyZXRPYmplY3RWYWx1ZToge1xuICAgICAgICBhcGlVcmw6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoYXBpLnVybCksXG4gICAgICAgIGFwaUlkOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KGFwaS5yZXN0QXBpSWQpLFxuICAgICAgICBhcGlLZXk6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoXG4gICAgICAgICAgLy8gR2VuZXJhdGUgZW52aXJvbm1lbnQtc3BlY2lmaWMgQVBJIGtleVxuICAgICAgICAgIGNkay5Gbi5qb2luKCctJywgW1xuICAgICAgICAgICAgZW52aXJvbm1lbnQsXG4gICAgICAgICAgICBwcm9qZWN0TmFtZSxcbiAgICAgICAgICAgIGNkay5Gbi5zZWxlY3QoMCwgY2RrLkZuLnNwbGl0KCctJywgY2RrLkZuLnNlbGVjdCgyLCBjZGsuRm4uc3BsaXQoJy8nLCBjZGsuQXdzLlNUQUNLX0lEKSkpKVxuICAgICAgICAgIF0pXG4gICAgICAgICksXG4gICAgICAgIGVudmlyb25tZW50OiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KGVudmlyb25tZW50KSxcbiAgICAgICAgdmVyc2lvbjogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnMi4wJyksXG4gICAgICAgIGVuZHBvaW50czogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgaGVhbHRoOiBgJHthcGkudXJsfWhlYWx0aGAsXG4gICAgICAgICAgc2NoZWR1bGVzOiBgJHthcGkudXJsfXNjaGVkdWxlc2AsXG4gICAgICAgICAgYXV0aDogYCR7YXBpLnVybH1hdXRoYCxcbiAgICAgICAgfSkpLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIE11bHRpcGxlIGV4cG9ydCBzdHJhdGVnaWVzIGZvciBtYXhpbXVtIGZsZXhpYmlsaXR5XG4gICAgXG4gICAgLy8gMS4gQ2xvdWRGb3JtYXRpb24gRXhwb3J0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFwaUVuZHBvaW50LFxuICAgICAgZXhwb3J0TmFtZTogYCR7cHJvamVjdE5hbWV9LSR7ZW52aXJvbm1lbnR9LWFwaS1lbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29uZmlnU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuY29uZmlnU2VjcmV0LnNlY3JldEFybixcbiAgICAgIGV4cG9ydE5hbWU6IGAke3Byb2plY3ROYW1lfS0ke2Vudmlyb25tZW50fS1jb25maWctc2VjcmV0YCxcbiAgICB9KTtcblxuICAgIC8vIDIuIFBhcmFtZXRlciBTdG9yZVxuICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdBcGlVcmxQYXJhbScsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAvJHtwcm9qZWN0TmFtZX0vJHtlbnZpcm9ubWVudH0vYXBpL3VybGAsXG4gICAgICBzdHJpbmdWYWx1ZTogdGhpcy5hcGlFbmRwb2ludCxcbiAgICB9KTtcblxuICAgIC8vIDMuIFRhZ2dlZCBvdXRwdXRzIGZvciBkaXNjb3ZlcnlcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ1Byb2plY3QnLCBwcm9qZWN0TmFtZSk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50KTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ1N0YWNrVHlwZScsICdDb250ZW50U2NoZWR1bGVyJyk7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFByb2R1Y3Rpb25Db25zdW1lclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3IoXG4gICAgc2NvcGU6IENvbnN0cnVjdCwgXG4gICAgaWQ6IHN0cmluZywgXG4gICAgc291cmNlU3RhY2s6IFByb2R1Y3Rpb25Tb3VyY2VTdGFjaywgXG4gICAgY29uZmlnOiBDcm9zc1N0YWNrQ29uZmlnLCBcbiAgICBwcm9wcz86IGNkay5TdGFja1Byb3BzXG4gICkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZpcm9ubWVudCwgcHJvamVjdE5hbWUgfSA9IGNvbmZpZztcblxuICAgIC8vIEltcG9ydCBjb25maWd1cmF0aW9uIGZyb20gc291cmNlIHN0YWNrXG4gICAgY29uc3Qgc2NoZWR1bGVyQ29uZmlnID0gc291cmNlU3RhY2suY29uZmlnU2VjcmV0O1xuXG4gICAgLy8gQ3JlYXRlIGFwcGxpY2F0aW9uIHNlY3JldHMgd2l0aCBpbnRlZ3JhdGVkIHNjaGVkdWxlciBjb25maWdcbiAgICBjb25zdCBhcHBTZWNyZXRzID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnQXBwU2VjcmV0cycsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiBgJHtwcm9qZWN0TmFtZX0gYXBwbGljYXRpb24gc2VjcmV0cyAtICR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIHNlY3JldE9iamVjdFZhbHVlOiB7XG4gICAgICAgIC8vIFNjaGVkdWxlciBpbnRlZ3JhdGlvblxuICAgICAgICBzY2hlZHVsZXJBcGlVcmw6IHNjaGVkdWxlckNvbmZpZy5zZWNyZXRWYWx1ZUZyb21Kc29uKCdhcGlVcmwnKSxcbiAgICAgICAgc2NoZWR1bGVyQXBpS2V5OiBzY2hlZHVsZXJDb25maWcuc2VjcmV0VmFsdWVGcm9tSnNvbignYXBpS2V5JyksXG4gICAgICAgIHNjaGVkdWxlckVuZHBvaW50czogc2NoZWR1bGVyQ29uZmlnLnNlY3JldFZhbHVlRnJvbUpzb24oJ2VuZHBvaW50cycpLFxuICAgICAgICBcbiAgICAgICAgLy8gQXBwbGljYXRpb24tc3BlY2lmaWMgc2VjcmV0c1xuICAgICAgICBqd3RTZWNyZXQ6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoXG4gICAgICAgICAgY2RrLkZuLnNlbGVjdCgyLCBjZGsuRm4uc3BsaXQoJy0nLCBjZGsuRm4uc2VsZWN0KDIsIGNkay5Gbi5zcGxpdCgnLycsIGNkay5Bd3MuU1RBQ0tfSUQpKSkpXG4gICAgICAgICksXG4gICAgICAgIG9wZW5haUFwaUtleTogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnUExBQ0VIT0xERVJfT1BFTkFJX0tFWScpLFxuICAgICAgICBlbnZpcm9ubWVudDogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChlbnZpcm9ubWVudCksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgdGhlIHNjaGVkdWxlciBjb25maWcgc2VjcmV0IHJlYWQgcGVybWlzc2lvbnMgdG8geW91ciBhcHBsaWNhdGlvblxuICAgIC8vIChUaGlzIHdvdWxkIGJlIGRvbmUgdG8geW91ciBFQ1MgdGFzayByb2xlIG9yIExhbWJkYSBleGVjdXRpb24gcm9sZSlcblxuICAgIC8vIE91dHB1dCBpbnRlZ3JhdGlvbiBzdGF0dXNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2NoZWR1bGVySW50ZWdyYXRpb24nLCB7XG4gICAgICB2YWx1ZTogc291cmNlU3RhY2suYXBpRW5kcG9pbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvbnRlbnRTY2hlZHVsZXIgQVBJIGludGVncmF0aW9uIGVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDb25maWd1cmF0aW9uU3RhdHVzJywge1xuICAgICAgdmFsdWU6ICdTdWNjZXNzZnVsbHkgY29uZmlndXJlZCB3aXRoIENvbnRlbnRTY2hlZHVsZXIgZGVwZW5kZW5jaWVzJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3Jvc3Mtc3RhY2sgaW50ZWdyYXRpb24gc3RhdHVzJyxcbiAgICB9KTtcblxuICAgIC8vIFRhZyBmb3IgcmVzb3VyY2UgZGlzY292ZXJ5XG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdQcm9qZWN0JywgcHJvamVjdE5hbWUpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdTdGFja1R5cGUnLCAnQXBwbGljYXRpb24nKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0RlcGVuZHNPbicsIHNvdXJjZVN0YWNrLnN0YWNrTmFtZSk7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gREVQTE9ZTUVOVCBPUkNIRVNUUkFUSU9OIEVYQU1QTEVcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFeGFtcGxlIG9mIGhvdyB0byBkZXBsb3kgc3RhY2tzIHdpdGggZGVwZW5kZW5jaWVzIGluIGEgc2luZ2xlIENESyBhcHBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUNyb3NzU3RhY2tBcHAoKTogY2RrLkFwcCB7XG4gIGNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbiAgY29uc3QgZW52aXJvbm1lbnQgPSBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpIHx8ICdkZXYnO1xuICBjb25zdCBwcm9qZWN0TmFtZSA9ICdwb3N0b2xpbyc7XG4gIGNvbnN0IGNvbmZpZzogQ3Jvc3NTdGFja0NvbmZpZyA9IHsgZW52aXJvbm1lbnQ6IGVudmlyb25tZW50IGFzIGFueSwgcHJvamVjdE5hbWUgfTtcblxuICAvLyBEZXBsb3kgc291cmNlIHN0YWNrIGZpcnN0XG4gIGNvbnN0IHNvdXJjZVN0YWNrID0gbmV3IFByb2R1Y3Rpb25Tb3VyY2VTdGFjayhcbiAgICBhcHAsIFxuICAgIGAke3Byb2plY3ROYW1lfS1zY2hlZHVsZXItJHtlbnZpcm9ubWVudH1gLCBcbiAgICBjb25maWcsXG4gICAge1xuICAgICAgZGVzY3JpcHRpb246IGBDb250ZW50U2NoZWR1bGVyIG1pY3Jvc2VydmljZSAtICR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIHRhZ3M6IHsgUHJvamVjdDogcHJvamVjdE5hbWUsIEVudmlyb25tZW50OiBlbnZpcm9ubWVudCB9LFxuICAgIH1cbiAgKTtcblxuICAvLyBEZXBsb3kgY29uc3VtZXIgc3RhY2sgd2l0aCBkZXBlbmRlbmN5XG4gIGNvbnN0IGNvbnN1bWVyU3RhY2sgPSBuZXcgUHJvZHVjdGlvbkNvbnN1bWVyU3RhY2soXG4gICAgYXBwLCBcbiAgICBgJHtwcm9qZWN0TmFtZX0tYXBwLSR7ZW52aXJvbm1lbnR9YCwgXG4gICAgc291cmNlU3RhY2ssIFxuICAgIGNvbmZpZyxcbiAgICB7XG4gICAgICBkZXNjcmlwdGlvbjogYFBvc3RvbGlvIGFwcGxpY2F0aW9uIC0gJHtlbnZpcm9ubWVudH1gLFxuICAgICAgdGFnczogeyBQcm9qZWN0OiBwcm9qZWN0TmFtZSwgRW52aXJvbm1lbnQ6IGVudmlyb25tZW50IH0sXG4gICAgfVxuICApO1xuXG4gIC8vIEV4cGxpY2l0IGRlcGVuZGVuY3kgKENESyBkZXRlY3RzIHRoaXMgYXV0b21hdGljYWxseSwgYnV0IGJlaW5nIGV4cGxpY2l0IGlzIGJldHRlcilcbiAgY29uc3VtZXJTdGFjay5hZGREZXBlbmRlbmN5KHNvdXJjZVN0YWNrKTtcblxuICByZXR1cm4gYXBwO1xufVxuXG4vKipcbiAqIENMSSBVc2FnZSBFeGFtcGxlczpcbiAqIFxuICogMS4gRGVwbG95IGJvdGggc3RhY2tzIHRvZ2V0aGVyOlxuICogICAgbnB4IGNkayBkZXBsb3kgLS1hcHAgXCJucHggdHMtbm9kZSBleGFtcGxlcy9jcm9zcy1zdGFjay1wYXR0ZXJucy50c1wiIC0tYWxsXG4gKiBcbiAqIDIuIERlcGxveSB3aXRoIHNwZWNpZmljIGVudmlyb25tZW50OlxuICogICAgbnB4IGNkayBkZXBsb3kgLS1hcHAgXCJucHggdHMtbm9kZSBleGFtcGxlcy9jcm9zcy1zdGFjay1wYXR0ZXJucy50c1wiIC0tY29udGV4dCBlbnZpcm9ubWVudD1wcm9kIC0tYWxsXG4gKiBcbiAqIDMuIERlcGxveSBvbmx5IHRoZSBzb3VyY2Ugc3RhY2s6XG4gKiAgICBucHggY2RrIGRlcGxveSBwb3N0b2xpby1zY2hlZHVsZXItZGV2IC0tYXBwIFwibnB4IHRzLW5vZGUgZXhhbXBsZXMvY3Jvc3Mtc3RhY2stcGF0dGVybnMudHNcIlxuICogXG4gKiA0LiBDaGVjayBkaWZmZXJlbmNlczpcbiAqICAgIG5weCBjZGsgZGlmZiAtLWFwcCBcIm5weCB0cy1ub2RlIGV4YW1wbGVzL2Nyb3NzLXN0YWNrLXBhdHRlcm5zLnRzXCIgLS1hbGxcbiAqL1xuXG4vLyBPbmx5IGV4ZWN1dGUgaWYgdGhpcyBmaWxlIGlzIHJ1biBkaXJlY3RseVxuaWYgKHJlcXVpcmUubWFpbiA9PT0gbW9kdWxlKSB7XG4gIGNyZWF0ZUNyb3NzU3RhY2tBcHAoKS5zeW50aCgpO1xufSJdfQ==