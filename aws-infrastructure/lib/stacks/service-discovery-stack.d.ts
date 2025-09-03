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
    vpc?: ec2.IVpc;
}
export declare class ServiceDiscoveryStack extends cdk.Stack {
    readonly namespace: servicediscovery.INamespace;
    readonly namespaceId: string;
    readonly namespaceName: string;
    constructor(scope: Construct, id: string, props: ServiceDiscoveryStackProps);
}
