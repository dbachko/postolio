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
import { AnalyticsStack } from '../lib/stacks/analytics-stack';
import { AssetLibraryStack } from '../lib/stacks/asset-library-stack';
import { getOAuthConfig } from '../lib/utils/oauth-config';

const app = new cdk.App();
const onlyStack = app.node.tryGetContext('onlyStack');

// Helper to decide if a stack should be created based on --context onlyStack
const isSelected = (name: string) => {
  if (!onlyStack) return true;
  // normalize to kebab-case comparisons
  const norm = (s: string) => String(s).toLowerCase();
  return norm(onlyStack) === norm(name);
};

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

const parseBooleanContext = (value: string | boolean | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
};

const normalizeHostname = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
};

const deriveApexDomain = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.replace(/^https?:\/\//i, '').replace(/\.$/, '');
  const parts = trimmed.split('.');
  if (parts.length <= 2) {
    return trimmed;
  }
  return parts.slice(-2).join('.');
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
const useExternalDns = parseBooleanContext(useExternalDnsContext) ?? false;

const assetsCdnDomainInput = normalizeHostname(
  resolveContext<string>('assetsCdnDomain', 'ASSETS_CDN_DOMAIN')
);
const assetsCdnHostedZoneIdInput = resolveContext<string>(
  'assetsCdnHostedZoneId',
  'ASSETS_CDN_HOSTED_ZONE_ID'
);
const assetsCdnHostedZoneNameInput = normalizeHostname(
  resolveContext<string>('assetsCdnHostedZoneName', 'ASSETS_CDN_HOSTED_ZONE_NAME')
);
const assetsCdnCertificateArnInput = resolveContext<string>(
  'assetsCdnCertificateArn',
  'ASSETS_CDN_CERTIFICATE_ARN'
);
const assetsCdnUseExternalDnsContext = resolveContext<string | boolean>(
  'assetsCdnUseExternalDns',
  'ASSETS_CDN_USE_EXTERNAL_DNS'
);
const assetsCdnUseExternalDns =
  parseBooleanContext(assetsCdnUseExternalDnsContext) ?? useExternalDns;

const normalizedHostedZoneName = hostedZoneName?.replace(/\.$/, '');
const apexFallback =
  assetsCdnHostedZoneNameInput || normalizedHostedZoneName || deriveApexDomain(domainName);
const derivedAssetsCdnDomain =
  assetsCdnDomainInput || (apexFallback ? `cdn.${apexFallback}` : undefined);
const derivedAssetsCdnHostedZoneName = assetsCdnHostedZoneNameInput || apexFallback;
const derivedAssetsCdnHostedZoneId = assetsCdnHostedZoneIdInput || hostedZoneId;

const resolvedAssetsCdnDomainName = derivedAssetsCdnDomain;
const resolvedAssetsCdnHostedZoneName = assetsCdnUseExternalDns
  ? undefined
  : derivedAssetsCdnHostedZoneName;
const resolvedAssetsCdnHostedZoneId = assetsCdnUseExternalDns
  ? undefined
  : derivedAssetsCdnHostedZoneId;
const resolvedAssetsCdnCertificateArn =
  assetsCdnCertificateArnInput || (assetsCdnUseExternalDns ? webCertificateArn : undefined);

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
  enableVpcFlowLogs: environment === 'prod',
  enableDatabaseProxy: true,
  alertEmail: alertEmail,
  description: `Postolio Foundation infrastructure - ${environment} environment`,
  tags: {
    ...stackTags,
    Service: 'Foundation',
  },
});

// 2. Auth Stack - token-service microservice
let schedulingStackRef: SchedulingStack | undefined;
let apiStackRef: ApiStack | undefined;

// 2. Auth Stack - token-service microservice
let authStackRef: AuthStack | undefined;
if (!onlyStack || isSelected('auth')) {
  authStackRef = new AuthStack(app, `Postolio-Auth-${environment}`, {
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
}

// 3. Scheduling Stack
if (!onlyStack || isSelected('scheduling')) {
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
}

// 4. Publishing Stack
let publishingStackRef: PublishingStack | undefined;
if (!onlyStack || isSelected('publishing')) {
  publishingStackRef = new PublishingStack(app, `Postolio-Publishing-${environment}`, {
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
}

// 5. API Stack
if (!onlyStack || isSelected('api')) {
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
}

// 6. Web Stack - Frontend (React)
let webStackRef: WebStack | undefined;
if (!onlyStack || isSelected('web')) {
  webStackRef = new WebStack(app, `Postolio-Web-${environment}`, {
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
}

// Conditional dependencies
if (authStackRef) authStackRef.addDependency(foundationStack);
if (schedulingStackRef) schedulingStackRef.addDependency(foundationStack);
if (publishingStackRef) publishingStackRef.addDependency(foundationStack);
if (apiStackRef) apiStackRef.addDependency(foundationStack);
if (webStackRef) webStackRef.addDependency(foundationStack);
if (schedulingStackRef && authStackRef) schedulingStackRef.addDependency(authStackRef);
if (publishingStackRef && authStackRef) publishingStackRef.addDependency(authStackRef);
if (publishingStackRef && schedulingStackRef) publishingStackRef.addDependency(schedulingStackRef);
if (webStackRef && apiStackRef) webStackRef.addDependency(apiStackRef);

// 7. Asset Library Stack - Asset Management Microservice
let assetLibraryStack: AssetLibraryStack | undefined;
if (!onlyStack || isSelected('asset-library')) {
  assetLibraryStack = new AssetLibraryStack(app, `Postolio-AssetLibrary-${environment}`, {
    env: stackEnv,
    environment: environment as 'dev' | 'staging' | 'prod',
    imageTag: imageTag,
    openaiApiKey: app.node.tryGetContext('openaiApiKey'),
    assetsCdnDomainName: resolvedAssetsCdnDomainName,
    assetsCdnHostedZoneId: resolvedAssetsCdnHostedZoneId,
    assetsCdnHostedZoneName: resolvedAssetsCdnHostedZoneName,
    assetsCdnCertificateArn: resolvedAssetsCdnCertificateArn,
    assetsCdnUseExternalDns,
    description: `Postolio Asset Library microservice - ${environment} environment`,
    tags: {
      ...stackTags,
      Service: 'AssetLibrary',
    },
  });
}

// Asset Library depends on Foundation
if (assetLibraryStack) {
  assetLibraryStack.addDependency(foundationStack);
}

// 8. Brand Analysis Stack - Profiles + Jobs + Lambda
let brandAnalysisStack: BrandAnalysisStack | undefined;
if (!onlyStack || isSelected('brand-analysis')) {
  brandAnalysisStack = new BrandAnalysisStack(app, `Postolio-BrandAnalysis-${environment}`, {
    env: stackEnv,
    environment: environment as 'dev' | 'staging' | 'prod',
    description: `Postolio Brand Analysis services - ${environment} environment`,
    tags: {
      ...stackTags,
      Service: 'BrandAnalysis',
    },
  });
}

// Brand analysis depends on foundation always; on scheduling when present
if (brandAnalysisStack) {
  brandAnalysisStack.addDependency(foundationStack);
  if (schedulingStackRef) {
    brandAnalysisStack.addDependency(schedulingStackRef);
  }
}

// 9. Analytics Stack - Background metrics ingestion (ECS worker)
let analyticsStackRef: AnalyticsStack | undefined;
if (!onlyStack || isSelected('analytics')) {
  analyticsStackRef = new AnalyticsStack(app, `Postolio-Analytics-${environment}`, {
    env: stackEnv,
    environment: environment as 'dev' | 'staging' | 'prod',
    imageTag,
    description: `Postolio Analytics ingestion - ${environment} environment`,
    tags: {
      ...stackTags,
      Service: 'Analytics',
    },
  });
}

if (analyticsStackRef) {
  analyticsStackRef.addDependency(foundationStack);
  if (authStackRef) analyticsStackRef.addDependency(authStackRef);
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
