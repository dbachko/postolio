#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { AwsSolutionsChecks } from 'cdk-nag'
import { PostolioStack } from '../lib/stacks/postolio-stack'
import { ContentSchedulerStack } from '../lib/scheduler/content-scheduler-stack'

const app = new cdk.App()

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev'
const account = app.node.tryGetContext('account')
const region = app.node.tryGetContext('region') || 'us-east-1'

// Custom domain configuration
const domainName = app.node.tryGetContext('domainName')
const hostedZoneId = app.node.tryGetContext('hostedZoneId')

// Create ContentScheduler stack first
const schedulerStack = new ContentSchedulerStack(app, `ContentScheduler-${environment}`, {
  env: {
    account: account,
    region: region,
  },
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail: app.node.tryGetContext('alertEmail'),
})

// Create Postolio stack with reference to scheduler
const stack = new PostolioStack(app, `Postolio-${environment}`, {
  env: {
    account: account,
    region: region,
  },
  environment,
  domainName,
  hostedZoneId,
  contentSchedulerStack: schedulerStack,
})

// Apply CDK Nag security checks only for production
if (environment === 'prod') {
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))
}
