#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ContentSchedulerStackV2 } from '../lib/scheduler/content-scheduler-stack-v2';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

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

const stackName = `ContentScheduler-${environment}-v2`;

const stack = new ContentSchedulerStackV2(app, stackName, {
  env: envConfig[environment as keyof typeof envConfig],
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: alertEmail,
  description: `Content Scheduler Microservice V2 - ${environment} environment`,
  tags: {
    Environment: environment,
    Service: 'ContentScheduler',
    ManagedBy: 'CDK',
    Version: '2.0',
  },
});

// Apply CDK Nag checks
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Add stack-level suppressions for development environments
if (environment === 'dev') {
  NagSuppressions.addStackSuppressions(stack, [
    {
      id: 'AwsSolutions-APIG3',
      reason: 'WAF not required for development environment to reduce costs',
    },
    {
      id: 'AwsSolutions-COG1',
      reason: 'Cognito advanced security not required for development',
    },
    {
      id: 'AwsSolutions-COG2',
      reason: 'MFA not required for development environment',
    },
  ]);
}

// Add suppressions for CloudWatch Logs
NagSuppressions.addResourceSuppressionsByPath(
  stack,
  '/ContentScheduler-*/LogRetention*/ServiceRole/Resource',
  [
    {
      id: 'AwsSolutions-IAM4',
      reason: 'CDK Custom Resource for log retention uses AWS managed policies',
      appliesTo: [
        'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      ],
    },
  ]
);

// Add suppressions for CDK custom resources
NagSuppressions.addResourceSuppressionsByPath(
  stack,
  '/ContentScheduler-*/AWS*/ServiceRole/Resource',
  [
    {
      id: 'AwsSolutions-IAM4',
      reason: 'CDK Custom Resources use AWS managed policies',
      appliesTo: [
        'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      ],
    },
    {
      id: 'AwsSolutions-IAM5',
      reason: 'CDK Custom Resources require wildcard permissions',
      appliesTo: ['Resource::*'],
    },
  ]
);

// Add suppressions for secret rotation Lambda
NagSuppressions.addResourceSuppressionsByPath(
  stack,
  '/ContentScheduler-*/PlatformCredentials/RotationLambda/ServiceRole/Resource',
  [
    {
      id: 'AwsSolutions-IAM4',
      reason: 'Secret rotation Lambda uses AWS managed policies',
      appliesTo: [
        'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      ],
    },
  ]
);

app.synth();