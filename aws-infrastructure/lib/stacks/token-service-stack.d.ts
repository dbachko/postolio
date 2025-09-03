/**
 * Token Service CDK Stack
 * Deploys DynamoDB, KMS, Lambda, and API Gateway for OAuth token management
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface TokenServiceStackProps extends cdk.StackProps {
    environment: 'dev' | 'staging' | 'prod';
    alertEmail?: string;
    serviceDiscoveryNamespaceId?: string;
}
export declare class TokenServiceStack extends cdk.Stack {
    readonly apiUrl: string;
    readonly tableName: string;
    readonly kmsKeyId: string;
    constructor(scope: Construct, id: string, props: TokenServiceStackProps);
    private applyCdkNagSuppressions;
}
