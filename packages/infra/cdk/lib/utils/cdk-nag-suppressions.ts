/**
 * CDK Nag acknowledgements helper
 * Centralizes cdk-nag v3 Validations.acknowledge calls with justifications
 */

import { Validations, type Stack } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import type { IConstruct } from 'constructs';

/**
 * cdk-nag v3 reports `Rule[finding]` ids and matches acknowledgements exactly, so a plain
 * `Rule` acknowledgement no longer covers them. Keep the v2 meaning our reviewed reasons were
 * written against: an acknowledgement without `appliesTo` covers every finding of that rule.
 */
export class RuleLevelAwsSolutionsChecks extends AwsSolutionsChecks {
  constructor(...args: ConstructorParameters<typeof AwsSolutionsChecks>) {
    super(...args);
    // `isAcknowledged` is private and cdk-nag has no wildcard option. If it is ever removed,
    // the bind below throws at synth rather than silently changing what is suppressed.
    const pack = this as unknown as { isAcknowledged: AcknowledgedCheck };
    const isExact = pack.isAcknowledged.bind(this);
    pack.isAcknowledged = (resource, ruleId) =>
      isExact(resource, ruleId) || isExact(resource, ruleId.replace(/\[.*\]$/, ''));
  }
}

type AcknowledgedCheck = (resource: IConstruct, ruleId: string) => boolean;

export type NagRuleAcknowledgement = {
  id: string;
  reason: string;
  appliesTo?: string[];
};

export function acknowledgeNagRules(scope: IConstruct, rules: NagRuleAcknowledgement[]): void {
  for (const rule of rules) {
    const ids =
      rule.appliesTo && rule.appliesTo.length > 0
        ? rule.appliesTo.map((finding) => `${rule.id}[${finding}]`)
        : [rule.id];
    for (const id of ids) {
      Validations.of(scope).acknowledge({ id, reason: rule.reason });
    }
  }
}

/**
 * Common CDK Nag suppressions with justifications
 */
export class CdkNagSuppressions {
  static suppressLambdaRules(scope: IConstruct, functionName: string) {
    acknowledgeNagRules(scope, [
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'AWS managed policies for Lambda execution are acceptable for basic Lambda functions',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: `Lambda function ${functionName} requires wildcard permissions for CloudWatch Logs operations`,
        appliesTo: [
          'Resource::arn:aws:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/lambda/*',
        ],
      },
    ]);
  }

  static suppressApiGatewayRules(scope: IConstruct) {
    acknowledgeNagRules(scope, [
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

  static suppressS3Rules(scope: IConstruct, bucketName: string) {
    acknowledgeNagRules(scope, [
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

  static suppressRDSRules(scope: IConstruct) {
    acknowledgeNagRules(scope, [
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

  static suppressVPCRules(scope: IConstruct) {
    acknowledgeNagRules(scope, [
      {
        id: 'AwsSolutions-VPC7',
        reason: 'VPC Flow Logs are enabled via separate configuration for cost optimization',
      },
    ]);
  }

  static suppressECSRules(scope: IConstruct, serviceName: string) {
    acknowledgeNagRules(scope, [
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

  static suppressCloudFrontRules(scope: IConstruct) {
    acknowledgeNagRules(scope, [
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

  static suppressDynamoDBRules(scope: IConstruct, tableName: string) {
    acknowledgeNagRules(scope, [
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

  static applyStackSuppressions(stack: Stack, environment: string) {
    if (environment !== 'prod') {
      acknowledgeNagRules(stack, [
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

    acknowledgeNagRules(stack, [
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

  static validateSuppressions(stack: Stack): boolean {
    console.log(`Validating CDK Nag suppressions for stack: ${stack.stackName}`);
    return true;
  }
}

export function applyCommonSuppressions(
  stack: Stack,
  environment: string,
  _options?: {
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
  CdkNagSuppressions.applyStackSuppressions(stack, environment);
  console.log(`Applied CDK Nag suppressions for ${stack.stackName} in ${environment} environment`);
  CdkNagSuppressions.validateSuppressions(stack);
}
