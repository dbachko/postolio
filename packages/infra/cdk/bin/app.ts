#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { FoundationStack } from '../lib/stacks/foundation-stack';
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
const imageTag = app.node.tryGetContext('imageTag') as string | undefined;

// Custom domain configuration for Postolio stack
const resolveContext = <T>(key: string, envKey?: string): T | undefined => {
  const contextValue = app.node.tryGetContext(key);
  if (contextValue !== undefined) {
    return contextValue as T;
  }

  const resolvedEnvKey = envKey ?? key.toUpperCase();
  const envValue = process.env[resolvedEnvKey];
  return (envValue as unknown as T) ?? undefined;
};

const domainName = resolveContext<string>('domainName', 'DOMAIN_NAME');
const hostedZoneId = resolveContext<string>('hostedZoneId', 'HOSTED_ZONE_ID');
const hostedZoneName = resolveContext<string>('hostedZoneName', 'HOSTED_ZONE_NAME');
const webCertificateArn = resolveContext<string>('webCertificateArn', 'WEB_CERTIFICATE_ARN');

const useExternalDnsContext = resolveContext<string | boolean>(
  'useExternalDns',
  'USE_EXTERNAL_DNS'
);
const useExternalDns =
  typeof useExternalDnsContext === 'boolean'
    ? useExternalDnsContext
    : typeof useExternalDnsContext === 'string'
      ? ['true', '1', 'yes'].includes(useExternalDnsContext.toLowerCase())
      : false;

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

// 1. Foundation Stack - VPC, Database, Cache, ECR, and all shared infrastructure
const foundationStack = new FoundationStack(app, `Postolio-Foundation-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  enableVpcFlowLogs: environment === 'prod',
  enableDatabaseProxy: true,
  description: `Postolio Foundation infrastructure - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Foundation',
  },
});

// 2. Auth Stack - token-service microservice
const authStack = new AuthStack(app, `Postolio-Auth-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  domainName,
  ...oauthConfig,
  description: `Postolio Authentication services - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Auth',
  },
});

// 3. Scheduling Stack - schedule-management, schedule-cleanup, status-sync
const schedulingStack = new SchedulingStack(app, `Postolio-Scheduling-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  description: `Postolio Content scheduling services - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Scheduling',
  },
});

// 4. Publishing Stack - publisher, retry-handler, dlq-processor, campaign-event-dlq-processor
const publishingStack = new PublishingStack(app, `Postolio-Publishing-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  ...oauthConfig,
  description: `Postolio Content publishing services - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Publishing',
  },
});

// 5. API Stack - Backend API (ECS)
const apiStack = new ApiStack(app, `Postolio-API-${environment}`, {
  env: stackEnv,
  environment,
  domainName,
  hostedZoneId,
  hostedZoneName,
  useExternalDns,
  openaiApiKey: app.node.tryGetContext('openaiApiKey'),
  imageTag,
  ...oauthConfig,
  description: `Postolio Backend API - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'API',
  },
});

// 6. Web Stack - Frontend (React)
const webStack = new WebStack(app, `Postolio-Web-${environment}`, {
  env: stackEnv,
  environment,
  domainName,
  hostedZoneId,
  hostedZoneName,
  useExternalDns,
  certificateArn: webCertificateArn,
  description: `Postolio Frontend application - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Web',
  },
});

// Stack Dependencies - Optimized for parallel deployment with Foundation as base
// All stacks depend on Foundation for shared infrastructure
authStack.addDependency(foundationStack);
schedulingStack.addDependency(foundationStack);
publishingStack.addDependency(foundationStack);
apiStack.addDependency(foundationStack);
webStack.addDependency(foundationStack);

// Service-specific dependencies
schedulingStack.addDependency(authStack);
publishingStack.addDependency(authStack);
publishingStack.addDependency(schedulingStack);

// Web needs API for the load balancer URL (for CloudFront API proxy)
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
  description: 'Postolio Auth stack reference for cross-stack dependencies',
  exportName: `Postolio-Auth-${environment}-StackRef`,
});

new cdk.CfnOutput(schedulingStack, 'SchedulingStackReference', {
  value: schedulingStack.stackName,
  description: 'Postolio Scheduling stack reference for cross-stack dependencies',
  exportName: `Postolio-Scheduling-${environment}-StackRef`,
});

new cdk.CfnOutput(publishingStack, 'PublishingStackReference', {
  value: publishingStack.stackName,
  description: 'Postolio Publishing stack reference for cross-stack dependencies',
  exportName: `Postolio-Publishing-${environment}-StackRef`,
});

new cdk.CfnOutput(apiStack, 'ApiStackReference', {
  value: apiStack.stackName,
  description: 'Postolio API stack reference for cross-stack dependencies',
  exportName: `Postolio-API-${environment}-StackRef`,
});

new cdk.CfnOutput(webStack, 'WebStackReference', {
  value: webStack.stackName,
  description: 'Postolio Web stack reference for cross-stack dependencies',
  exportName: `Postolio-Web-${environment}-StackRef`,
});

console.log(`Optimized stack-based deployment configured for ${environment} environment`);

app.synth();
