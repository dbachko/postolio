/**
 * Cross-Stack Utilities for AWS CDK
 *
 * Utility functions and classes to simplify cross-stack dependencies,
 * configuration management, and stack orchestration.
 */
import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
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
    endpoints?: Record<string, string>;
    timeout?: number;
    retryAttempts?: number;
}
export declare class CrossStackConfigManager {
    private stack;
    private environment;
    private projectName;
    constructor(stack: cdk.Stack, projectName: string, environment: string);
    /**
     * Export a value for use by other stacks
     */
    exportValue(key: string, value: string, description?: string): void;
    /**
     * Import a value from another stack
     */
    importValue(sourceStackName: string, key: string): string;
    /**
     * Store configuration in Parameter Store
     */
    storeParameter(key: string, value: string, description?: string): ssm.StringParameter;
    /**
     * Retrieve configuration from Parameter Store
     */
    retrieveParameter(key: string, sourceStackName?: string): string;
    /**
     * Create a configuration secret
     */
    createConfigSecret(config: Record<string, cdk.SecretValue | string>, description?: string): secretsmanager.Secret;
    /**
     * Import a configuration secret from another stack
     */
    importConfigSecret(secretArn: string, secretId?: string): secretsmanager.ISecret;
    private buildExportName;
    private buildParameterName;
    private capitalizeFirst;
}
export declare class SchedulerIntegration {
    private configManager;
    constructor(configManager: CrossStackConfigManager);
    /**
     * Export scheduler configuration for consumption by other stacks
     */
    exportSchedulerConfig(apiUrl: string, endpoints?: Record<string, string>): void;
    /**
     * Import scheduler configuration from another stack
     */
    importSchedulerConfig(sourceStackName: string): SchedulerConfig;
    /**
     * Create application secrets with scheduler integration
     */
    createAppSecretsWithScheduler(schedulerConfig: SchedulerConfig, additionalSecrets?: Record<string, cdk.SecretValue | string>): secretsmanager.Secret;
}
export declare class StackDependencyResolver {
    private app;
    private stacks;
    private dependencies;
    constructor(app: cdk.App);
    /**
     * Register a stack with the resolver
     */
    registerStack(stackName: string, stack: cdk.Stack): void;
    /**
     * Add a dependency between stacks
     */
    addDependency(dependentStack: string, dependsOnStack: string): void;
    /**
     * Resolve all dependencies and establish CDK dependencies
     */
    resolveDependencies(): void;
    /**
     * Get deployment order based on dependencies
     */
    getDeploymentOrder(): string[];
}
export declare class EnvironmentConfigHelper {
    private environment;
    private region;
    private account?;
    constructor(environment: string, region: string, account?: string);
    /**
     * Get CDK environment configuration
     */
    getEnvConfig(): cdk.Environment;
    /**
     * Get environment-specific resource naming
     */
    getResourceName(baseName: string, suffix?: string): string;
    /**
     * Get environment-specific tags
     */
    getStandardTags(projectName: string, additionalTags?: Record<string, string>): Record<string, string>;
    /**
     * Check if environment is production
     */
    isProduction(): boolean;
    /**
     * Get environment-specific configuration values
     */
    getConfigValue<T>(values: Record<string, T>): T;
}
/**
 * Generate a secure API key based on stack information
 */
/**
 * Create consistent export names across stacks
 */
export declare function createExportName(stackName: string, key: string): string;
/**
 * Validate that required exports exist before importing
 */
export declare function validateExports(stack: cdk.Stack, sourceStackName: string, requiredExports: string[]): void;
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
export declare function createStackProps(config: StackConfig): cdk.StackProps;
