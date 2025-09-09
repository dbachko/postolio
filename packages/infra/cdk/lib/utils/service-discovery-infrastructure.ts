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

import * as cdk from "aws-cdk-lib";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface ServiceDiscoveryConfig {
  vpc?: ec2.IVpc;
  namespace?: string;
  environment: "dev" | "staging" | "prod";
  existingNamespaceId?: string; // Import existing namespace instead of creating new
}

/**
 * Manages service discovery namespace and registration for CDK stacks
 * Used at deployment time to register services with AWS Cloud Map
 */
export class ServiceDiscoveryManager extends Construct {
  public readonly namespace: servicediscovery.INamespace;
  private readonly services: Map<string, servicediscovery.Service> = new Map();

  constructor(scope: Construct, id: string, config: ServiceDiscoveryConfig) {
    super(scope, id);

    // If existing namespace ID is provided, import it
    if (config.existingNamespaceId) {
      // Import existing namespace from shared service discovery stack
      const namespaceArn = cdk.Fn.importValue(
        `ServiceDiscovery-${config.environment}-NamespaceArn`,
      );
      const namespaceName = cdk.Fn.importValue(
        `ServiceDiscovery-${config.environment}-NamespaceName`,
      );

      this.namespace =
        servicediscovery.HttpNamespace.fromHttpNamespaceAttributes(
          this,
          "ImportedNamespace",
          {
            namespaceId: config.existingNamespaceId,
            namespaceName: namespaceName,
            namespaceArn: namespaceArn,
          },
        );
    } else {
      // Create new namespace (for shared service discovery stack only)
      const namespaceName =
        config.namespace || `postolio-${config.environment}.local`;

      if (config.vpc) {
        // Private namespace for VPC-based services
        this.namespace = new servicediscovery.PrivateDnsNamespace(
          this,
          "Namespace",
          {
            name: namespaceName,
            vpc: config.vpc,
            description: `Service discovery namespace for Postolio ${config.environment}`,
          },
        );
      } else {
        // HTTP namespace for Lambda and public services
        this.namespace = new servicediscovery.HttpNamespace(this, "Namespace", {
          name: namespaceName,
          description: `Service discovery namespace for Postolio ${config.environment}`,
        });
      }
    }

    // Output namespace details
    new cdk.CfnOutput(this, "NamespaceId", {
      value: this.namespace.namespaceId,
      description: "Cloud Map Namespace ID",
      exportName: `${cdk.Stack.of(this).stackName}-NamespaceId`,
    });

    new cdk.CfnOutput(this, "NamespaceName", {
      value: this.namespace.namespaceName,
      description: "Cloud Map Namespace Name",
      exportName: `${cdk.Stack.of(this).stackName}-NamespaceName`,
    });
  }

  /**
   * Register a service with Cloud Map
   */
  registerService(
    serviceName: string,
    options?: {
      dnsRecordType?: servicediscovery.DnsRecordType;
      dnsRecordTtl?: cdk.Duration;
      healthCheck?: servicediscovery.HealthCheckConfig;
      customAttributes?: { [key: string]: string };
    },
  ): servicediscovery.Service {
    if (this.services.has(serviceName)) {
      return this.services.get(serviceName)!;
    }

    // Build service props based on whether we have DNS configuration
    const serviceProps: servicediscovery.ServiceProps =
      options?.dnsRecordType !== undefined
        ? {
            namespace: this.namespace,
            name: serviceName,
            description: `Service discovery for ${serviceName}`,
            dnsRecordType: options.dnsRecordType,
            dnsTtl: options.dnsRecordTtl || cdk.Duration.seconds(30),
            customHealthCheck: options?.healthCheck
              ? {
                  failureThreshold: 1,
                }
              : undefined,
          }
        : {
            namespace: this.namespace,
            name: serviceName,
            description: `Service discovery for ${serviceName}`,
            customHealthCheck: options?.healthCheck
              ? {
                  failureThreshold: 1,
                }
              : undefined,
          };

    const service = new servicediscovery.Service(
      this,
      `${serviceName}Service`,
      serviceProps,
    );

    this.services.set(serviceName, service);
    return service;
  }

  /**
   * Get a registered service
   */
  getService(serviceName: string): servicediscovery.Service | undefined {
    return this.services.get(serviceName);
  }

  /**
   * Create a service discovery client configuration
   */
  getClientConfig(): ServiceDiscoveryClientConfig {
    return {
      namespaceId: this.namespace.namespaceId,
      namespaceName: this.namespace.namespaceName,
      region: cdk.Stack.of(this).region,
    };
  }
}

export interface ServiceDiscoveryClientConfig {
  namespaceId: string;
  namespaceName: string;
  region: string;
}

/**
 * Helper to register Lambda function with Cloud Map
 */
export function registerLambdaService(
  serviceDiscovery: ServiceDiscoveryManager,
  serviceName: string,
  functionUrl: string,
  environment: string,
): servicediscovery.Service {
  // For HTTP namespaces, don't specify DNS record type
  const service = serviceDiscovery.registerService(serviceName, {
    // Don't specify dnsRecordType for HTTP namespace
    customAttributes: {
      url: functionUrl,
      type: "lambda",
      environment,
    },
  });

  // Register instance for HTTP namespace (always register for lambda services)
  new servicediscovery.CfnInstance(serviceDiscovery, `${serviceName}Instance`, {
    instanceId: `${serviceName}-${environment}`,
    serviceId: service.serviceId,
    instanceAttributes: {
      url: functionUrl,
      type: "lambda",
      environment,
    },
  });

  return service;
}

/**
 * Helper to register ECS service with Cloud Map
 */
export function registerEcsService(
  serviceDiscovery: ServiceDiscoveryManager,
  serviceName: string,
  ecsService: any, // Type would be ecs.IService
  port: number = 3000,
): servicediscovery.Service {
  const service = serviceDiscovery.registerService(serviceName, {
    dnsRecordType: servicediscovery.DnsRecordType.A,
    healthCheck: {
      type: servicediscovery.HealthCheckType.HTTP,
      resourcePath: "/health",
      failureThreshold: 2,
    },
  });

  // ECS will automatically register/deregister instances
  return service;
}

/**
 * Get service discovery environment variables for Lambda/ECS
 */
export function getServiceDiscoveryEnvVars(
  config: ServiceDiscoveryClientConfig,
): { [key: string]: string } {
  return {
    CLOUDMAP_NAMESPACE_ID: config.namespaceId,
    CLOUDMAP_NAMESPACE_NAME: config.namespaceName,
    // AWS_REGION is automatically set by Lambda runtime, don't override it
    // SERVICE_DISCOVERY_ENABLED removed - we now check for Cloud Map config directly
  };
}
