#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { PostolioStack } from '../lib/stacks/postolio-stack'

const app = new cdk.App()

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev'
const account = app.node.tryGetContext('account')
const region = app.node.tryGetContext('region') || 'us-east-1'

// Custom domain configuration
const domainName = app.node.tryGetContext('domainName')
const hostedZoneId = app.node.tryGetContext('hostedZoneId')

new PostolioStack(app, `Postolio-${environment}`, {
  env: {
    account: account,
    region: region,
  },
  environment,
  domainName,
  hostedZoneId,
})
