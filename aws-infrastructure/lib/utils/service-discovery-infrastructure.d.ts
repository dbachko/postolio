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
import * as cdk from 'aws-cdk-lib';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
export interface ServiceDiscoveryConfig {
    vpc?: ec2.IVpc;
    namespace?: string;
    environment: 'dev' | 'staging' | 'prod';
    existingNamespaceId?: string;
}
/**
 * Manages service discovery namespace and registration for CDK stacks
 * Used at deployment time to register services with AWS Cloud Map
 */
export declare class ServiceDiscoveryManager extends Construct {
    readonly namespace: servicediscovery.INamespace;
    private readonly services;
    constructor(scope: Construct, id: string, config: ServiceDiscoveryConfig);
    /**
     * Register a service with Cloud Map
     */
    registerService(serviceName: string, options?: {
        dnsRecordType?: servicediscovery.DnsRecordType;
        dnsRecordTtl?: cdk.Duration;
        healthCheck?: servicediscovery.HealthCheckConfig;
        customAttributes?: {
            [key: string]: string;
        };
    }): servicediscovery.Service;
    /**
     * Get a registered service
     */
    getService(serviceName: string): servicediscovery.Service | undefined;
    /**
     * Create a service discovery client configuration
     */
    getClientConfig(): ServiceDiscoveryClientConfig;
}
export interface ServiceDiscoveryClientConfig {
    namespaceId: string;
    namespaceName: string;
    region: string;
}
/**
 * Helper to register Lambda function with Cloud Map
 */
export declare function registerLambdaService(serviceDiscovery: ServiceDiscoveryManager, serviceName: string, functionUrl: string, environment: string): servicediscovery.Service;
/**
 * Helper to register ECS service with Cloud Map
 */
export declare function registerEcsService(serviceDiscovery: ServiceDiscoveryManager, serviceName: string, ecsService: any, // Type would be ecs.IService
port?: number): servicediscovery.Service;
/**
 * Get service discovery environment variables for Lambda/ECS
 */
export declare function getServiceDiscoveryEnvVars(config: ServiceDiscoveryClientConfig): {
    [key: string]: string;
};
