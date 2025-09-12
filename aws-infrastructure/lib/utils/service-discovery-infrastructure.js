"use strict";
/**
 * Service Discovery Infrastructure Utilities
 *
 * FOR CDK/INFRASTRUCTURE USE ONLY - Used at deployment time to register services with AWS Cloud Map
 * For Lambda runtime service discovery, use lib/lambda/shared/service-discovery-runtime.ts
 *
 * This module provides CDK constructs for:
 * - Creating Cloud Map namespaces
 * - Registering services with Cloud Map
 * - Configuring service discovery for ECS/Lambda services
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
exports.ServiceDiscoveryManager = void 0;
exports.registerLambdaService = registerLambdaService;
exports.registerEcsService = registerEcsService;
exports.getServiceDiscoveryEnvVars = getServiceDiscoveryEnvVars;
const cdk = __importStar(require("aws-cdk-lib"));
const servicediscovery = __importStar(require("aws-cdk-lib/aws-servicediscovery"));
const constructs_1 = require("constructs");
/**
 * Manages service discovery namespace and registration for CDK stacks
 * Used at deployment time to register services with AWS Cloud Map
 */
class ServiceDiscoveryManager extends constructs_1.Construct {
    namespace;
    services = new Map();
    constructor(scope, id, config) {
        super(scope, id);
        // If existing namespace ID is provided, import it
        if (config.existingNamespaceId) {
            // Import existing namespace from shared service discovery stack
            const namespaceArn = cdk.Fn.importValue(`ServiceDiscovery-${config.environment}-NamespaceArn`);
            const namespaceName = cdk.Fn.importValue(`ServiceDiscovery-${config.environment}-NamespaceName`);
            this.namespace = servicediscovery.HttpNamespace.fromHttpNamespaceAttributes(this, 'ImportedNamespace', {
                namespaceId: config.existingNamespaceId,
                namespaceName: namespaceName,
                namespaceArn: namespaceArn,
            });
        }
        else {
            // Create new namespace (for shared service discovery stack only)
            const namespaceName = config.namespace || `postolio-${config.environment}.local`;
            if (config.vpc) {
                // Private namespace for VPC-based services
                this.namespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
                    name: namespaceName,
                    vpc: config.vpc,
                    description: `Service discovery namespace for Postolio ${config.environment}`,
                });
            }
            else {
                // HTTP namespace for Lambda and public services
                this.namespace = new servicediscovery.HttpNamespace(this, 'Namespace', {
                    name: namespaceName,
                    description: `Service discovery namespace for Postolio ${config.environment}`,
                });
            }
        }
        // Output namespace details
        new cdk.CfnOutput(this, 'NamespaceId', {
            value: this.namespace.namespaceId,
            description: 'Cloud Map Namespace ID',
            exportName: `${cdk.Stack.of(this).stackName}-NamespaceId`,
        });
        new cdk.CfnOutput(this, 'NamespaceName', {
            value: this.namespace.namespaceName,
            description: 'Cloud Map Namespace Name',
            exportName: `${cdk.Stack.of(this).stackName}-NamespaceName`,
        });
    }
    /**
     * Register a service with Cloud Map
     */
    registerService(serviceName, options) {
        if (this.services.has(serviceName)) {
            return this.services.get(serviceName);
        }
        // Build service props based on whether we have DNS configuration
        const serviceProps = options?.dnsRecordType !== undefined
            ? {
                namespace: this.namespace,
                name: serviceName,
                description: `Service discovery for ${serviceName}`,
                dnsRecordType: options.dnsRecordType,
                dnsTtl: options.dnsRecordTtl || cdk.Duration.seconds(30),
                customHealthCheck: options?.healthCheck ? {
                    failureThreshold: 1,
                } : undefined,
            }
            : {
                namespace: this.namespace,
                name: serviceName,
                description: `Service discovery for ${serviceName}`,
                customHealthCheck: options?.healthCheck ? {
                    failureThreshold: 1,
                } : undefined,
            };
        const service = new servicediscovery.Service(this, `${serviceName}Service`, serviceProps);
        this.services.set(serviceName, service);
        return service;
    }
    /**
     * Get a registered service
     */
    getService(serviceName) {
        return this.services.get(serviceName);
    }
    /**
     * Create a service discovery client configuration
     */
    getClientConfig() {
        return {
            namespaceId: this.namespace.namespaceId,
            namespaceName: this.namespace.namespaceName,
            region: cdk.Stack.of(this).region,
        };
    }
}
exports.ServiceDiscoveryManager = ServiceDiscoveryManager;
/**
 * Helper to register Lambda function with Cloud Map
 */
function registerLambdaService(serviceDiscovery, serviceName, functionUrl, environment) {
    // For HTTP namespaces, don't specify DNS record type
    const service = serviceDiscovery.registerService(serviceName, {
        // Don't specify dnsRecordType for HTTP namespace
        customAttributes: {
            url: functionUrl,
            type: 'lambda',
            environment,
        },
    });
    // Register instance for HTTP namespace (always register for lambda services)
    new servicediscovery.CfnInstance(serviceDiscovery, `${serviceName}Instance`, {
        instanceId: `${serviceName}-${environment}`,
        serviceId: service.serviceId,
        instanceAttributes: {
            url: functionUrl,
            type: 'lambda',
            environment,
        },
    });
    return service;
}
/**
 * Helper to register ECS service with Cloud Map
 */
function registerEcsService(serviceDiscovery, serviceName, ecsService, // Type would be ecs.IService
port = 3000) {
    const service = serviceDiscovery.registerService(serviceName, {
        dnsRecordType: servicediscovery.DnsRecordType.A,
        healthCheck: {
            type: servicediscovery.HealthCheckType.HTTP,
            resourcePath: '/health',
            failureThreshold: 2,
        },
    });
    // ECS will automatically register/deregister instances
    return service;
}
/**
 * Get service discovery environment variables for Lambda/ECS
 */
function getServiceDiscoveryEnvVars(config) {
    return {
        CLOUDMAP_NAMESPACE_ID: config.namespaceId,
        CLOUDMAP_NAMESPACE_NAME: config.namespaceName,
        // AWS_REGION is automatically set by Lambda runtime, don't override it
        // SERVICE_DISCOVERY_ENABLED removed - we now check for Cloud Map config directly
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS1kaXNjb3ZlcnktaW5mcmFzdHJ1Y3R1cmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzZXJ2aWNlLWRpc2NvdmVyeS1pbmZyYXN0cnVjdHVyZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7R0FVRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBaUpILHNEQTRCQztBQUtELGdEQWlCQztBQUtELGdFQU9DO0FBN01ELGlEQUFtQztBQUNuQyxtRkFBcUU7QUFFckUsMkNBQXVDO0FBU3ZDOzs7R0FHRztBQUNILE1BQWEsdUJBQXdCLFNBQVEsc0JBQVM7SUFDcEMsU0FBUyxDQUE4QjtJQUN0QyxRQUFRLEdBQTBDLElBQUksR0FBRyxFQUFFLENBQUM7SUFFN0UsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxNQUE4QjtRQUN0RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLGtEQUFrRDtRQUNsRCxJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQy9CLGdFQUFnRTtZQUNoRSxNQUFNLFlBQVksR0FBRyxHQUFHLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxvQkFBb0IsTUFBTSxDQUFDLFdBQVcsZUFBZSxDQUFDLENBQUM7WUFDL0YsTUFBTSxhQUFhLEdBQUcsR0FBRyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsb0JBQW9CLE1BQU0sQ0FBQyxXQUFXLGdCQUFnQixDQUFDLENBQUM7WUFFakcsSUFBSSxDQUFDLFNBQVMsR0FBRyxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsMkJBQTJCLENBQ3pFLElBQUksRUFDSixtQkFBbUIsRUFDbkI7Z0JBQ0UsV0FBVyxFQUFFLE1BQU0sQ0FBQyxtQkFBbUI7Z0JBQ3ZDLGFBQWEsRUFBRSxhQUFhO2dCQUM1QixZQUFZLEVBQUUsWUFBWTthQUMzQixDQUNGLENBQUM7UUFDSixDQUFDO2FBQU0sQ0FBQztZQUNOLGlFQUFp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Q0FBQztJQUVILE9BQU8sT0FBTyxDQUFDO0FBQ2pCLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGtCQUFrQixDQUNoQyxnQkFBeUMsRUFDekMsV0FBbUIsRUFDbkIsVUFBZSxFQUFFLDZCQUE2QjtBQUM5QyxPQUFlLElBQUk7SUFFbkIsTUFBTSxPQUFPLEdBQUcsZ0JBQWdCLENBQUMsZUFBZSxDQUFDLFdBQVcsRUFBRTtRQUM1RCxhQUFhLEVBQUUsZ0JBQWdCLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDL0MsV0FBVyxFQUFFO1lBQ1gsSUFBSSxFQUFFLGdCQUFnQixDQUFDLGVBQWUsQ0FBQyxJQUFJO1lBQzNDLFlBQVksRUFBRSxTQUFTO1lBQ3ZCLGdCQUFnQixFQUFFLENBQUM7U0FDcEI7S0FDRixDQUFDLENBQUM7SUFFSCx1REFBdUQ7SUFDdkQsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsMEJBQTBCLENBQUMsTUFBb0M7SUFDN0UsT0FBTztRQUNMLHFCQUFxQixFQUFFLE1BQU0sQ0FBQyxXQUFXO1FBQ3pDLHVCQUF1QixFQUFFLE1BQU0sQ0FBQyxhQUFhO1FBQzdDLHVFQUF1RTtRQUN2RSxpRkFBaUY7S0FDbEYsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFNlcnZpY2UgRGlzY292ZXJ5IEluZnJhc3RydWN0dXJlIFV0aWxpdGllc1xuICogXG4gKiBGT1IgQ0RLL0lORlJBU1RSVUNUVVJFIFVTRSBPTkxZIC0gVXNlZCBhdCBkZXBsb3ltZW50IHRpbWUgdG8gcmVnaXN0ZXIgc2VydmljZXMgd2l0aCBBV1MgQ2xvdWQgTWFwXG4gKiBGb3IgTGFtYmRhIHJ1bnRpbWUgc2VydmljZSBkaXNjb3ZlcnksIHVzZSBsaWIvbGFtYmRhL3NoYXJlZC9zZXJ2aWNlLWRpc2NvdmVyeS1ydW50aW1lLnRzXG4gKiBcbiAqIFRoaXMgbW9kdWxlIHByb3ZpZGVzIENESyBjb25zdHJ1Y3RzIGZvcjpcbiAqIC0gQ3JlYXRpbmcgQ2xvdWQgTWFwIG5hbWVzcGFjZXNcbiAqIC0gUmVnaXN0ZXJpbmcgc2VydmljZXMgd2l0aCBDbG91ZCBNYXBcbiAqIC0gQ29uZmlndXJpbmcgc2VydmljZSBkaXNjb3ZlcnkgZm9yIEVDUy9MYW1iZGEgc2VydmljZXNcbiAqL1xuXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgc2VydmljZWRpc2NvdmVyeSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VydmljZWRpc2NvdmVyeSc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBTZXJ2aWNlRGlzY292ZXJ5Q29uZmlnIHtcbiAgdnBjPzogZWMyLklWcGM7XG4gIG5hbWVzcGFjZT86IHN0cmluZztcbiAgZW52aXJvbm1lbnQ6ICdkZXYnIHwgJ3N0YWdpbmcnIHwgJ3Byb2QnO1xuICBleGlzdGluZ05hbWVzcGFjZUlkPzogc3RyaW5nOyAvLyBJbXBvcnQgZXhpc3RpbmcgbmFtZXNwYWNlIGluc3RlYWQgb2YgY3JlYXRpbmcgbmV3XG59XG5cbi8qKlxuICogTWFuYWdlcyBzZXJ2aWNlIGRpc2NvdmVyeSBuYW1lc3BhY2UgYW5kIHJlZ2lzdHJhdGlvbiBmb3IgQ0RLIHN0YWNrc1xuICogVXNlZCBhdCBkZXBsb3ltZW50IHRpbWUgdG8gcmVnaXN0ZXIgc2VydmljZXMgd2l0aCBBV1MgQ2xvdWQgTWFwXG4gKi9cbmV4cG9ydCBjbGFzcyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lc3BhY2U6IHNlcnZpY2VkaXNjb3ZlcnkuSU5hbWVzcGFjZTtcbiAgcHJpdmF0ZSByZWFkb25seSBzZXJ2aWNlczogTWFwPHN0cmluZywgc2VydmljZWRpc2NvdmVyeS5TZXJ2aWNlPiA9IG5ldyBNYXAoKTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBjb25maWc6IFNlcnZpY2VEaXNjb3ZlcnlDb25maWcpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgLy8gSWYgZXhpc3RpbmcgbmFtZXNwYWNlIElEIGlzIHByb3ZpZGVkLCBpbXBvcnQgaXRcbiAgICBpZiAoY29uZmlnLmV4aXN0aW5nTmFtZXNwYWNlSWQpIHtcbiAgICAgIC8vIEltcG9ydCBleGlzdGluZyBuYW1lc3BhY2UgZnJvbSBzaGFyZWQgc2VydmljZSBkaXNjb3Zlcnkgc3RhY2tcbiAgICAgIGNvbnN0IG5hbWVzcGFjZUFybiA9IGNkay5Gbi5pbXBvcnRWYWx1ZShgU2VydmljZURpc2NvdmVyeS0ke2NvbmZpZy5lbnZpcm9ubWVudH0tTmFtZXNwYWNlQXJuYCk7XG4gICAgICBjb25zdCBuYW1lc3BhY2VOYW1lID0gY2RrLkZuLmltcG9ydFZhbHVlKGBTZXJ2aWNlRGlzY292ZXJ5LSR7Y29uZmlnLmVudmlyb25tZW50fS1OYW1lc3BhY2VOYW1lYCk7XG4gICAgICBcbiAgICAgIHRoaXMubmFtZXNwYWNlID0gc2VydmljZWRpc2NvdmVyeS5IdHRwTmFtZXNwYWNlLmZyb21IdHRwTmFtZXNwYWNlQXR0cmlidXRlcyhcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ0ltcG9ydGVkTmFtZXNwYWNlJyxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWVzcGFjZUlkOiBjb25maWcuZXhpc3RpbmdOYW1lc3BhY2VJZCxcbiAgICAgICAgICBuYW1lc3BhY2VOYW1lOiBuYW1lc3BhY2VOYW1lLFxuICAgICAgICAgIG5hbWVzcGFjZUFybjogbmFtZXNwYWNlQXJuLFxuICAgICAgICB9XG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBDcmVhdGUgbmV3IG5hbWVzcGFjZSAoZm9yIHNoYXJlZCBzZXJ2aWNlIGRpc2NvdmVyeSBzdGFjayBvbmx5KVxuICAgICAgY29uc3QgbmFtZXNwYWNlTmFtZSA9IGNvbmZpZy5uYW1lc3BhY2UgfHwgYHBvc3RvbGlvLSR7Y29uZmlnLmVudmlyb25tZW50fS5sb2NhbGA7XG5cbiAgICAgIGlmIChjb25maWcudnBjKSB7XG4gICAgICAgIC8vIFByaXZhdGUgbmFtZXNwYWNlIGZvciBWUEMtYmFzZWQgc2VydmljZXNcbiAgICAgICAgdGhpcy5uYW1lc3BhY2UgPSBuZXcgc2VydmljZWRpc2NvdmVyeS5Qcml2YXRlRG5zTmFtZXNwYWNlKHRoaXMsICdOYW1lc3BhY2UnLCB7XG4gICAgICAgICAgbmFtZTogbmFtZXNwYWNlTmFtZSxcbiAgICAgICAgICB2cGM6IGNvbmZpZy52cGMsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGBTZXJ2aWNlIGRpc2NvdmVyeSBuYW1lc3BhY2UgZm9yIFBvc3RvbGlvICR7Y29uZmlnLmVudmlyb25tZW50fWAsXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gSFRUUCBuYW1lc3BhY2UgZm9yIExhbWJkYSBhbmQgcHVibGljIHNlcnZpY2VzXG4gICAgICAgIHRoaXMubmFtZXNwYWNlID0gbmV3IHNlcnZpY2VkaXNjb3ZlcnkuSHR0cE5hbWVzcGFjZSh0aGlzLCAnTmFtZXNwYWNlJywge1xuICAgICAgICAgIG5hbWU6IG5hbWVzcGFjZU5hbWUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGBTZXJ2aWNlIGRpc2NvdmVyeSBuYW1lc3BhY2UgZm9yIFBvc3RvbGlvICR7Y29uZmlnLmVudmlyb25tZW50fWAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE91dHB1dCBuYW1lc3BhY2UgZGV0YWlsc1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdOYW1lc3BhY2VJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm5hbWVzcGFjZS5uYW1lc3BhY2VJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWQgTWFwIE5hbWVzcGFjZSBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHtjZGsuU3RhY2sub2YodGhpcykuc3RhY2tOYW1lfS1OYW1lc3BhY2VJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTmFtZXNwYWNlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm5hbWVzcGFjZS5uYW1lc3BhY2VOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZCBNYXAgTmFtZXNwYWNlIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7Y2RrLlN0YWNrLm9mKHRoaXMpLnN0YWNrTmFtZX0tTmFtZXNwYWNlTmFtZWAsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBzZXJ2aWNlIHdpdGggQ2xvdWQgTWFwXG4gICAqL1xuICByZWdpc3RlclNlcnZpY2UoXG4gICAgc2VydmljZU5hbWU6IHN0cmluZyxcbiAgICBvcHRpb25zPzoge1xuICAgICAgZG5zUmVjb3JkVHlwZT86IHNlcnZpY2VkaXNjb3ZlcnkuRG5zUmVjb3JkVHlwZTtcbiAgICAgIGRuc1JlY29yZFR0bD86IGNkay5EdXJhdGlvbjtcbiAgICAgIGhlYWx0aENoZWNrPzogc2VydmljZWRpc2NvdmVyeS5IZWFsdGhDaGVja0NvbmZpZztcbiAgICAgIGN1c3RvbUF0dHJpYnV0ZXM/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9O1xuICAgIH1cbiAgKTogc2VydmljZWRpc2NvdmVyeS5TZXJ2aWNlIHtcbiAgICBpZiAodGhpcy5zZXJ2aWNlcy5oYXMoc2VydmljZU5hbWUpKSB7XG4gICAgICByZXR1cm4gdGhpcy5zZXJ2aWNlcy5nZXQoc2VydmljZU5hbWUpITtcbiAgICB9XG5cbiAgICAvLyBCdWlsZCBzZXJ2aWNlIHByb3BzIGJhc2VkIG9uIHdoZXRoZXIgd2UgaGF2ZSBETlMgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IHNlcnZpY2VQcm9wczogc2VydmljZWRpc2NvdmVyeS5TZXJ2aWNlUHJvcHMgPSBvcHRpb25zPy5kbnNSZWNvcmRUeXBlICE9PSB1bmRlZmluZWRcbiAgICAgID8ge1xuICAgICAgICAgIG5hbWVzcGFjZTogdGhpcy5uYW1lc3BhY2UsXG4gICAgICAgICAgbmFtZTogc2VydmljZU5hbWUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGBTZXJ2aWNlIGRpc2NvdmVyeSBmb3IgJHtzZXJ2aWNlTmFtZX1gLFxuICAgICAgICAgIGRuc1JlY29yZFR5cGU6IG9wdGlvbnMuZG5zUmVjb3JkVHlwZSxcbiAgICAgICAgICBkbnNUdGw6IG9wdGlvbnMuZG5zUmVjb3JkVHRsIHx8IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgICBjdXN0b21IZWFsdGhDaGVjazogb3B0aW9ucz8uaGVhbHRoQ2hlY2sgPyB7XG4gICAgICAgICAgICBmYWlsdXJlVGhyZXNob2xkOiAxLFxuICAgICAgICAgIH0gOiB1bmRlZmluZWQsXG4gICAgICAgIH1cbiAgICAgIDoge1xuICAgICAgICAgIG5hbWVzcGFjZTogdGhpcy5uYW1lc3BhY2UsXG4gICAgICAgICAgbmFtZTogc2VydmljZU5hbWUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGBTZXJ2aWNlIGRpc2NvdmVyeSBmb3IgJHtzZXJ2aWNlTmFtZX1gLFxuICAgICAgICAgIGN1c3RvbUhlYWx0aENoZWNrOiBvcHRpb25zPy5oZWFsdGhDaGVjayA/IHtcbiAgICAgICAgICAgIGZhaWx1cmVUaHJlc2hvbGQ6IDEsXG4gICAgICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICAgICAgfTtcblxuICAgIGNvbnN0IHNlcnZpY2UgPSBuZXcgc2VydmljZWRpc2NvdmVyeS5TZXJ2aWNlKHRoaXMsIGAke3NlcnZpY2VOYW1lfVNlcnZpY2VgLCBzZXJ2aWNlUHJvcHMpO1xuXG4gICAgdGhpcy5zZXJ2aWNlcy5zZXQoc2VydmljZU5hbWUsIHNlcnZpY2UpO1xuICAgIHJldHVybiBzZXJ2aWNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBhIHJlZ2lzdGVyZWQgc2VydmljZVxuICAgKi9cbiAgZ2V0U2VydmljZShzZXJ2aWNlTmFtZTogc3RyaW5nKTogc2VydmljZWRpc2NvdmVyeS5TZXJ2aWNlIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5zZXJ2aWNlcy5nZXQoc2VydmljZU5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIHNlcnZpY2UgZGlzY292ZXJ5IGNsaWVudCBjb25maWd1cmF0aW9uXG4gICAqL1xuICBnZXRDbGllbnRDb25maWcoKTogU2VydmljZURpc2NvdmVyeUNsaWVudENvbmZpZyB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWVzcGFjZUlkOiB0aGlzLm5hbWVzcGFjZS5uYW1lc3BhY2VJZCxcbiAgICAgIG5hbWVzcGFjZU5hbWU6IHRoaXMubmFtZXNwYWNlLm5hbWVzcGFjZU5hbWUsXG4gICAgICByZWdpb246IGNkay5TdGFjay5vZih0aGlzKS5yZWdpb24sXG4gICAgfTtcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZpY2VEaXNjb3ZlcnlDbGllbnRDb25maWcge1xuICBuYW1lc3BhY2VJZDogc3RyaW5nO1xuICBuYW1lc3BhY2VOYW1lOiBzdHJpbmc7XG4gIHJlZ2lvbjogc3RyaW5nO1xufVxuXG4vKipcbiAqIEhlbHBlciB0byByZWdpc3RlciBMYW1iZGEgZnVuY3Rpb24gd2l0aCBDbG91ZCBNYXBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyTGFtYmRhU2VydmljZShcbiAgc2VydmljZURpc2NvdmVyeTogU2VydmljZURpc2NvdmVyeU1hbmFnZXIsXG4gIHNlcnZpY2VOYW1lOiBzdHJpbmcsXG4gIGZ1bmN0aW9uVXJsOiBzdHJpbmcsXG4gIGVudmlyb25tZW50OiBzdHJpbmdcbik6IHNlcnZpY2VkaXNjb3ZlcnkuU2VydmljZSB7XG4gIC8vIEZvciBIVFRQIG5hbWVzcGFjZXMsIGRvbid0IHNwZWNpZnkgRE5TIHJlY29yZCB0eXBlXG4gIGNvbnN0IHNlcnZpY2UgPSBzZXJ2aWNlRGlzY292ZXJ5LnJlZ2lzdGVyU2VydmljZShzZXJ2aWNlTmFtZSwge1xuICAgIC8vIERvbid0IHNwZWNpZnkgZG5zUmVjb3JkVHlwZSBmb3IgSFRUUCBuYW1lc3BhY2VcbiAgICBjdXN0b21BdHRyaWJ1dGVzOiB7XG4gICAgICB1cmw6IGZ1bmN0aW9uVXJsLFxuICAgICAgdHlwZTogJ2xhbWJkYScsXG4gICAgICBlbnZpcm9ubWVudCxcbiAgICB9LFxuICB9KTtcblxuICAvLyBSZWdpc3RlciBpbnN0YW5jZSBmb3IgSFRUUCBuYW1lc3BhY2UgKGFsd2F5cyByZWdpc3RlciBmb3IgbGFtYmRhIHNlcnZpY2VzKVxuICBuZXcgc2VydmljZWRpc2NvdmVyeS5DZm5JbnN0YW5jZShzZXJ2aWNlRGlzY292ZXJ5LCBgJHtzZXJ2aWNlTmFtZX1JbnN0YW5jZWAsIHtcbiAgICBpbnN0YW5jZUlkOiBgJHtzZXJ2aWNlTmFtZX0tJHtlbnZpcm9ubWVudH1gLFxuICAgIHNlcnZpY2VJZDogc2VydmljZS5zZXJ2aWNlSWQsXG4gICAgaW5zdGFuY2VBdHRyaWJ1dGVzOiB7XG4gICAgICB1cmw6IGZ1bmN0aW9uVXJsLFxuICAgICAgdHlwZTogJ2xhbWJkYScsXG4gICAgICBlbnZpcm9ubWVudCxcbiAgICB9LFxuICB9KTtcblxuICByZXR1cm4gc2VydmljZTtcbn1cblxuLyoqXG4gKiBIZWxwZXIgdG8gcmVnaXN0ZXIgRUNTIHNlcnZpY2Ugd2l0aCBDbG91ZCBNYXBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyRWNzU2VydmljZShcbiAgc2VydmljZURpc2NvdmVyeTogU2VydmljZURpc2NvdmVyeU1hbmFnZXIsXG4gIHNlcnZpY2VOYW1lOiBzdHJpbmcsXG4gIGVjc1NlcnZpY2U6IGFueSwgLy8gVHlwZSB3b3VsZCBiZSBlY3MuSVNlcnZpY2VcbiAgcG9ydDogbnVtYmVyID0gMzAwMFxuKTogc2VydmljZWRpc2NvdmVyeS5TZXJ2aWNlIHtcbiAgY29uc3Qgc2VydmljZSA9IHNlcnZpY2VEaXNjb3ZlcnkucmVnaXN0ZXJTZXJ2aWNlKHNlcnZpY2VOYW1lLCB7XG4gICAgZG5zUmVjb3JkVHlwZTogc2VydmljZWRpc2NvdmVyeS5EbnNSZWNvcmRUeXBlLkEsXG4gICAgaGVhbHRoQ2hlY2s6IHtcbiAgICAgIHR5cGU6IHNlcnZpY2VkaXNjb3ZlcnkuSGVhbHRoQ2hlY2tUeXBlLkhUVFAsXG4gICAgICByZXNvdXJjZVBhdGg6ICcvaGVhbHRoJyxcbiAgICAgIGZhaWx1cmVUaHJlc2hvbGQ6IDIsXG4gICAgfSxcbiAgfSk7XG5cbiAgLy8gRUNTIHdpbGwgYXV0b21hdGljYWxseSByZWdpc3Rlci9kZXJlZ2lzdGVyIGluc3RhbmNlc1xuICByZXR1cm4gc2VydmljZTtcbn1cblxuLyoqXG4gKiBHZXQgc2VydmljZSBkaXNjb3ZlcnkgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciBMYW1iZGEvRUNTXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRTZXJ2aWNlRGlzY292ZXJ5RW52VmFycyhjb25maWc6IFNlcnZpY2VEaXNjb3ZlcnlDbGllbnRDb25maWcpOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9IHtcbiAgcmV0dXJuIHtcbiAgICBDTE9VRE1BUF9OQU1FU1BBQ0VfSUQ6IGNvbmZpZy5uYW1lc3BhY2VJZCxcbiAgICBDTE9VRE1BUF9OQU1FU1BBQ0VfTkFNRTogY29uZmlnLm5hbWVzcGFjZU5hbWUsXG4gICAgLy8gQVdTX1JFR0lPTiBpcyBhdXRvbWF0aWNhbGx5IHNldCBieSBMYW1iZGEgcnVudGltZSwgZG9uJ3Qgb3ZlcnJpZGUgaXRcbiAgICAvLyBTRVJWSUNFX0RJU0NPVkVSWV9FTkFCTEVEIHJlbW92ZWQgLSB3ZSBub3cgY2hlY2sgZm9yIENsb3VkIE1hcCBjb25maWcgZGlyZWN0bHlcbiAgfTtcbn0iXX0=