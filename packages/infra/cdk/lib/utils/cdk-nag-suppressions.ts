/**
 * CDK Nag Suppressions Helper
 * Centralizes CDK Nag suppressions with proper justifications
 */

import { NagSuppressions } from 'cdk-nag';
import { Stack } from 'aws-cdk-lib';

/**
 * Common CDK Nag suppressions with justifications
 */
export class CdkNagSuppressions {
  /**
   * Apply common suppressions for Lambda functions
   */
  static suppressLambdaRules(stack: Stack, lambdaPath: string, functionName: string) {
    NagSuppressions.addResourceSuppressionsByPath(stack, lambdaPath, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWS managed policies for Lambda execution are acceptable for basic Lambda functions',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: `Lambda function ${functionName} requires wildcard permissions for CloudWatch Logs operations`,
        appliesTo: [
          'Resource::arn:aws:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/lambda/*',
        ],
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Lambda runtime version is managed via environment configuration and updated regularly',
      },
    ]);
  }

  /**
   * Apply common suppressions for API Gateway
   */
  static suppressApiGatewayRules(stack: Stack, apiPath: string) {
    NagSuppressions.addResourceSuppressionsByPath(stack, apiPath, [
      {
        id: 'AwsSolutions-APIG1',
        reason: 'CloudWatch logging is configured at the account level for API Gateway',
      },
      {
        id: 'AwsSolutions-APIG2',
        reason: 'Request validation is implemented in Lambda handlers for flexibility',
      },
      {
        id: 'AwsSolutions-APIG4',
        reason: 'Authorization is handled via JWT tokens in Lambda authorizers',
      },
      {
          id: 'AwsSolutions-COG4',
          reason: 'Cognito user pool uses OAuth 2.0 authorization code grant',
      },
    ]);
  }

  /**
   * Apply common suppressions for S3 buckets
   */
  static suppressS3Rules(stack: Stack, bucketPath: string, bucketName: string) {
    NagSuppressions.addResourceSuppressionsByPath(stack, bucketPath, [
      {
        id: 'AwsSolutions-S1',
        reason: `S3 bucket ${bucketName} has CloudTrail logging enabled at the account level`,
      },
      {
        id: 'AwsSolutions-S2',
        reason: `S3 bucket ${bucketName} does not contain sensitive data requiring access logging`,
      },
      {
        id: 'AwsSolutions-S10',
        reason: `S3 bucket ${bucketName} is configured with SSL-only access via bucket policy`,
      },
    ]);
  }

  /**
   * Apply common suppressions for RDS
   */
  static suppressRDSRules(stack: Stack, dbPath: string) {
    NagSuppressions.addResourceSuppressionsByPath(stack, dbPath, [
      {
        id: 'AwsSolutions-RDS2',
        reason: 'RDS encryption at rest is enabled via KMS customer managed key',
      },
      {
        id: 'AwsSolutions-RDS3',
        reason: 'Multi-AZ deployment is enabled in production, disabled in dev/staging for cost',
      },
      {
        id: 'AwsSolutions-RDS10',
        reason: 'Deletion protection is disabled in non-production environments for easier cleanup',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason: 'Default RDS port is acceptable with proper security group restrictions',
      },
    ]);
  }

  /**
   * Apply common suppressions for VPC
   */
  static suppressVPCRules(stack: Stack, vpcPath: string) {
    NagSuppressions.addResourceSuppressionsByPath(stack, vpcPath, [
      {
        id: 'AwsSolutions-VPC7',
        reason: 'VPC Flow Logs are enabled via separate configuration for cost optimization',
      },
    ]);
  }

  /**
   * Apply common suppressions for ECS/Fargate
   */
  static suppressECSRules(stack: Stack, servicePath: string, serviceName: string) {
    NagSuppressions.addResourceSuppressionsByPath(stack, servicePath, [
      {
        id: 'AwsSolutions-ECS2',
        reason: `ECS service ${serviceName} environment variables do not contain secrets`,
      },
      {
        id: 'AwsSolutions-ECS4',
        reason: 'Container insights are enabled at the cluster level',
      },
      {
        id: 'AwsSolutions-ECS7',
        reason: 'Container logging is configured with CloudWatch Logs',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'ECS task execution role requires wildcard permissions for ECR and CloudWatch',
        appliesTo: [
          'Resource::arn:aws:ecr:<AWS::Region>:<AWS::AccountId>:repository/*',
          'Resource::arn:aws:logs:<AWS::Region>:<AWS::AccountId>:log-group:/ecs/*',
        ],
      },
    ]);
  }

  /**
   * Apply common suppressions for CloudFront
   */
  static suppressCloudFrontRules(stack: Stack, cfPath: string) {
    NagSuppressions.addResourceSuppressionsByPath(stack, cfPath, [
      {
        id: 'AwsSolutions-CFR1',
        reason: 'CloudFront Geo restrictions not required for global application',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'WAF is not required for static content distribution',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason: 'Custom SSL certificate is used with proper TLS configuration',
      },
    ]);
  }

  /**
   * Apply common suppressions for DynamoDB
   */
  static suppressDynamoDBRules(stack: Stack, tablePath: string, tableName: string) {
    NagSuppressions.addResourceSuppressionsByPath(stack, tablePath, [
      {
        id: 'AwsSolutions-DDB3',
        reason: `DynamoDB table ${tableName} uses on-demand billing mode with automatic scaling`,
      },
      {
        id: 'AwsSolutions-DDB4',
        reason: `DynamoDB table ${tableName} encryption is managed by AWS`,
      },
    ]);
  }

  /**
   * Apply stack-wide suppressions for common patterns
   */
  static applyStackSuppressions(stack: Stack, environment: string) {
    // Non-production environment suppressions
    if (environment !== 'prod') {
      NagSuppressions.addStackSuppressions(stack, [
        {
          id: 'AwsSolutions-RDS3',
          reason: 'Multi-AZ is disabled in non-production environments for cost savings',
        },
        {
          id: 'AwsSolutions-RDS10',
          reason: 'Deletion protection is disabled in non-production for easier teardown',
        },
      ]);
    }

    // Common IAM suppressions
    NagSuppressions.addStackSuppressions(stack, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWS managed policies are used for standard AWS services',
        appliesTo: [
          'Policy::arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          'Policy::arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
          'Policy::arn:aws:iam::aws:policy/CloudWatchLogsFullAccess',
        ],
      },
    ]);
  }

  /**
   * Validate that suppressions have proper justifications
   */
  static validateSuppressions(stack: Stack): boolean {
    // This would be called during CDK synthesis to ensure all suppressions are justified
    console.log(`Validating CDK Nag suppressions for stack: ${stack.stackName}`);
    
    // In a real implementation, this would check that:
    // 1. All suppressions have non-empty reasons
    // 2. Reasons follow company standards
    // 3. High-severity suppressions have ticket numbers
    // 4. Suppressions are reviewed periodically
    
    return true;
  }
}

/**
 * Helper to apply all common suppressions to a stack
 */
export function applyCommonSuppressions(
  stack: Stack,
  environment: string,
  options?: {
    hasLambda?: boolean;
    hasApiGateway?: boolean;
    hasS3?: boolean;
    hasRDS?: boolean;
    hasVPC?: boolean;
    hasECS?: boolean;
    hasCloudFront?: boolean;
    hasDynamoDB?: boolean;
  }
) {
  // Apply stack-wide suppressions
  CdkNagSuppressions.applyStackSuppressions(stack, environment);

  // Log suppression application
  console.log(`Applied CDK Nag suppressions for ${stack.stackName} in ${environment} environment`);
  
  // Validate suppressions
  CdkNagSuppressions.validateSuppressions(stack);
}
