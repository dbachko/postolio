#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { AwsSolutionsChecks } from 'cdk-nag'
import { PostolioStack } from '../lib/stacks/postolio-stack'

const app = new cdk.App()

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev'
const account = app.node.tryGetContext('account')
const region = app.node.tryGetContext('region') || 'us-east-1'

// Custom domain configuration
const domainName = app.node.tryGetContext('domainName')
const hostedZoneId = app.node.tryGetContext('hostedZoneId')

const stack = new PostolioStack(app, `Postolio-${environment}`, {
  env: {
    account: account,
    region: region,
  },
  environment,
  domainName,
  hostedZoneId,
})

// Apply CDK Nag security checks only for production
if (environment === 'prod') {
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))
}
