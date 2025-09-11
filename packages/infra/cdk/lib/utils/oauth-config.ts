/**
 * Shared OAuth Configuration Utility
 * Centralizes OAuth credential mapping across CDK stacks
 */

import * as cdk from 'aws-cdk-lib';

export interface OAuthConfig {
  // Public OAuth Client IDs (from GitHub Environment Variables)
  facebookAppId?: string;
  instagramAppId?: string;
  linkedinClientId?: string;
  tiktokClientKey?: string;

  // OAuth Secrets (from GitHub Secrets)
  facebookAppSecret?: string;
  instagramAppSecret?: string;
  linkedinClientSecret?: string;
  tiktokClientSecret?: string;
}

/**
 * Get OAuth configuration from CDK context and environment variables
 * @param app CDK App instance
 * @returns OAuth configuration object
 */
export function getOAuthConfig(app: cdk.App): OAuthConfig {
  return {
    // Public OAuth Client IDs (from GitHub Environment Variables via CDK context)
    facebookAppId: app.node.tryGetContext('facebookAppId') || process.env.FACEBOOK_APP_ID,
    instagramAppId: app.node.tryGetContext('instagramAppId') || process.env.INSTAGRAM_APP_ID,
    linkedinClientId: app.node.tryGetContext('linkedinClientId') || process.env.LINKEDIN_CLIENT_ID,
    tiktokClientKey: app.node.tryGetContext('tiktokClientKey') || process.env.TIKTOK_CLIENT_KEY,

    // OAuth Secrets (from GitHub Secrets via CDK context)
    facebookAppSecret:
      app.node.tryGetContext('facebookAppSecret') || process.env.FACEBOOK_APP_SECRET,
    instagramAppSecret:
      app.node.tryGetContext('instagramAppSecret') || process.env.INSTAGRAM_APP_SECRET,
    linkedinClientSecret:
      app.node.tryGetContext('linkedinClientSecret') || process.env.LINKEDIN_CLIENT_SECRET,
    tiktokClientSecret:
      app.node.tryGetContext('tiktokClientSecret') || process.env.TIKTOK_CLIENT_SECRET,
  };
}

/**
 * Get OAuth environment variables for Lambda/ECS
 * @param config OAuth configuration
 * @returns Environment variables object for Lambda/ECS
 */
export function getOAuthEnvironmentVariables(config: OAuthConfig): Record<string, string> {
  return {
    // Public OAuth Client IDs
    FACEBOOK_APP_ID: config.facebookAppId || '',
    INSTAGRAM_APP_ID: config.instagramAppId || '',
    LINKEDIN_CLIENT_ID: config.linkedinClientId || '',
    TIKTOK_CLIENT_KEY: config.tiktokClientKey || '',

    // OAuth Secrets (only if provided)
    ...(config.facebookAppSecret && {
      FACEBOOK_APP_SECRET: config.facebookAppSecret,
    }),
    ...(config.instagramAppSecret && {
      INSTAGRAM_APP_SECRET: config.instagramAppSecret,
    }),
    ...(config.linkedinClientSecret && {
      LINKEDIN_CLIENT_SECRET: config.linkedinClientSecret,
    }),
    ...(config.tiktokClientSecret && {
      TIKTOK_CLIENT_SECRET: config.tiktokClientSecret,
    }),
  };
}

/**
 * Get OAuth props from configuration
 * Helper to pass OAuth config as stack props
 */
export function getOAuthProps(config: OAuthConfig): OAuthConfig {
  return config;
}
