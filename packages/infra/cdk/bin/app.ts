#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { FoundationStack } from '../lib/stacks/foundation-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { SchedulingStack } from '../lib/stacks/scheduling-stack';
import { PublishingStack } from '../lib/stacks/publishing-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { BrandAnalysisStack } from '../lib/stacks/brand-analysis-stack';
import { WebStack } from '../lib/stacks/web-stack';
import { AssetLibraryStack } from '../lib/stacks/asset-library-stack';
import { getOAuthConfig } from '../lib/utils/oauth-config';

const app = new cdk.App();
const onlyStack = app.node.tryGetContext('onlyStack');

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';
const alertEmail = app.node.tryGetContext('alertEmail');
const imageTag = app.node.tryGetContext('imageTag') as string | undefined;

// Custom domain configuration for Postolio stack
const resolveContext = <T>(key: string, envKey?: string): T | undefined => {
  const contextValue = app.node.tryGetContext(key);
  if (contextValue !== undefined) {
    return contextValue as T;
  }

  const resolvedEnvKey = envKey ?? key.toUpperCase();
  const envValue = process.env[resolvedEnvKey];
  return (envValue as unknown as T) ?? undefined;
};

const domainName = resolveContext<string>('domainName', 'DOMAIN_NAME');
const hostedZoneId = resolveContext<string>('hostedZoneId', 'HOSTED_ZONE_ID');
const hostedZoneName = resolveContext<string>('hostedZoneName', 'HOSTED_ZONE_NAME');
const webCertificateArn = resolveContext<string>('webCertificateArn', 'WEB_CERTIFICATE_ARN');

// Optional Brand Analysis integration overrides for API stack
const brandProfilesTableName = resolveContext<string>(
  'brandProfilesTableName',
  'BRAND_PROFILES_TABLE_NAME'
);
const brandJobsTableName = resolveContext<string>('brandJobsTableName', 'BRAND_JOBS_TABLE_NAME');
const brandProfilesTableParamPath = resolveContext<string>(
  'brandProfilesTableParamPath',
  'BRAND_PROFILES_TABLE_PARAM_PATH'
);
const brandJobsTableParamPath = resolveContext<string>(
  'brandJobsTableParamPath',
  'BRAND_JOBS_TABLE_PARAM_PATH'
);

const useExternalDnsContext = resolveContext<string | boolean>(
  'useExternalDns',
  'USE_EXTERNAL_DNS'
);
const useExternalDns =
  typeof useExternalDnsContext === 'boolean'
    ? useExternalDnsContext
    : typeof useExternalDnsContext === 'string'
      ? ['true', '1', 'yes'].includes(useExternalDnsContext.toLowerCase())
      : false;

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

const stackEnv = envConfig[environment as keyof typeof envConfig];
const stackTags = {
  Environment: environment,
  ManagedBy: 'CDK',
  Version: '2.0',
};

// Get OAuth configuration from shared utility
const oauthConfig = getOAuthConfig(app);

// 1. Foundation Stack - VPC, Database, Cache, ECR, and all shared infrastructure
const foundationStack = new FoundationStack(app, `Postolio-Foundation-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  domainName: domainName, // e.g., 'postolio.example' - used for CDN custom domain
  enableVpcFlowLogs: environment === 'prod',
  enableDatabaseProxy: true,
  description: `Postolio Foundation infrastructure - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Foundation',
  },
});

// 2. Auth Stack - token-service microservice
let schedulingStackRef: SchedulingStack | undefined;
let apiStackRef: ApiStack | undefined;
if (!onlyStack) {
  const authStack = new AuthStack(app, `Postolio-Auth-${environment}`, {
    env: stackEnv,
    environment: environment as 'dev' | 'staging' | 'prod',
    alertEmail: alertEmail,
    domainName,
    ...oauthConfig,
    description: `Postolio Authentication services - ${environment} environment`,
    tags: {
      ...stackTags,
      Service: 'Auth',
    },
  });

  // 3. Scheduling Stack - schedule-management, schedule-cleanup, status-sync
  schedulingStackRef = new SchedulingStack(app, `Postolio-Scheduling-${environment}`, {
    env: stackEnv,
    environment: environment as 'dev' | 'staging' | 'prod',
    alertEmail: alertEmail,
    description: `Postolio Content scheduling services - ${environment} environment`,
    tags: {
      ...stackTags,
      Service: 'Scheduling',
    },
  });

  // 4. Publishing Stack - publisher, retry-handler, dlq-processor, campaign-event-dlq-processor
  const publishingStack = new PublishingStack(app, `Postolio-Publishing-${environment}`, {
    env: stackEnv,
    environment: environment as 'dev' | 'staging' | 'prod',
    alertEmail: alertEmail,
    ...oauthConfig,
    description: `Postolio Content publishing services - ${environment} environment`,
    tags: {
      ...stackTags,
      Service: 'Publishing',
    },
  });

  // 5. API Stack - Backend API (ECS)
  apiStackRef = new ApiStack(app, `Postolio-API-${environment}`, {
    env: stackEnv,
    environment,
    domainName,
    hostedZoneId,
    hostedZoneName,
    useExternalDns,
    openaiApiKey: app.node.tryGetContext('openaiApiKey'),
    imageTag,
    ...(brandProfilesTableName ? { brandProfilesTableName } : {}),
    ...(brandJobsTableName ? { brandJobsTableName } : {}),
    ...(brandProfilesTableParamPath ? { brandProfilesTableParamPath } : {}),
    ...(brandJobsTableParamPath ? { brandJobsTableParamPath } : {}),
    ...oauthConfig,
    description: `Postolio Backend API - ${environment} environment`,
    tags: {
      ...stackTags,
      Service: 'API',
    },
  });

  // 6. Web Stack - Frontend (React)
  const webStack = new WebStack(app, `Postolio-Web-${environment}`, {
    env: stackEnv,
    environment,
    domainName,
    hostedZoneId,
    hostedZoneName,
    useExternalDns,
    certificateArn: webCertificateArn,
    description: `Postolio Frontend application - ${environment} environment`,
    tags: {
      ...stackTags,
      Service: 'Web',
    },
  });

  // Dependencies for full app
  authStack.addDependency(foundationStack);
  schedulingStackRef.addDependency(foundationStack);
  publishingStack.addDependency(foundationStack);
  apiStackRef.addDependency(foundationStack);
  webStack.addDependency(foundationStack);
  schedulingStackRef.addDependency(authStack);
  publishingStack.addDependency(authStack);
  publishingStack.addDependency(schedulingStackRef);
  webStack.addDependency(apiStackRef);
}

// 7. Asset Library Stack - Asset Management Microservice
const assetLibraryStack = new AssetLibraryStack(app, `Postolio-AssetLibrary-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  vpc: foundationStack.vpc,
  lambdaSecurityGroup: foundationStack.lambdaSecurityGroup,
  ecsSecurityGroup: foundationStack.ecsSecurityGroup,
  encryptionKey: foundationStack.encryptionKey,
  openaiApiKey: app.node.tryGetContext('openaiApiKey'),
  description: `Postolio Asset Library microservice - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'AssetLibrary',
  },
});

// Asset Library depends on Foundation
assetLibraryStack.addDependency(foundationStack);

// 8. Brand Analysis Stack - Profiles + Jobs + Lambda
const brandAnalysisStack = new BrandAnalysisStack(app, `Postolio-BrandAnalysis-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  description: `Postolio Brand Analysis services - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'BrandAnalysis',
  },
});

// Brand analysis depends on foundation always; on scheduling when present
brandAnalysisStack.addDependency(foundationStack);
if (schedulingStackRef) {
  brandAnalysisStack.addDependency(schedulingStackRef);
}

// API stack is intentionally decoupled from Brand Analysis; no dependency here.

// Apply CDK Nag security checks
cdk.Aspects.of(app).add(
  new AwsSolutionsChecks({
    verbose: true,
    reports: true,
    logIgnores: false,
  })
);

// Outputs: omitted in synth-only mode

console.log(`Optimized stack-based deployment configured for ${environment} environment`);

app.synth();
