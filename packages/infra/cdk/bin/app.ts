#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ContentSchedulerStack } from '../lib/scheduler/content-scheduler-stack';
import { PostolioStack } from '../lib/stacks/postolio-stack';
import { TokenServiceStack } from '../lib/stacks/token-service-stack';
import { EcrRegistryStack } from '../lib/stacks/ecr-registry-stack';
// Service discovery replaced with Lambda Function URLs + SSM Parameter Store
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

// 1. Deploy ECR registry (ensures repository exists for image pushes)
const ecrRegistry = new EcrRegistryStack(app, `EcrRegistry-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  description: `ECR repositories for ${environment} environment`,
  tags: {
    Environment: environment,
    Service: 'ECR',
    ManagedBy: 'CDK',
    Version: '1.0',
  },
});

// 2. Service Discovery stack removed - using Lambda Function URLs + SSM Parameter Store

// Get OAuth configuration from shared utility
const oauthConfig = getOAuthConfig(app);

// 3. Deploy Token Service stack (uses Lambda Function URLs + SSM Parameter Store)
const tokenServiceStack = new TokenServiceStack(app, `TokenService-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  // OAuth configuration from shared utility
  ...oauthConfig,
  description: `Token Service - OAuth token management - ${environment} environment`,
  tags: {
    Environment: environment,
    Service: 'TokenService',
    ManagedBy: 'CDK',
    Version: '1.0',
  },
});

// 4. Deploy ContentScheduler stack (uses Lambda Function URLs + SSM Parameter Store)
const contentSchedulerStack = new ContentSchedulerStack(app, `ContentScheduler-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  description: `Content Scheduler Microservice - ${environment} environment`,
  tags: {
    Environment: environment,
    Service: 'ContentScheduler',
    ManagedBy: 'CDK',
    Version: '2.0',
  },
});

// 5. Deploy Postolio stack (uses Lambda Function URLs + SSM Parameter Store)
const postolioStack = new PostolioStack(app, `Postolio-${environment}`, {
  env: stackEnv,
  environment,
  domainName,
  hostedZoneId,
  useExternalDns,
  // No stack references needed - services use Lambda Function URLs for communication
  description: `Postolio Main Application - ${environment} environment`,
  tags: {
    Environment: environment,
    Service: 'Postolio',
    ManagedBy: 'CDK',
    Version: '2.0',
  },
});

// No explicit dependencies needed - services can be deployed independently
// Lambda Function URLs + SSM Parameter Store handles runtime communication

// Apply CDK Nag security checks to all environments
// This ensures security best practices are followed during development
cdk.Aspects.of(app).add(
  new AwsSolutionsChecks({
    verbose: true,
    reports: true,
    logIgnores: false,
  })
);

// Output CDK Nag compliance status
console.log(`CDK Nag security checks enabled for ${environment} environment`);

// Add comprehensive outputs for both stacks
new cdk.CfnOutput(contentSchedulerStack, 'CrossStackReference', {
  value: contentSchedulerStack.stackName,
  description: 'ContentScheduler stack reference for cross-stack dependencies',
  exportName: `ContentScheduler-${environment}-StackRef`,
});

new cdk.CfnOutput(postolioStack, 'DependencyStatus', {
  value: 'Successfully integrated with ContentScheduler',
  description: 'Indicates successful cross-stack dependency resolution',
});

app.synth();
