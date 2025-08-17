#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ContentSchedulerStack } from '../lib/scheduler/content-scheduler-stack';
// import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';
const alertEmail = app.node.tryGetContext('alertEmail');

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

const stackName = `ContentScheduler-${environment}`;

const stack = new ContentSchedulerStack(app, stackName, {
  env: envConfig[environment as keyof typeof envConfig],
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

// CDK Nag checks temporarily disabled for development deployment
// TODO: Re-enable with proper suppressions for production deployment
// cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

app.synth();