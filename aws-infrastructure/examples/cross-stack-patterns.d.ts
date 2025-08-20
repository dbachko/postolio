/**
 * Cross-Stack Dependencies in AWS CDK: Complete Examples
 *
 * This file demonstrates various patterns for sharing resources between CDK stacks,
 * specifically focused on sharing API URLs and other configuration between stacks.
 */
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
export declare class SourceStack extends cdk.Stack {
    readonly apiEndpoint: string;
    readonly apiGateway: apigateway.RestApi;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
export declare class ConsumerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, sourceStack: SourceStack, props?: cdk.StackProps);
}
export declare class ExportingStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
export declare class ImportingStack extends cdk.Stack {
    constructor(scope: Construct, id: string, exportingStackName: string, props?: cdk.StackProps);
}
export declare class ParameterPublisherStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
export declare class ParameterConsumerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, publisherStackName: string, props?: cdk.StackProps);
}
export declare class SecretPublisherStack extends cdk.Stack {
    readonly configSecret: secretsmanager.Secret;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
export declare class SecretConsumerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, publisherStackName: string, props?: cdk.StackProps);
}
interface CrossStackConfig {
    environment: 'dev' | 'staging' | 'prod';
    projectName: string;
    alertEmail?: string;
}
export declare class ProductionSourceStack extends cdk.Stack {
    readonly apiEndpoint: string;
    readonly configSecret: secretsmanager.Secret;
    constructor(scope: Construct, id: string, config: CrossStackConfig, props?: cdk.StackProps);
}
export declare class ProductionConsumerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, sourceStack: ProductionSourceStack, config: CrossStackConfig, props?: cdk.StackProps);
}
/**
 * Example of how to deploy stacks with dependencies in a single CDK app
 */
export declare function createCrossStackApp(): cdk.App;
export {};
