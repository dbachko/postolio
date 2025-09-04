#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { PlatformMicroservicesStack } from '../lib/stacks/platform-microservices-stack'
import { getOAuthConfig } from '../lib/utils/oauth-config'

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

// Get OAuth configuration from shared utility
const oauthConfig = getOAuthConfig(app)

// Create the stack
new PlatformMicroservicesStack(app, `Postolio-Platform-${environment}`, {
  ...stackProps[environment as keyof typeof stackProps],
  environment: environment as 'dev' | 'staging' | 'prod',
  alertEmail,
  ...oauthConfig, // Spread OAuth configuration
})

app.synth()