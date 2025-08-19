/**
 * Cross-Stack Utilities for AWS CDK
 * 
 * Utility functions and classes to simplify cross-stack dependencies,
 * configuration management, and stack orchestration.
 */

import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

// =====================================================================================
// INTERFACES AND TYPES
// =====================================================================================

export interface CrossStackExport {
  key: string;
  value: string;
  description?: string;
}

export interface StackMetadata {
  stackName: string;
  environment: string;
  region: string;
  project: string;
  version?: string;
}

export interface SchedulerConfig {
  apiUrl: string;
  apiKey: string;
  endpoints?: Record<string, string>;
  timeout?: number;
  retryAttempts?: number;
}

// =====================================================================================
// CROSS-STACK CONFIGURATION MANAGER
// =====================================================================================

export class CrossStackConfigManager {
  private stack: cdk.Stack;
  private environment: string;
  private projectName: string;

  constructor(stack: cdk.Stack, projectName: string, environment: string) {
    this.stack = stack;
    this.projectName = projectName;
    this.environment = environment;
  }

  /**
   * Export a value for use by other stacks
   */
  exportValue(key: string, value: string, description?: string): void {
    const exportName = this.buildExportName(key);
    
    new cdk.CfnOutput(this.stack, this.capitalizeFirst(key) + 'Export', {
      value,
      description: description || `${key} export for ${this.projectName}`,
      exportName,
    });
  }

  /**
   * Import a value from another stack
   */
  importValue(sourceStackName: string, key: string): string {
    const exportName = this.buildExportName(key, sourceStackName);
    return cdk.Fn.importValue(exportName);
  }

  /**
   * Store configuration in Parameter Store
   */
  storeParameter(key: string, value: string, description?: string): ssm.StringParameter {
    return new ssm.StringParameter(this.stack, this.capitalizeFirst(key) + 'Parameter', {
      parameterName: this.buildParameterName(key),
      stringValue: value,
      description: description || `${key} parameter for ${this.projectName}`,
      tier: ssm.ParameterTier.STANDARD,
    });
  }

  /**
   * Retrieve configuration from Parameter Store
   */
  retrieveParameter(key: string, sourceStackName?: string): string {
    const parameterName = this.buildParameterName(key, sourceStackName);
    return ssm.StringParameter.valueFromLookup(this.stack, parameterName);
  }

  /**
   * Create a configuration secret
   */
  createConfigSecret(
    config: Record<string, cdk.SecretValue | string>, 
    description?: string
  ): secretsmanager.Secret {
    // Convert string values to SecretValue
    const secretConfig: Record<string, cdk.SecretValue> = {};
    for (const [key, value] of Object.entries(config)) {
      secretConfig[key] = typeof value === 'string' 
        ? cdk.SecretValue.unsafePlainText(value)
        : value;
    }

    return new secretsmanager.Secret(this.stack, 'CrossStackConfig', {
      description: description || `Cross-stack configuration for ${this.projectName}-${this.environment}`,
      secretObjectValue: secretConfig,
    });
  }

  /**
   * Import a configuration secret from another stack
   */
  importConfigSecret(secretArn: string, secretId?: string): secretsmanager.ISecret {
    return secretsmanager.Secret.fromSecretCompleteArn(
      this.stack,
      secretId || 'ImportedConfigSecret',
      secretArn
    );
  }

  private buildExportName(key: string, stackName?: string): string {
    const stack = stackName || this.stack.stackName;
    return `${stack}-${key}`;
  }

  private buildParameterName(key: string, stackName?: string): string {
    const stack = stackName || this.stack.stackName;
    return `/${this.projectName}/${stack}/${key}`;
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

// =====================================================================================
// SCHEDULER INTEGRATION HELPER
// =====================================================================================

export class SchedulerIntegration {
  private configManager: CrossStackConfigManager;

  constructor(configManager: CrossStackConfigManager) {
    this.configManager = configManager;
  }

  /**
   * Export scheduler configuration for consumption by other stacks
   */
  exportSchedulerConfig(apiUrl: string, apiKey: string, endpoints?: Record<string, string>): void {
    // Export individual values
    this.configManager.exportValue('scheduler-api-url', apiUrl, 'ContentScheduler API URL');
    this.configManager.exportValue('scheduler-api-key', apiKey, 'ContentScheduler API Key');
    
    if (endpoints) {
      this.configManager.exportValue(
        'scheduler-endpoints', 
        JSON.stringify(endpoints), 
        'ContentScheduler API endpoints'
      );
    }

    // Also store in Parameter Store for external access
    this.configManager.storeParameter('scheduler-api-url', apiUrl);
    this.configManager.storeParameter('scheduler-api-key', apiKey);
  }

  /**
   * Import scheduler configuration from another stack
   */
  importSchedulerConfig(sourceStackName: string): SchedulerConfig {
    const apiUrl = this.configManager.importValue(sourceStackName, 'scheduler-api-url');
    const apiKey = this.configManager.importValue(sourceStackName, 'scheduler-api-key');
    
    let endpoints: Record<string, string> | undefined;
    try {
      const endpointsJson = this.configManager.importValue(sourceStackName, 'scheduler-endpoints');
      endpoints = JSON.parse(endpointsJson);
    } catch (e) {
      // Endpoints not available, continue without them
    }

    return { apiUrl, apiKey, endpoints };
  }

  /**
   * Create application secrets with scheduler integration
   */
  createAppSecretsWithScheduler(
    schedulerConfig: SchedulerConfig,
    additionalSecrets: Record<string, cdk.SecretValue | string> = {}
  ): secretsmanager.Secret {
    const secretConfig = {
      // Scheduler configuration
      schedulerApiUrl: cdk.SecretValue.unsafePlainText(schedulerConfig.apiUrl),
      schedulerApiKey: cdk.SecretValue.unsafePlainText(schedulerConfig.apiKey),
      ...additionalSecrets,
    };

    if (schedulerConfig.endpoints) {
      (secretConfig as any).schedulerEndpoints = cdk.SecretValue.unsafePlainText(
        JSON.stringify(schedulerConfig.endpoints)
      );
    }

    return this.configManager.createConfigSecret(
      secretConfig, 
      'Application secrets with ContentScheduler integration'
    );
  }
}

// =====================================================================================
// STACK DEPENDENCY RESOLVER
// =====================================================================================

export class StackDependencyResolver {
  private app: cdk.App;
  private stacks: Map<string, cdk.Stack> = new Map();
  private dependencies: Map<string, string[]> = new Map();

  constructor(app: cdk.App) {
    this.app = app;
  }

  /**
   * Register a stack with the resolver
   */
  registerStack(stackName: string, stack: cdk.Stack): void {
    this.stacks.set(stackName, stack);
  }

  /**
   * Add a dependency between stacks
   */
  addDependency(dependentStack: string, dependsOnStack: string): void {
    if (!this.dependencies.has(dependentStack)) {
      this.dependencies.set(dependentStack, []);
    }
    this.dependencies.get(dependentStack)!.push(dependsOnStack);
  }

  /**
   * Resolve all dependencies and establish CDK dependencies
   */
  resolveDependencies(): void {
    for (const [dependentStackName, dependencyNames] of this.dependencies) {
      const dependentStack = this.stacks.get(dependentStackName);
      if (!dependentStack) {
        throw new Error(`Stack ${dependentStackName} not found in resolver`);
      }

      for (const dependencyName of dependencyNames) {
        const dependencyStack = this.stacks.get(dependencyName);
        if (!dependencyStack) {
          throw new Error(`Dependency stack ${dependencyName} not found in resolver`);
        }

        dependentStack.addDependency(dependencyStack);
      }
    }
  }

  /**
   * Get deployment order based on dependencies
   */
  getDeploymentOrder(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (stackName: string): void => {
      if (visiting.has(stackName)) {
        throw new Error(`Circular dependency detected: ${stackName}`);
      }
      if (visited.has(stackName)) {
        return;
      }

      visiting.add(stackName);
      const deps = this.dependencies.get(stackName) || [];
      for (const dep of deps) {
        visit(dep);
      }
      visiting.delete(stackName);
      visited.add(stackName);
      order.push(stackName);
    };

    for (const stackName of this.stacks.keys()) {
      visit(stackName);
    }

    return order;
  }
}

// =====================================================================================
// ENVIRONMENT CONFIGURATION HELPER
// =====================================================================================

export class EnvironmentConfigHelper {
  private environment: string;
  private region: string;
  private account?: string;

  constructor(environment: string, region: string, account?: string) {
    this.environment = environment;
    this.region = region;
    this.account = account;
  }

  /**
   * Get CDK environment configuration
   */
  getEnvConfig(): cdk.Environment {
    return {
      account: this.account || process.env.CDK_DEFAULT_ACCOUNT,
      region: this.region,
    };
  }

  /**
   * Get environment-specific resource naming
   */
  getResourceName(baseName: string, suffix?: string): string {
    const parts = [baseName, this.environment];
    if (suffix) parts.push(suffix);
    return parts.join('-');
  }

  /**
   * Get environment-specific tags
   */
  getStandardTags(projectName: string, additionalTags: Record<string, string> = {}): Record<string, string> {
    return {
      Environment: this.environment,
      Project: projectName,
      Region: this.region,
      ManagedBy: 'CDK',
      ...additionalTags,
    };
  }

  /**
   * Check if environment is production
   */
  isProduction(): boolean {
    return this.environment === 'prod' || this.environment === 'production';
  }

  /**
   * Get environment-specific configuration values
   */
  getConfigValue<T>(values: Record<string, T>): T {
    return values[this.environment] || values.default || values.dev;
  }
}

// =====================================================================================
// UTILITY FUNCTIONS
// =====================================================================================

/**
 * Generate a secure API key based on stack information
 */
export function generateApiKey(stack: cdk.Stack, prefix: string = ''): string {
  const parts = [prefix, stack.stackName];
  return cdk.Fn.join('-', [
    ...parts.filter(Boolean),
    cdk.Fn.select(0, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))
  ]);
}

/**
 * Create consistent export names across stacks
 */
export function createExportName(stackName: string, key: string): string {
  return `${stackName}-${key}`.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Validate that required exports exist before importing
 */
export function validateExports(
  stack: cdk.Stack, 
  sourceStackName: string, 
  requiredExports: string[]
): void {
  // Note: This is a compile-time check. Runtime validation would require custom resources
  for (const exportKey of requiredExports) {
    const exportName = createExportName(sourceStackName, exportKey);
    
    // Add a custom attribute to track expected imports
    if (!(stack as any).__expectedImports) {
      (stack as any).__expectedImports = [];
    }
    (stack as any).__expectedImports.push(exportName);
  }
}

/**
 * Create a deployment-ready stack configuration
 */
export interface StackConfig {
  stackName: string;
  environment: string;
  region: string;
  projectName: string;
  account?: string;
  dependencies?: string[];
  tags?: Record<string, string>;
}

export function createStackProps(config: StackConfig): cdk.StackProps {
  const envHelper = new EnvironmentConfigHelper(config.environment, config.region, config.account);
  
  return {
    stackName: config.stackName,
    env: envHelper.getEnvConfig(),
    description: `${config.projectName} - ${config.environment} environment`,
    tags: envHelper.getStandardTags(config.projectName, config.tags),
  };
}

// =====================================================================================
// EXAMPLE USAGE
// =====================================================================================

/*
// Example of how to use these utilities in your stacks:

import { CrossStackConfigManager, SchedulerIntegration, StackDependencyResolver } from './cross-stack-utils';

class ContentSchedulerStack extends cdk.Stack {
  public readonly configManager: CrossStackConfigManager;
  public readonly schedulerIntegration: SchedulerIntegration;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.configManager = new CrossStackConfigManager(this, 'postolio', 'dev');
    this.schedulerIntegration = new SchedulerIntegration(this.configManager);

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'content-scheduler-api',
    });

    // Export scheduler configuration
    this.schedulerIntegration.exportSchedulerConfig(
      api.url,
      generateApiKey(this, 'scheduler'),
      {
        health: `${api.url}health`,
        schedules: `${api.url}schedules`,
      }
    );
  }
}

class PostolioStack extends cdk.Stack {
  constructor(
    scope: Construct, 
    id: string, 
    schedulerStackName: string, 
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    const configManager = new CrossStackConfigManager(this, 'postolio', 'dev');
    const schedulerIntegration = new SchedulerIntegration(configManager);

    // Import scheduler configuration
    const schedulerConfig = schedulerIntegration.importSchedulerConfig(schedulerStackName);

    // Create application secrets with scheduler integration
    const appSecrets = schedulerIntegration.createAppSecretsWithScheduler(
      schedulerConfig,
      {
        jwtSecret: 'your-jwt-secret',
        openaiApiKey: 'your-openai-key',
      }
    );
  }
}

// In your app.ts:
const app = new cdk.App();
const resolver = new StackDependencyResolver(app);

const schedulerStack = new ContentSchedulerStack(app, 'scheduler-dev');
const postolioStack = new PostolioStack(app, 'postolio-dev', schedulerStack.stackName);

resolver.registerStack('scheduler', schedulerStack);
resolver.registerStack('postolio', postolioStack);
resolver.addDependency('postolio', 'scheduler');
resolver.resolveDependencies();
*/