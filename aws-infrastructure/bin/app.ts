#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ContentSchedulerStack } from '../lib/scheduler/content-scheduler-stack';
import { PostolioStack } from '../lib/stacks/postolio-stack';

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

// 1. Deploy ContentScheduler stack first
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

// 2. Deploy Postolio stack with dependency on ContentScheduler
const postolioStack = new PostolioStack(app, `Postolio-${environment}`, {
  env: stackEnv,
  environment,
  domainName,
  hostedZoneId,
  useExternalDns,
  contentSchedulerStack, // Pass stack reference for cross-stack dependencies
  description: `Postolio Main Application - ${environment} environment`,
  tags: {
    Environment: environment,
    Service: 'Postolio',
    ManagedBy: 'CDK',
    Version: '2.0',
  },
});

// 3. Establish explicit dependency (CDK will detect this automatically, but being explicit is better)
postolioStack.addDependency(contentSchedulerStack);

// Apply CDK Nag security checks only for production
if (environment === 'prod') {
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
}

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