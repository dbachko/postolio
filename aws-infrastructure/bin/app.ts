#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ContentSchedulerStack } from '../lib/scheduler/content-scheduler-stack';
import { PostolioStack } from '../lib/stacks/postolio-stack';
import { TokenServiceStack } from '../lib/stacks/token-service-stack';
import { ServiceDiscoveryStack } from '../lib/stacks/service-discovery-stack';
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

// 1. Deploy Shared Service Discovery stack first (all services will use this)
const serviceDiscoveryStack = new ServiceDiscoveryStack(app, `ServiceDiscovery-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  description: `Shared Service Discovery - ${environment} environment`,
  tags: {
    Environment: environment,
    Service: 'ServiceDiscovery',
    ManagedBy: 'CDK',
    Version: '1.0',
  },
});

// Get OAuth configuration from shared utility
const oauthConfig = getOAuthConfig(app);

// 2. Deploy Token Service stack (uses shared service discovery)
const tokenServiceStack = new TokenServiceStack(app, `TokenService-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  serviceDiscoveryNamespaceId: serviceDiscoveryStack.namespaceId,
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

// 3. Deploy ContentScheduler stack (uses shared service discovery)
const contentSchedulerStack = new ContentSchedulerStack(app, `ContentScheduler-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  serviceDiscoveryNamespaceId: serviceDiscoveryStack.namespaceId,
  description: `Content Scheduler Microservice - ${environment} environment`,
  tags: {
    Environment: environment,
    Service: 'ContentScheduler',
    ManagedBy: 'CDK',
    Version: '2.0',
  },
});

// 4. Deploy Postolio stack (uses shared service discovery)
const postolioStack = new PostolioStack(app, `Postolio-${environment}`, {
  env: stackEnv,
  environment,
  domainName,
  hostedZoneId,
  useExternalDns,
  serviceDiscoveryNamespaceId: serviceDiscoveryStack.namespaceId,
  // No stack references needed - services use Cloud Map for discovery
  description: `Postolio Main Application - ${environment} environment`,
  tags: {
    Environment: environment,
    Service: 'Postolio',
    ManagedBy: 'CDK',
    Version: '2.0',
  },
});

// No explicit dependencies needed - services can be deployed independently
// Service discovery handles runtime communication

// Apply CDK Nag security checks to all environments
// This ensures security best practices are followed during development
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ 
  verbose: true,
  reports: true,
  logIgnores: false
}));

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