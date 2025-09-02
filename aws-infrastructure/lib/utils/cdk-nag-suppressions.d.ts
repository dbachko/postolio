/**
 * CDK Nag Suppressions Helper
 * Centralizes CDK Nag suppressions with proper justifications
 */
import { Stack } from 'aws-cdk-lib';
/**
 * Common CDK Nag suppressions with justifications
 */
export declare class CdkNagSuppressions {
    /**
     * Apply common suppressions for Lambda functions
     */
    static suppressLambdaRules(stack: Stack, lambdaPath: string, functionName: string): void;
    /**
     * Apply common suppressions for API Gateway
     */
    static suppressApiGatewayRules(stack: Stack, apiPath: string): void;
    /**
     * Apply common suppressions for S3 buckets
     */
    static suppressS3Rules(stack: Stack, bucketPath: string, bucketName: string): void;
    /**
     * Apply common suppressions for RDS
     */
    static suppressRDSRules(stack: Stack, dbPath: string): void;
    /**
     * Apply common suppressions for VPC
     */
    static suppressVPCRules(stack: Stack, vpcPath: string): void;
    /**
     * Apply common suppressions for ECS/Fargate
     */
    static suppressECSRules(stack: Stack, servicePath: string, serviceName: string): void;
    /**
     * Apply common suppressions for CloudFront
     */
    static suppressCloudFrontRules(stack: Stack, cfPath: string): void;
    /**
     * Apply common suppressions for DynamoDB
     */
    static suppressDynamoDBRules(stack: Stack, tablePath: string, tableName: string): void;
    /**
     * Apply stack-wide suppressions for common patterns
     */
    static applyStackSuppressions(stack: Stack, environment: string): void;
    /**
     * Validate that suppressions have proper justifications
     */
    static validateSuppressions(stack: Stack): boolean;
}
/**
 * Helper to apply all common suppressions to a stack
 */
export declare function applyCommonSuppressions(stack: Stack, environment: string, options?: {
    hasLambda?: boolean;
    hasApiGateway?: boolean;
    hasS3?: boolean;
    hasRDS?: boolean;
    hasVPC?: boolean;
    hasECS?: boolean;
    hasCloudFront?: boolean;
    hasDynamoDB?: boolean;
}): void;
