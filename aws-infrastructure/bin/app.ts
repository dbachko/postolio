#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AiAgencyStack } from '../lib/stacks/ai-agency-stack';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';
const account = app.node.tryGetContext('account');
const region = app.node.tryGetContext('region') || 'us-east-1';

new AiAgencyStack(app, `AiAgency-${environment}`, {
  env: {
    account: account,
    region: region,
  },
  environment,
});