/**
 * Shared Service Discovery Stack
 * Creates a single Cloud Map namespace that all services can register with
 */

import * as cdk from 'aws-cdk-lib';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface ServiceDiscoveryStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  vpc?: ec2.IVpc; // Optional VPC for private DNS namespace
}

export class ServiceDiscoveryStack extends cdk.Stack {
  public readonly namespace: servicediscovery.INamespace;
  public readonly namespaceId: string;
  public readonly namespaceName: string;

  constructor(scope: Construct, id: string, props: ServiceDiscoveryStackProps) {
    super(scope, id, props);

    const { environment, vpc } = props;
    const namespaceName = `postolio-${environment}.local`;

    // Create namespace based on whether VPC is provided
    if (vpc) {
      // Private DNS namespace for VPC-based services (ECS)
      this.namespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
        name: namespaceName,
        vpc,
        description: `Shared service discovery namespace for Postolio ${environment}`,
      });
    } else {
      // HTTP namespace for serverless services (Lambda)
      this.namespace = new servicediscovery.HttpNamespace(this, 'Namespace', {
        name: namespaceName,
        description: `Shared service discovery namespace for Postolio ${environment}`,
      });
    }

    this.namespaceId = this.namespace.namespaceId;
    this.namespaceName = this.namespace.namespaceName;

    // Export namespace details for other stacks to import
    new cdk.CfnOutput(this, 'NamespaceId', {
      value: this.namespaceId,
      description: 'Cloud Map Namespace ID',
      exportName: `ServiceDiscovery-${environment}-NamespaceId`,
    });

    new cdk.CfnOutput(this, 'NamespaceName', {
      value: this.namespaceName,
      description: 'Cloud Map Namespace Name',
      exportName: `ServiceDiscovery-${environment}-NamespaceName`,
    });

    new cdk.CfnOutput(this, 'NamespaceArn', {
      value: this.namespace.namespaceArn,
      description: 'Cloud Map Namespace ARN',
      exportName: `ServiceDiscovery-${environment}-NamespaceArn`,
    });

    // Add tags
    cdk.Tags.of(this).add('Service', 'ServiceDiscovery');
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}