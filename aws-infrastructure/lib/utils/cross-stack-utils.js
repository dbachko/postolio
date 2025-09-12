"use strict";
/**
 * Cross-Stack Utilities for AWS CDK
 *
 * Utility functions and classes to simplify cross-stack dependencies,
 * configuration management, and stack orchestration.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvironmentConfigHelper = exports.StackDependencyResolver = exports.SchedulerIntegration = exports.CrossStackConfigManager = void 0;
exports.createExportName = createExportName;
exports.validateExports = validateExports;
exports.createStackProps = createStackProps;
const cdk = __importStar(require("aws-cdk-lib"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
// =====================================================================================
// CROSS-STACK CONFIGURATION MANAGER
// =====================================================================================
class CrossStackConfigManager {
    stack;
    environment;
    projectName;
    constructor(stack, projectName, environment) {
        this.stack = stack;
        this.projectName = projectName;
        this.environment = environment;
    }
    /**
     * Export a value for use by other stacks
     */
    exportValue(key, value, description) {
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
    importValue(sourceStackName, key) {
        const exportName = this.buildExportName(key, sourceStackName);
        return cdk.Fn.importValue(exportName);
    }
    /**
     * Store configuration in Parameter Store
     */
    storeParameter(key, value, description) {
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
    retrieveParameter(key, sourceStackName) {
        const parameterName = this.buildParameterName(key, sourceStackName);
        return ssm.StringParameter.valueFromLookup(this.stack, parameterName);
    }
    /**
     * Create a configuration secret
     */
    createConfigSecret(config, description) {
        // Convert string values to SecretValue
        const secretConfig = {};
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
    importConfigSecret(secretArn, secretId) {
        return secretsmanager.Secret.fromSecretCompleteArn(this.stack, secretId || 'ImportedConfigSecret', secretArn);
    }
    buildExportName(key, stackName) {
        const stack = stackName || this.stack.stackName;
        return `${stack}-${key}`;
    }
    buildParameterName(key, stackName) {
        const stack = stackName || this.stack.stackName;
        return `/${this.projectName}/${stack}/${key}`;
    }
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}
exports.CrossStackConfigManager = CrossStackConfigManager;
// =====================================================================================
// SCHEDULER INTEGRATION HELPER
// =====================================================================================
class SchedulerIntegration {
    configManager;
    constructor(configManager) {
        this.configManager = configManager;
    }
    /**
     * Export scheduler configuration for consumption by other stacks
     */
    exportSchedulerConfig(apiUrl, endpoints) {
        // Export individual values
        this.configManager.exportValue('scheduler-api-url', apiUrl, 'ContentScheduler API URL');
        if (endpoints) {
            this.configManager.exportValue('scheduler-endpoints', JSON.stringify(endpoints), 'ContentScheduler API endpoints');
        }
        // Also store in Parameter Store for external access
        this.configManager.storeParameter('scheduler-api-url', apiUrl);
    }
    /**
     * Import scheduler configuration from another stack
     */
    importSchedulerConfig(sourceStackName) {
        const apiUrl = this.configManager.importValue(sourceStackName, 'scheduler-api-url');
        let endpoints;
        try {
            const endpointsJson = this.configManager.importValue(sourceStackName, 'scheduler-endpoints');
            endpoints = JSON.parse(endpointsJson);
        }
        catch {
            // Endpoints not available, continue without them
        }
        return { apiUrl, endpoints };
    }
    /**
     * Create application secrets with scheduler integration
     */
    createAppSecretsWithScheduler(schedulerConfig, additionalSecrets = {}) {
        const secretConfig = {
            // Scheduler configuration
            schedulerApiUrl: cdk.SecretValue.unsafePlainText(schedulerConfig.apiUrl),
            ...additionalSecrets,
        };
        if (schedulerConfig.endpoints) {
            secretConfig.schedulerEndpoints = cdk.SecretValue.unsafePlainText(JSON.stringify(schedulerConfig.endpoints));
        }
        return this.configManager.createConfigSecret(secretConfig, 'Application secrets with ContentScheduler integration');
    }
}
exports.SchedulerIntegration = SchedulerIntegration;
// =====================================================================================
// STACK DEPENDENCY RESOLVER
// =====================================================================================
class StackDependencyResolver {
    app;
    stacks = new Map();
    dependencies = new Map();
    constructor(app) {
        this.app = app;
    }
    /**
     * Register a stack with the resolver
     */
    registerStack(stackName, stack) {
        this.stacks.set(stackName, stack);
    }
    /**
     * Add a dependency between stacks
     */
    addDependency(dependentStack, dependsOnStack) {
        if (!this.dependencies.has(dependentStack)) {
            this.dependencies.set(dependentStack, []);
        }
        this.dependencies.get(dependentStack).push(dependsOnStack);
    }
    /**
     * Resolve all dependencies and establish CDK dependencies
     */
    resolveDependencies() {
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
    getDeploymentOrder() {
        const visited = new Set();
        const visiting = new Set();
        const order = [];
        const visit = (stackName) => {
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
exports.StackDependencyResolver = StackDependencyResolver;
// =====================================================================================
// ENVIRONMENT CONFIGURATION HELPER
// =====================================================================================
class EnvironmentConfigHelper {
    environment;
    region;
    account;
    constructor(environment, region, account) {
        this.environment = environment;
        this.region = region;
        this.account = account;
    }
    /**
     * Get CDK environment configuration
     */
    getEnvConfig() {
        return {
            account: this.account || process.env.CDK_DEFAULT_ACCOUNT,
            region: this.region,
        };
    }
    /**
     * Get environment-specific resource naming
     */
    getResourceName(baseName, suffix) {
        const parts = [baseName, this.environment];
        if (suffix)
            parts.push(suffix);
        return parts.join('-');
    }
    /**
     * Get environment-specific tags
     */
    getStandardTags(projectName, additionalTags = {}) {
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
    isProduction() {
        return this.environment === 'prod' || this.environment === 'production';
    }
    /**
     * Get environment-specific configuration values
     */
    getConfigValue(values) {
        return values[this.environment] || values.default || values.dev;
    }
}
exports.EnvironmentConfigHelper = EnvironmentConfigHelper;
// =====================================================================================
// UTILITY FUNCTIONS
// =====================================================================================
/**
 * Generate a secure API key based on stack information
 */
// (Removed) generateApiKey utility – API keys deprecated in favor of SigV4 IAM auth
/**
 * Create consistent export names across stacks
 */
function createExportName(stackName, key) {
    return `${stackName}-${key}`.replace(/[^a-zA-Z0-9-]/g, '-');
}
/**
 * Validate that required exports exist before importing
 */
function validateExports(stack, sourceStackName, requiredExports) {
    // Note: This is a compile-time check. Runtime validation would require custom resources
    for (const exportKey of requiredExports) {
        const exportName = createExportName(sourceStackName, exportKey);
        // Add a custom attribute to track expected imports
        if (!stack.__expectedImports) {
            stack.__expectedImports = [];
        }
        stack.__expectedImports.push(exportName);
    }
}
function createStackProps(config) {
    const envHelper = new EnvironmentConfigHelper(config.environment, config.region, config.account);
    return {
        stackName: config.stackName,
        env: envHelper.getEnvConfig(),
        description: `${config.projectName} - ${config.environment} environment`,
        tags: envHelper.getStandardTags(config.projectName, config.tags),
    };
}
// =====================================================================================
// USAGE EXAMPLES
// =====================================================================================
// For detailed usage examples, see aws-infrastructure/examples/cross-stack-patterns.ts
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3Jvc3Mtc3RhY2stdXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjcm9zcy1zdGFjay11dGlscy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQTZXSCw0Q0FFQztBQUtELDBDQWVDO0FBZUQsNENBU0M7QUF6WkQsaURBQW1DO0FBQ25DLCtFQUFpRTtBQUNqRSx5REFBMkM7QUEyQjNDLHdGQUF3RjtBQUN4RixvQ0FBb0M7QUFDcEMsd0ZBQXdGO0FBRXhGLE1BQWEsdUJBQXVCO0lBQzFCLEtBQUssQ0FBWTtJQUNqQixXQUFXLENBQVM7SUFDcEIsV0FBVyxDQUFTO0lBRTVCLFlBQVksS0FBZ0IsRUFBRSxXQUFtQixFQUFFLFdBQW1CO1FBQ3BFLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO1FBQ25CLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFDO1FBQy9CLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFDO0lBQ2pDLENBQUM7SUFFRDs7T0FFRztJQUNILFdBQVcsQ0FBQyxHQUFXLEVBQUUsS0FBYSxFQUFFLFdBQW9CO1FBQzFELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLENBQUM7UUFFN0MsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLEVBQUU7WUFDbEUsS0FBSztZQUNMLFdBQVcsRUFBRSxXQUFXLElBQUksR0FBRyxHQUFHLGVBQWUsSUFBSSxDQUFDLFdBQVcsRUFBRTtZQUNuRSxVQUFVO1NBQ1gsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsV0FBVyxDQUFDLGVBQXVCLEVBQUUsR0FBVztRQUM5QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLEdB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QUFnQixFQUFFLEdBQUcsQ0FBQyxDQUFDO0FBQzlELENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGVBQWUsQ0FDN0IsS0FBZ0IsRUFDaEIsZUFBdUIsRUFDdkIsZUFBeUI7SUFFekIsd0ZBQXdGO0lBQ3hGLEtBQUssTUFBTSxTQUFTLElBQUksZUFBZSxFQUFFLENBQUM7UUFDeEMsTUFBTSxVQUFVLEdBQUcsZ0JBQWdCLENBQUMsZUFBZSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBRWhFLG1EQUFtRDtRQUNuRCxJQUFJLENBQUUsS0FBYSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDckMsS0FBYSxDQUFDLGlCQUFpQixHQUFHLEVBQUUsQ0FBQztRQUN4QyxDQUFDO1FBQ0EsS0FBYSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUNwRCxDQUFDO0FBQ0gsQ0FBQztBQWVELFNBQWdCLGdCQUFnQixDQUFDLE1BQW1CO0lBQ2xELE1BQU0sU0FBUyxHQUFHLElBQUksdUJBQXVCLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRSxNQUFNLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUVqRyxPQUFPO1FBQ0wsU0FBUyxFQUFFLE1BQU0sQ0FBQyxTQUFTO1FBQzNCLEdBQUcsRUFBRSxTQUFTLENBQUMsWUFBWSxFQUFFO1FBQzdCLFdBQVcsRUFBRSxHQUFHLE1BQU0sQ0FBQyxXQUFXLE1BQU0sTUFBTSxDQUFDLFdBQVcsY0FBYztRQUN4RSxJQUFJLEVBQUUsU0FBUyxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7S0FDakUsQ0FBQztBQUNKLENBQUM7QUFFRCx3RkFBd0Y7QUFDeEYsaUJBQWlCO0FBQ2pCLHdGQUF3RjtBQUN4Rix1RkFBdUYiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENyb3NzLVN0YWNrIFV0aWxpdGllcyBmb3IgQVdTIENES1xuICogXG4gKiBVdGlsaXR5IGZ1bmN0aW9ucyBhbmQgY2xhc3NlcyB0byBzaW1wbGlmeSBjcm9zcy1zdGFjayBkZXBlbmRlbmNpZXMsXG4gKiBjb25maWd1cmF0aW9uIG1hbmFnZW1lbnQsIGFuZCBzdGFjayBvcmNoZXN0cmF0aW9uLlxuICovXG5cbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMgc3NtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBJTlRFUkZBQ0VTIEFORCBUWVBFU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgaW50ZXJmYWNlIENyb3NzU3RhY2tFeHBvcnQge1xuICBrZXk6IHN0cmluZztcbiAgdmFsdWU6IHN0cmluZztcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhY2tNZXRhZGF0YSB7XG4gIHN0YWNrTmFtZTogc3RyaW5nO1xuICBlbnZpcm9ubWVudDogc3RyaW5nO1xuICByZWdpb246IHN0cmluZztcbiAgcHJvamVjdDogc3RyaW5nO1xuICB2ZXJzaW9uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNjaGVkdWxlckNvbmZpZyB7XG4gIGFwaVVybDogc3RyaW5nO1xuICBlbmRwb2ludHM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICB0aW1lb3V0PzogbnVtYmVyO1xuICByZXRyeUF0dGVtcHRzPzogbnVtYmVyO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDUk9TUy1TVEFDSyBDT05GSUdVUkFUSU9OIE1BTkFHRVJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNsYXNzIENyb3NzU3RhY2tDb25maWdNYW5hZ2VyIHtcbiAgcHJpdmF0ZSBzdGFjazogY2RrLlN0YWNrO1xuICBwcml2YXRlIGVudmlyb25tZW50OiBzdHJpbmc7XG4gIHByaXZhdGUgcHJvamVjdE5hbWU6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihzdGFjazogY2RrLlN0YWNrLCBwcm9qZWN0TmFtZTogc3RyaW5nLCBlbnZpcm9ubWVudDogc3RyaW5nKSB7XG4gICAgdGhpcy5zdGFjayA9IHN0YWNrO1xuICAgIHRoaXMucHJvamVjdE5hbWUgPSBwcm9qZWN0TmFtZTtcbiAgICB0aGlzLmVudmlyb25tZW50ID0gZW52aXJvbm1lbnQ7XG4gIH1cblxuICAvKipcbiAgICogRXhwb3J0IGEgdmFsdWUgZm9yIHVzZSBieSBvdGhlciBzdGFja3NcbiAgICovXG4gIGV4cG9ydFZhbHVlKGtleTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nLCBkZXNjcmlwdGlvbj86IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGV4cG9ydE5hbWUgPSB0aGlzLmJ1aWxkRXhwb3J0TmFtZShrZXkpO1xuICAgIFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMuc3RhY2ssIHRoaXMuY2FwaXRhbGl6ZUZpcnN0KGtleSkgKyAnRXhwb3J0Jywge1xuICAgICAgdmFsdWUsXG4gICAgICBkZXNjcmlwdGlvbjogZGVzY3JpcHRpb24gfHwgYCR7a2V5fSBleHBvcnQgZm9yICR7dGhpcy5wcm9qZWN0TmFtZX1gLFxuICAgICAgZXhwb3J0TmFtZSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbXBvcnQgYSB2YWx1ZSBmcm9tIGFub3RoZXIgc3RhY2tcbiAgICovXG4gIGltcG9ydFZhbHVlKHNvdXJjZVN0YWNrTmFtZTogc3RyaW5nLCBrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgZXhwb3J0TmFtZSA9IHRoaXMuYnVpbGRFeHBvcnROYW1lKGtleSwgc291cmNlU3RhY2tOYW1lKTtcbiAgICByZXR1cm4gY2RrLkZuLmltcG9ydFZhbHVlKGV4cG9ydE5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFN0b3JlIGNvbmZpZ3VyYXRpb24gaW4gUGFyYW1ldGVyIFN0b3JlXG4gICAqL1xuICBzdG9yZVBhcmFtZXRlcihrZXk6IHN0cmluZywgdmFsdWU6IHN0cmluZywgZGVzY3JpcHRpb24/OiBzdHJpbmcpOiBzc20uU3RyaW5nUGFyYW1ldGVyIHtcbiAgICByZXR1cm4gbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcy5zdGFjaywgdGhpcy5jYXBpdGFsaXplRmlyc3Qoa2V5KSArICdQYXJhbWV0ZXInLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiB0aGlzLmJ1aWxkUGFyYW1ldGVyTmFtZShrZXkpLFxuICAgICAgc3RyaW5nVmFsdWU6IHZhbHVlLFxuICAgICAgZGVzY3JpcHRpb246IGRlc2NyaXB0aW9uIHx8IGAke2tleX0gcGFyYW1ldGVyIGZvciAke3RoaXMucHJvamVjdE5hbWV9YCxcbiAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlIGNvbmZpZ3VyYXRpb24gZnJvbSBQYXJhbWV0ZXIgU3RvcmVcbiAgICovXG4gIHJldHJpZXZlUGFyYW1ldGVyKGtleTogc3RyaW5nLCBzb3VyY2VTdGFja05hbWU/OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHBhcmFtZXRlck5hbWUgPSB0aGlzLmJ1aWxkUGFyYW1ldGVyTmFtZShrZXksIHNvdXJjZVN0YWNrTmFtZSk7XG4gICAgcmV0dXJuIHNzbS5TdHJpbmdQYXJhbWV0ZXIudmFsdWVGcm9tTG9va3VwKHRoaXMuc3RhY2ssIHBhcmFtZXRlck5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIGNvbmZpZ3VyYXRpb24gc2VjcmV0XG4gICAqL1xuICBjcmVhdGVDb25maWdTZWNyZXQoXG4gICAgY29uZmlnOiBSZWNvcmQ8c3RyaW5nLCBjZGsuU2VjcmV0VmFsdWUgfCBzdHJpbmc+LCBcbiAgICBkZXNjcmlwdGlvbj86IHN0cmluZ1xuICApOiBzZWNyZXRzbWFuYWdlci5TZWNyZXQge1xuICAgIC8vIENvbnZlcnQgc3RyaW5nIHZhbHVlcyB0byBTZWNyZXRWYWx1ZVxuICAgIGNvbnN0IHNlY3JldENvbmZpZzogUmVjb3JkPHN0cmluZywgY2RrLlNlY3JldFZhbHVlPiA9IHt9O1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGNvbmZpZykpIHtcbiAgICAgIHNlY3JldENvbmZpZ1trZXldID0gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyBcbiAgICAgICAgPyBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KHZhbHVlKVxuICAgICAgICA6IHZhbHVlO1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMuc3RhY2ssICdDcm9zc1N0YWNrQ29uZmlnJywge1xuICAgICAgZGVzY3JpcHRpb246IGRlc2NyaXB0aW9uIHx8IGBDcm9zcy1zdGFjayBjb25maWd1cmF0aW9uIGZvciAke3RoaXMucHJvamVjdE5hbWV9LSR7dGhpcy5lbnZpcm9ubWVudH1gLFxuICAgICAgc2VjcmV0T2JqZWN0VmFsdWU6IHNlY3JldENvbmZpZyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbXBvcnQgYSBjb25maWd1cmF0aW9uIHNlY3JldCBmcm9tIGFub3RoZXIgc3RhY2tcbiAgICovXG4gIGltcG9ydENvbmZpZ1NlY3JldChzZWNyZXRBcm46IHN0cmluZywgc2VjcmV0SWQ/OiBzdHJpbmcpOiBzZWNyZXRzbWFuYWdlci5JU2VjcmV0IHtcbiAgICByZXR1cm4gc2VjcmV0c21hbmFnZXIuU2VjcmV0LmZyb21TZWNyZXRDb21wbGV0ZUFybihcbiAgICAgIHRoaXMuc3RhY2ssXG4gICAgICBzZWNyZXRJZCB8fCAnSW1wb3J0ZWRDb25maWdTZWNyZXQnLFxuICAgICAgc2VjcmV0QXJuXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRFeHBvcnROYW1lKGtleTogc3RyaW5nLCBzdGFja05hbWU/OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHN0YWNrID0gc3RhY2tOYW1lIHx8IHRoaXMuc3RhY2suc3RhY2tOYW1lO1xuICAgIHJldHVybiBgJHtzdGFja30tJHtrZXl9YDtcbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRQYXJhbWV0ZXJOYW1lKGtleTogc3RyaW5nLCBzdGFja05hbWU/OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHN0YWNrID0gc3RhY2tOYW1lIHx8IHRoaXMuc3RhY2suc3RhY2tOYW1lO1xuICAgIHJldHVybiBgLyR7dGhpcy5wcm9qZWN0TmFtZX0vJHtzdGFja30vJHtrZXl9YDtcbiAgfVxuXG4gIHByaXZhdGUgY2FwaXRhbGl6ZUZpcnN0KHN0cjogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gc3RyLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgc3RyLnNsaWNlKDEpO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNDSEVEVUxFUiBJTlRFR1JBVElPTiBIRUxQRVJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNsYXNzIFNjaGVkdWxlckludGVncmF0aW9uIHtcbiAgcHJpdmF0ZSBjb25maWdNYW5hZ2VyOiBDcm9zc1N0YWNrQ29uZmlnTWFuYWdlcjtcblxuICBjb25zdHJ1Y3Rvcihjb25maWdNYW5hZ2VyOiBDcm9zc1N0YWNrQ29uZmlnTWFuYWdlcikge1xuICAgIHRoaXMuY29uZmlnTWFuYWdlciA9IGNvbmZpZ01hbmFnZXI7XG4gIH1cblxuICAvKipcbiAgICogRXhwb3J0IHNjaGVkdWxlciBjb25maWd1cmF0aW9uIGZvciBjb25zdW1wdGlvbiBieSBvdGhlciBzdGFja3NcbiAgICovXG4gIGV4cG9ydFNjaGVkdWxlckNvbmZpZyhhcGlVcmw6IHN0cmluZywgZW5kcG9pbnRzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IHZvaWQge1xuICAgIC8vIEV4cG9ydCBpbmRpdmlkdWFsIHZhbHVlc1xuICAgIHRoaXMuY29uZmlnTWFuYWdlci5leHBvcnRWYWx1ZSgnc2NoZWR1bGVyLWFwaS11cmwnLCBhcGlVcmwsICdDb250ZW50U2NoZWR1bGVyIEFQSSBVUkwnKTtcbiAgICBcbiAgICBpZiAoZW5kcG9pbnRzKSB7XG4gICAgICB0aGlzLmNvbmZpZ01hbmFnZXIuZXhwb3J0VmFsdWUoXG4gICAgICAgICdzY2hlZHVsZXItZW5kcG9pbnRzJywgXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KGVuZHBvaW50cyksIFxuICAgICAgICAnQ29udGVudFNjaGVkdWxlciBBUEkgZW5kcG9pbnRzJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBBbHNvIHN0b3JlIGluIFBhcmFtZXRlciBTdG9yZSBmb3IgZXh0ZXJuYWwgYWNjZXNzXG4gICAgdGhpcy5jb25maWdNYW5hZ2VyLnN0b3JlUGFyYW1ldGVyKCdzY2hlZHVsZXItYXBpLXVybCcsIGFwaVVybCk7XG4gIH1cblxuICAvKipcbiAgICogSW1wb3J0IHNjaGVkdWxlciBjb25maWd1cmF0aW9uIGZyb20gYW5vdGhlciBzdGFja1xuICAgKi9cbiAgaW1wb3J0U2NoZWR1bGVyQ29uZmlnKHNvdXJjZVN0YWNrTmFtZTogc3RyaW5nKTogU2NoZWR1bGVyQ29uZmlnIHtcbiAgICBjb25zdCBhcGlVcmwgPSB0aGlzLmNvbmZpZ01hbmFnZXIuaW1wb3J0VmFsdWUoc291cmNlU3RhY2tOYW1lLCAnc2NoZWR1bGVyLWFwaS11cmwnKTtcbiAgICBcbiAgICBsZXQgZW5kcG9pbnRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkO1xuICB0cnkge1xuICAgICAgY29uc3QgZW5kcG9pbnRzSnNvbiA9IHRoaXMuY29uZmlnTWFuYWdlci5pbXBvcnRWYWx1ZShzb3VyY2VTdGFja05hbWUsICdzY2hlZHVsZXItZW5kcG9pbnRzJyk7XG4gICAgICBlbmRwb2ludHMgPSBKU09OLnBhcnNlKGVuZHBvaW50c0pzb24pO1xuICB9IGNhdGNoIHtcbiAgICAgIC8vIEVuZHBvaW50cyBub3QgYXZhaWxhYmxlLCBjb250aW51ZSB3aXRob3V0IHRoZW1cbiAgICB9XG4gICAgcmV0dXJuIHsgYXBpVXJsLCBlbmRwb2ludHMgfSBhcyBTY2hlZHVsZXJDb25maWc7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGFwcGxpY2F0aW9uIHNlY3JldHMgd2l0aCBzY2hlZHVsZXIgaW50ZWdyYXRpb25cbiAgICovXG4gIGNyZWF0ZUFwcFNlY3JldHNXaXRoU2NoZWR1bGVyKFxuICAgIHNjaGVkdWxlckNvbmZpZzogU2NoZWR1bGVyQ29uZmlnLFxuICAgIGFkZGl0aW9uYWxTZWNyZXRzOiBSZWNvcmQ8c3RyaW5nLCBjZGsuU2VjcmV0VmFsdWUgfCBzdHJpbmc+ID0ge31cbiAgKTogc2VjcmV0c21hbmFnZXIuU2VjcmV0IHtcbiAgICBjb25zdCBzZWNyZXRDb25maWcgPSB7XG4gICAgICAvLyBTY2hlZHVsZXIgY29uZmlndXJhdGlvblxuICAgICAgc2NoZWR1bGVyQXBpVXJsOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KHNjaGVkdWxlckNvbmZpZy5hcGlVcmwpLFxuICAgICAgLi4uYWRkaXRpb25hbFNlY3JldHMsXG4gICAgfTtcblxuICAgIGlmIChzY2hlZHVsZXJDb25maWcuZW5kcG9pbnRzKSB7XG4gICAgICAoc2VjcmV0Q29uZmlnIGFzIGFueSkuc2NoZWR1bGVyRW5kcG9pbnRzID0gY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoc2NoZWR1bGVyQ29uZmlnLmVuZHBvaW50cylcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuY29uZmlnTWFuYWdlci5jcmVhdGVDb25maWdTZWNyZXQoXG4gICAgICBzZWNyZXRDb25maWcsIFxuICAgICAgJ0FwcGxpY2F0aW9uIHNlY3JldHMgd2l0aCBDb250ZW50U2NoZWR1bGVyIGludGVncmF0aW9uJ1xuICAgICk7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU1RBQ0sgREVQRU5ERU5DWSBSRVNPTFZFUlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgY2xhc3MgU3RhY2tEZXBlbmRlbmN5UmVzb2x2ZXIge1xuICBwcml2YXRlIGFwcDogY2RrLkFwcDtcbiAgcHJpdmF0ZSBzdGFja3M6IE1hcDxzdHJpbmcsIGNkay5TdGFjaz4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgZGVwZW5kZW5jaWVzOiBNYXA8c3RyaW5nLCBzdHJpbmdbXT4gPSBuZXcgTWFwKCk7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBjZGsuQXBwKSB7XG4gICAgdGhpcy5hcHAgPSBhcHA7XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBzdGFjayB3aXRoIHRoZSByZXNvbHZlclxuICAgKi9cbiAgcmVnaXN0ZXJTdGFjayhzdGFja05hbWU6IHN0cmluZywgc3RhY2s6IGNkay5TdGFjayk6IHZvaWQge1xuICAgIHRoaXMuc3RhY2tzLnNldChzdGFja05hbWUsIHN0YWNrKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYSBkZXBlbmRlbmN5IGJldHdlZW4gc3RhY2tzXG4gICAqL1xuICBhZGREZXBlbmRlbmN5KGRlcGVuZGVudFN0YWNrOiBzdHJpbmcsIGRlcGVuZHNPblN0YWNrOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuZGVwZW5kZW5jaWVzLmhhcyhkZXBlbmRlbnRTdGFjaykpIHtcbiAgICAgIHRoaXMuZGVwZW5kZW5jaWVzLnNldChkZXBlbmRlbnRTdGFjaywgW10pO1xuICAgIH1cbiAgICB0aGlzLmRlcGVuZGVuY2llcy5nZXQoZGVwZW5kZW50U3RhY2spIS5wdXNoKGRlcGVuZHNPblN0YWNrKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlIGFsbCBkZXBlbmRlbmNpZXMgYW5kIGVzdGFibGlzaCBDREsgZGVwZW5kZW5jaWVzXG4gICAqL1xuICByZXNvbHZlRGVwZW5kZW5jaWVzKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgW2RlcGVuZGVudFN0YWNrTmFtZSwgZGVwZW5kZW5jeU5hbWVzXSBvZiB0aGlzLmRlcGVuZGVuY2llcykge1xuICAgICAgY29uc3QgZGVwZW5kZW50U3RhY2sgPSB0aGlzLnN0YWNrcy5nZXQoZGVwZW5kZW50U3RhY2tOYW1lKTtcbiAgICAgIGlmICghZGVwZW5kZW50U3RhY2spIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTdGFjayAke2RlcGVuZGVudFN0YWNrTmFtZX0gbm90IGZvdW5kIGluIHJlc29sdmVyYCk7XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZGVwZW5kZW5jeU5hbWUgb2YgZGVwZW5kZW5jeU5hbWVzKSB7XG4gICAgICAgIGNvbnN0IGRlcGVuZGVuY3lTdGFjayA9IHRoaXMuc3RhY2tzLmdldChkZXBlbmRlbmN5TmFtZSk7XG4gICAgICAgIGlmICghZGVwZW5kZW5jeVN0YWNrKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBEZXBlbmRlbmN5IHN0YWNrICR7ZGVwZW5kZW5jeU5hbWV9IG5vdCBmb3VuZCBpbiByZXNvbHZlcmApO1xuICAgICAgICB9XG5cbiAgICAgICAgZGVwZW5kZW50U3RhY2suYWRkRGVwZW5kZW5jeShkZXBlbmRlbmN5U3RhY2spO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZGVwbG95bWVudCBvcmRlciBiYXNlZCBvbiBkZXBlbmRlbmNpZXNcbiAgICovXG4gIGdldERlcGxveW1lbnRPcmRlcigpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgdmlzaXRlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGNvbnN0IHZpc2l0aW5nID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgY29uc3Qgb3JkZXI6IHN0cmluZ1tdID0gW107XG5cbiAgICBjb25zdCB2aXNpdCA9IChzdGFja05hbWU6IHN0cmluZyk6IHZvaWQgPT4ge1xuICAgICAgaWYgKHZpc2l0aW5nLmhhcyhzdGFja05hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2lyY3VsYXIgZGVwZW5kZW5jeSBkZXRlY3RlZDogJHtzdGFja05hbWV9YCk7XG4gICAgICB9XG4gICAgICBpZiAodmlzaXRlZC5oYXMoc3RhY2tOYW1lKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHZpc2l0aW5nLmFkZChzdGFja05hbWUpO1xuICAgICAgY29uc3QgZGVwcyA9IHRoaXMuZGVwZW5kZW5jaWVzLmdldChzdGFja05hbWUpIHx8IFtdO1xuICAgICAgZm9yIChjb25zdCBkZXAgb2YgZGVwcykge1xuICAgICAgICB2aXNpdChkZXApO1xuICAgICAgfVxuICAgICAgdmlzaXRpbmcuZGVsZXRlKHN0YWNrTmFtZSk7XG4gICAgICB2aXNpdGVkLmFkZChzdGFja05hbWUpO1xuICAgICAgb3JkZXIucHVzaChzdGFja05hbWUpO1xuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IHN0YWNrTmFtZSBvZiB0aGlzLnN0YWNrcy5rZXlzKCkpIHtcbiAgICAgIHZpc2l0KHN0YWNrTmFtZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG9yZGVyO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVOVklST05NRU5UIENPTkZJR1VSQVRJT04gSEVMUEVSXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBjbGFzcyBFbnZpcm9ubWVudENvbmZpZ0hlbHBlciB7XG4gIHByaXZhdGUgZW52aXJvbm1lbnQ6IHN0cmluZztcbiAgcHJpdmF0ZSByZWdpb246IHN0cmluZztcbiAgcHJpdmF0ZSBhY2NvdW50Pzogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKGVudmlyb25tZW50OiBzdHJpbmcsIHJlZ2lvbjogc3RyaW5nLCBhY2NvdW50Pzogc3RyaW5nKSB7XG4gICAgdGhpcy5lbnZpcm9ubWVudCA9IGVudmlyb25tZW50O1xuICAgIHRoaXMucmVnaW9uID0gcmVnaW9uO1xuICAgIHRoaXMuYWNjb3VudCA9IGFjY291bnQ7XG4gIH1cblxuICAvKipcbiAgICogR2V0IENESyBlbnZpcm9ubWVudCBjb25maWd1cmF0aW9uXG4gICAqL1xuICBnZXRFbnZDb25maWcoKTogY2RrLkVudmlyb25tZW50IHtcbiAgICByZXR1cm4ge1xuICAgICAgYWNjb3VudDogdGhpcy5hY2NvdW50IHx8IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gICAgICByZWdpb246IHRoaXMucmVnaW9uLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogR2V0IGVudmlyb25tZW50LXNwZWNpZmljIHJlc291cmNlIG5hbWluZ1xuICAgKi9cbiAgZ2V0UmVzb3VyY2VOYW1lKGJhc2VOYW1lOiBzdHJpbmcsIHN1ZmZpeD86IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgcGFydHMgPSBbYmFzZU5hbWUsIHRoaXMuZW52aXJvbm1lbnRdO1xuICAgIGlmIChzdWZmaXgpIHBhcnRzLnB1c2goc3VmZml4KTtcbiAgICByZXR1cm4gcGFydHMuam9pbignLScpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBlbnZpcm9ubWVudC1zcGVjaWZpYyB0YWdzXG4gICAqL1xuICBnZXRTdGFuZGFyZFRhZ3MocHJvamVjdE5hbWU6IHN0cmluZywgYWRkaXRpb25hbFRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fSk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIHJldHVybiB7XG4gICAgICBFbnZpcm9ubWVudDogdGhpcy5lbnZpcm9ubWVudCxcbiAgICAgIFByb2plY3Q6IHByb2plY3ROYW1lLFxuICAgICAgUmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgIE1hbmFnZWRCeTogJ0NESycsXG4gICAgICAuLi5hZGRpdGlvbmFsVGFncyxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGVudmlyb25tZW50IGlzIHByb2R1Y3Rpb25cbiAgICovXG4gIGlzUHJvZHVjdGlvbigpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5lbnZpcm9ubWVudCA9PT0gJ3Byb2QnIHx8IHRoaXMuZW52aXJvbm1lbnQgPT09ICdwcm9kdWN0aW9uJztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZW52aXJvbm1lbnQtc3BlY2lmaWMgY29uZmlndXJhdGlvbiB2YWx1ZXNcbiAgICovXG4gIGdldENvbmZpZ1ZhbHVlPFQ+KHZhbHVlczogUmVjb3JkPHN0cmluZywgVD4pOiBUIHtcbiAgICByZXR1cm4gdmFsdWVzW3RoaXMuZW52aXJvbm1lbnRdIHx8IHZhbHVlcy5kZWZhdWx0IHx8IHZhbHVlcy5kZXY7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVVRJTElUWSBGVU5DVElPTlNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBHZW5lcmF0ZSBhIHNlY3VyZSBBUEkga2V5IGJhc2VkIG9uIHN0YWNrIGluZm9ybWF0aW9uXG4gKi9cbi8vIChSZW1vdmVkKSBnZW5lcmF0ZUFwaUtleSB1dGlsaXR5IOKAkyBBUEkga2V5cyBkZXByZWNhdGVkIGluIGZhdm9yIG9mIFNpZ1Y0IElBTSBhdXRoXG5cbi8qKlxuICogQ3JlYXRlIGNvbnNpc3RlbnQgZXhwb3J0IG5hbWVzIGFjcm9zcyBzdGFja3NcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUV4cG9ydE5hbWUoc3RhY2tOYW1lOiBzdHJpbmcsIGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke3N0YWNrTmFtZX0tJHtrZXl9YC5yZXBsYWNlKC9bXmEtekEtWjAtOS1dL2csICctJyk7XG59XG5cbi8qKlxuICogVmFsaWRhdGUgdGhhdCByZXF1aXJlZCBleHBvcnRzIGV4aXN0IGJlZm9yZSBpbXBvcnRpbmdcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlRXhwb3J0cyhcbiAgc3RhY2s6IGNkay5TdGFjaywgXG4gIHNvdXJjZVN0YWNrTmFtZTogc3RyaW5nLCBcbiAgcmVxdWlyZWRFeHBvcnRzOiBzdHJpbmdbXVxuKTogdm9pZCB7XG4gIC8vIE5vdGU6IFRoaXMgaXMgYSBjb21waWxlLXRpbWUgY2hlY2suIFJ1bnRpbWUgdmFsaWRhdGlvbiB3b3VsZCByZXF1aXJlIGN1c3RvbSByZXNvdXJjZXNcbiAgZm9yIChjb25zdCBleHBvcnRLZXkgb2YgcmVxdWlyZWRFeHBvcnRzKSB7XG4gICAgY29uc3QgZXhwb3J0TmFtZSA9IGNyZWF0ZUV4cG9ydE5hbWUoc291cmNlU3RhY2tOYW1lLCBleHBvcnRLZXkpO1xuICAgIFxuICAgIC8vIEFkZCBhIGN1c3RvbSBhdHRyaWJ1dGUgdG8gdHJhY2sgZXhwZWN0ZWQgaW1wb3J0c1xuICAgIGlmICghKHN0YWNrIGFzIGFueSkuX19leHBlY3RlZEltcG9ydHMpIHtcbiAgICAgIChzdGFjayBhcyBhbnkpLl9fZXhwZWN0ZWRJbXBvcnRzID0gW107XG4gICAgfVxuICAgIChzdGFjayBhcyBhbnkpLl9fZXhwZWN0ZWRJbXBvcnRzLnB1c2goZXhwb3J0TmFtZSk7XG4gIH1cbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBkZXBsb3ltZW50LXJlYWR5IHN0YWNrIGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdGFja0NvbmZpZyB7XG4gIHN0YWNrTmFtZTogc3RyaW5nO1xuICBlbnZpcm9ubWVudDogc3RyaW5nO1xuICByZWdpb246IHN0cmluZztcbiAgcHJvamVjdE5hbWU6IHN0cmluZztcbiAgYWNjb3VudD86IHN0cmluZztcbiAgZGVwZW5kZW5jaWVzPzogc3RyaW5nW107XG4gIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU3RhY2tQcm9wcyhjb25maWc6IFN0YWNrQ29uZmlnKTogY2RrLlN0YWNrUHJvcHMge1xuICBjb25zdCBlbnZIZWxwZXIgPSBuZXcgRW52aXJvbm1lbnRDb25maWdIZWxwZXIoY29uZmlnLmVudmlyb25tZW50LCBjb25maWcucmVnaW9uLCBjb25maWcuYWNjb3VudCk7XG4gIFxuICByZXR1cm4ge1xuICAgIHN0YWNrTmFtZTogY29uZmlnLnN0YWNrTmFtZSxcbiAgICBlbnY6IGVudkhlbHBlci5nZXRFbnZDb25maWcoKSxcbiAgICBkZXNjcmlwdGlvbjogYCR7Y29uZmlnLnByb2plY3ROYW1lfSAtICR7Y29uZmlnLmVudmlyb25tZW50fSBlbnZpcm9ubWVudGAsXG4gICAgdGFnczogZW52SGVscGVyLmdldFN0YW5kYXJkVGFncyhjb25maWcucHJvamVjdE5hbWUsIGNvbmZpZy50YWdzKSxcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVVNBR0UgRVhBTVBMRVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEZvciBkZXRhaWxlZCB1c2FnZSBleGFtcGxlcywgc2VlIGF3cy1pbmZyYXN0cnVjdHVyZS9leGFtcGxlcy9jcm9zcy1zdGFjay1wYXR0ZXJucy50c1xuIl19