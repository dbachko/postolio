#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { PlatformMicroservicesStack } from '../lib/stacks/platform-microservices-stack'

const app = new cdk.App()

// Get environment from context or default to dev
const environment = app.node.tryGetContext('environment') || 'dev'
const alertEmail = app.node.tryGetContext('alertEmail')

// Validate environment
if (!['dev', 'staging', 'prod'].includes(environment)) {
  throw new Error(`Invalid environment: ${environment}. Must be dev, staging, or prod.`)
}

// Stack configuration based on environment
const stackProps = {
  dev: {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    description: 'Postolio Platform Microservices - Development',
    tags: {
      Environment: 'dev',
      Project: 'Postolio',
      ManagedBy: 'CDK',
      Service: 'PlatformMicroservices',
    },
  },
  staging: {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    description: 'Postolio Platform Microservices - Staging',
    tags: {
      Environment: 'staging',
      Project: 'Postolio',
      ManagedBy: 'CDK',
      Service: 'PlatformMicroservices',
    },
  },
  prod: {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    description: 'Postolio Platform Microservices - Production',
    tags: {
      Environment: 'prod',
      Project: 'Postolio',
      ManagedBy: 'CDK',
      Service: 'PlatformMicroservices',
      CostCenter: 'Engineering',
    },
  },
}

// Create the stack
new PlatformMicroservicesStack(app, `Postolio-Platform-${environment}`, {
  ...stackProps[environment as keyof typeof stackProps],
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail,
  // Public OAuth Client IDs (from GitHub Environment Variables)
  facebookAppId: app.node.tryGetContext('facebookAppId') || process.env.FACEBOOK_APP_ID,
  instagramAppId: app.node.tryGetContext('instagramAppId') || process.env.INSTAGRAM_APP_ID,
  linkedinClientId: app.node.tryGetContext('linkedinClientId') || process.env.LINKEDIN_CLIENT_ID,
  tiktokClientKey: app.node.tryGetContext('tiktokClientKey') || process.env.TIKTOK_CLIENT_KEY,
  // OAuth Secrets (from GitHub Secrets)
  facebookAppSecret: app.node.tryGetContext('facebookAppSecret') || process.env.FACEBOOK_APP_SECRET,
  instagramAppSecret: app.node.tryGetContext('instagramAppSecret') || process.env.INSTAGRAM_APP_SECRET,
  linkedinClientSecret: app.node.tryGetContext('linkedinClientSecret') || process.env.LINKEDIN_CLIENT_SECRET,
  tiktokClientSecret: app.node.tryGetContext('tiktokClientSecret') || process.env.TIKTOK_CLIENT_SECRET,
})

app.synth()