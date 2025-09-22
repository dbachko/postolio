#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { EcrRegistryStack } from '../lib/stacks/ecr-registry-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { SchedulingStack } from '../lib/stacks/scheduling-stack';
import { PublishingStack } from '../lib/stacks/publishing-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { WebStack } from '../lib/stacks/web-stack';
import { getOAuthConfig } from '../lib/utils/oauth-config';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';
const alertEmail = app.node.tryGetContext('alertEmail');

// Custom domain configuration for Postolio stack
const domainName = app.node.tryGetContext('domainName');
const hostedZoneId = app.node.tryGetContext('hostedZoneId');
const useExternalDns = app.node.tryGetContext('useExternalDns') || false;

// Environment-specific configuration
const envConfig = {
  dev: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  staging: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  prod: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
};

const stackEnv = envConfig[environment as keyof typeof envConfig];
const stackTags = {
  Environment: environment,
  ManagedBy: 'CDK',
  Version: '2.0',
};

// Get OAuth configuration from shared utility
const oauthConfig = getOAuthConfig(app);

// 1. Foundation Stack - ECR and shared infrastructure
const foundationStack = new EcrRegistryStack(app, `Foundation-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  description: `Foundation infrastructure - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Foundation',
  },
});

// 2. Auth Stack - token-service microservice
const authStack = new AuthStack(app, `Auth-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  ...oauthConfig,
  description: `Authentication services - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Auth',
  },
});

// 3. Scheduling Stack - schedule-management, schedule-cleanup, status-sync
const schedulingStack = new SchedulingStack(app, `Scheduling-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  description: `Content scheduling services - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Scheduling',
  },
});

// 4. Publishing Stack - publisher, retry-handler, dlq-processor, campaign-event-dlq-processor
const publishingStack = new PublishingStack(app, `Publishing-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  ...oauthConfig,
  description: `Content publishing services - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Publishing',
  },
});

// 5. API Stack - Backend API (ECS)
const apiStack = new ApiStack(app, `API-${environment}`, {
  env: stackEnv,
  environment,
  domainName,
  hostedZoneId,
  useExternalDns,
  description: `Backend API - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'API',
  },
});

// 6. Web Stack - Frontend (React)
const webStack = new WebStack(app, `Web-${environment}`, {
  env: stackEnv,
  environment,
  description: `Frontend application - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Web',
  },
});

// Stack Dependencies
// Auth stack needs foundation for ECR
authStack.addDependency(foundationStack);
// Scheduling stack can reference auth stack for token services
schedulingStack.addDependency(authStack);
// Publishing stack needs auth for tokens and scheduling for coordination
publishingStack.addDependency(authStack);
publishingStack.addDependency(schedulingStack);
// API stack needs foundation and all microservices to be deployed
apiStack.addDependency(foundationStack);
apiStack.addDependency(authStack);
apiStack.addDependency(schedulingStack);
apiStack.addDependency(publishingStack);
// Web stack needs API to be deployed (for API URLs)
webStack.addDependency(apiStack);

// Apply CDK Nag security checks
cdk.Aspects.of(app).add(
  new AwsSolutionsChecks({
    verbose: true,
    reports: true,
    logIgnores: false,
  })
);

// Output stack references for cross-stack communication
new cdk.CfnOutput(authStack, 'AuthStackReference', {
  value: authStack.stackName,
  description: 'Auth stack reference for cross-stack dependencies',
  exportName: `Auth-${environment}-StackRef`,
});

new cdk.CfnOutput(schedulingStack, 'SchedulingStackReference', {
  value: schedulingStack.stackName,
  description: 'Scheduling stack reference for cross-stack dependencies',
  exportName: `Scheduling-${environment}-StackRef`,
});

new cdk.CfnOutput(publishingStack, 'PublishingStackReference', {
  value: publishingStack.stackName,
  description: 'Publishing stack reference for cross-stack dependencies',
  exportName: `Publishing-${environment}-StackRef`,
});

new cdk.CfnOutput(apiStack, 'ApiStackReference', {
  value: apiStack.stackName,
  description: 'API stack reference for cross-stack dependencies',
  exportName: `API-${environment}-StackRef`,
});

new cdk.CfnOutput(webStack, 'WebStackReference', {
  value: webStack.stackName,
  description: 'Web stack reference for cross-stack dependencies',
  exportName: `Web-${environment}-StackRef`,
});

console.log(`Optimized stack-based deployment configured for ${environment} environment`);

app.synth();