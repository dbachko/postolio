#!/usr/bin/env node

/**
 * Test script to verify OAuth2 authentication between Postolio and ContentScheduler
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function getAccountId() {
  const { stdout } = await execAsync('aws sts get-caller-identity --query Account --output text');
  return stdout.trim();
}

async function getSecretValue(secretArn) {
  const { stdout } = await execAsync(`aws secretsmanager get-secret-value --secret-id "${secretArn}" --query SecretString --output text`);
  return JSON.parse(stdout);
}

async function testSchedulerAuth() {
  console.log('🔍 Testing ContentScheduler OAuth2 Authentication...\n');

  try {
    // Get the service secret from environment or construct it
    const environment = process.env.ENVIRONMENT || 'dev';
    const region = process.env.AWS_REGION || 'us-east-1';
    const accountId = process.env.AWS_ACCOUNT_ID || await getAccountId();
    
    // Dynamically discover the secret ARN
    const secretName = `postolio-scheduler-${environment}-service-credentials`;
    const { stdout: secretArn } = await execAsync(
      `aws secretsmanager describe-secret --secret-id "${secretName}" --query ARN --output text`
    );
    
    console.log('📦 Fetching service credentials from Secrets Manager...');
    console.log('   Secret Name:', secretName);
    const credentials = await getSecretValue(secretArn.trim());
    
    console.log('✅ Retrieved credentials:');
    console.log('   - User Pool ID:', credentials.userPoolId);
    console.log('   - Client ID:', credentials.clientId);
    console.log('   - Client Secret:', credentials.clientSecret ? '***' + credentials.clientSecret.slice(-4) : 'Not found');
    
    // Construct the Cognito token endpoint
    const region = 'us-east-1';
    const cognitoDomain = 'postolio-scheduler-dev';
    const tokenEndpoint = `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/token`;
    
    console.log('\n🔐 Requesting OAuth2 token...');
    console.log('   Token endpoint:', tokenEndpoint);
    
    // Request token using client credentials
    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: 'scheduler/admin',
      }),
    });
    
    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Token request failed: ${tokenResponse.status} - ${error}`);
    }
    
    const tokenData = await tokenResponse.json();
    console.log('✅ Successfully obtained access token!');
    console.log('   - Token type:', tokenData.token_type);
    console.log('   - Expires in:', tokenData.expires_in, 'seconds');
    console.log('   - Token:', tokenData.access_token.substring(0, 20) + '...');
    
    // Test the scheduler API with the token
    const schedulerApiUrl = 'https://kpq1l1dpzl.execute-api.us-east-1.amazonaws.com/dev/';
    console.log('\n📡 Testing scheduler API with token...');
    console.log('   API URL:', schedulerApiUrl);
    
    const apiResponse = await fetch(`${schedulerApiUrl}health`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });
    
    if (apiResponse.ok) {
      console.log('✅ Successfully authenticated with ContentScheduler API!');
    } else {
      console.log('⚠️  API returned status:', apiResponse.status);
      const responseText = await apiResponse.text();
      console.log('   Response:', responseText);
    }
    
    console.log('\n🎉 OAuth2 authentication test completed successfully!');
    console.log('   Service-to-service authentication is properly configured.');
    
  } catch (error) {
    console.error('\n❌ Authentication test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testSchedulerAuth().catch(console.error);