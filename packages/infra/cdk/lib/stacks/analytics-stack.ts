/**
 * Analytics Stack - Background ingestion worker (ECS Fargate)
 * Fetches social metrics and writes to PublicationMetricsLatest / AccountMetricSample
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { acknowledgeNagRules } from '../utils/cdk-nag-suppressions';

export interface AnalyticsStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  imageTag?: string;
}

export class AnalyticsStack extends cdk.Stack {
  public readonly ecsCluster: ecs.ICluster;

  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);

    const { environment, imageTag } = props;
    const prefix = `postolio-${environment}-analytics`;

    // Resolve image tag (allow override via context)
    const contextImageTag = imageTag ?? (this.node.tryGetContext('imageTag') as string | undefined);
    const defaultImageTag = `analytics-${environment}-latest`;
    const containerImageTag =
      contextImageTag && contextImageTag.trim().length > 0 ? contextImageTag : defaultImageTag;

    // ==================== Import Foundation Resources ====================
    const vpcId = ssm.StringParameter.valueFromLookup(this, `/postolio/${environment}/vpc/id`);
    const hasFoundationVpc = vpcId && !vpcId.startsWith('dummy-value-for-');
    if (!hasFoundationVpc) {
      console.log(
        `Foundation VPC not available for environment ${environment} - Analytics stack requires Foundation`
      );
    }

    let vpc: ec2.IVpc;
    if (hasFoundationVpc) {
      vpc = ec2.Vpc.fromLookup(this, 'FoundationVpc', { vpcId });
    } else {
      vpc = new ec2.Vpc(this, 'PlaceholderVpc', { maxAzs: 2, natGateways: 1 });
      // Only exists for synth without a Foundation VPC; real deployments look that VPC up.
      acknowledgeNagRules(vpc, [
        { id: 'AwsSolutions-VPC7', reason: 'Placeholder VPC is never deployed to production' },
      ]);
    }

    // Security groups and secrets
    const ecsSecurityGroupId = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/security-groups/ecs`
    );
    const ecsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'EcsSecurityGroup',
      ecsSecurityGroupId
    );

    const databaseSecretArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/database/secret-arn`
    );
    const databaseSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'DatabaseSecret',
      databaseSecretArn
    );

    const databaseEndpointValue = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/database/endpoint`
    );

    const redisEndpointParam = ssm.StringParameter.fromStringParameterName(
      this,
      'RedisEndpointParameter',
      `/postolio/${environment}/cache/endpoint`
    );
    const redisPortParam = ssm.StringParameter.fromStringParameterName(
      this,
      'RedisPortParameter',
      `/postolio/${environment}/cache/port`
    );
    const sentryDsn =
      (this.node.tryGetContext('sentryDsn') as string | undefined) ||
      process.env.SENTRY_BACKEND_DSN;

    const tokenServiceUrl = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/auth/token-service-url`
    );
    const tokenServiceArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/auth/token-service-arn`
    );

    // ==================== ECS Cluster ====================
    // Reuse existing API cluster to inherit the correct VPC/subnet selection
    const apiClusterNameParam = `/postolio/${environment}/api/cluster-name`;
    const defaultApiClusterName = `postolio-${environment}-api-cluster`;
    const apiClusterNameLookup = ssm.StringParameter.valueFromLookup(
      this,
      apiClusterNameParam,
      defaultApiClusterName
    );
    const hasApiClusterName =
      apiClusterNameLookup.length > 0 &&
      !apiClusterNameLookup.startsWith('dummy-value-for-') &&
      apiClusterNameLookup !== defaultApiClusterName;
    const apiClusterName = hasApiClusterName ? apiClusterNameLookup : defaultApiClusterName;
    if (!hasApiClusterName) {
      cdk.Annotations.of(this).addWarning(
        `SSM parameter ${apiClusterNameParam} not found. Falling back to deterministic cluster name ${defaultApiClusterName}.`
      );
    }
    this.ecsCluster = ecs.Cluster.fromClusterAttributes(this, 'EcsCluster', {
      clusterName: apiClusterName,
      vpc,
      securityGroups: [ecsSecurityGroup],
    });

    // ==================== IAM Roles ====================
    const executionRole = new iam.Role(this, 'EcsExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
      inlinePolicies: {
        SecretAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [
                databaseSecret.secretArn,
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio-${environment}/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['kms:Decrypt'],
              resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
              conditions: {
                StringEquals: {
                  'kms:ViaService': `secretsmanager.${this.region}.amazonaws.com`,
                },
              },
            }),
          ],
        }),
      },
    });

    const taskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess')],
      inlinePolicies: {
        PostolioTaskPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
              resources: [
                databaseSecret.secretArn,
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio-${environment}/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:DescribeParameters'],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/*`,
              ],
            }),
            // Allow invoking Token Service Function URL (IAM-authenticated)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunctionUrl'],
              resources: [tokenServiceArn],
            }),
          ],
        }),
      },
    });

    // ==================== Task Definition & Container ====================
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: environment === 'prod' ? 512 : 256,
      memoryLimitMiB: environment === 'prod' ? 1024 : 512,
      executionRole,
      taskRole,
    });

    const repository = ecr.Repository.fromRepositoryName(this, 'PostolioRepository', 'postolio');

    const container = taskDef.addContainer('Ingestor', {
      image: ecs.ContainerImage.fromEcrRepository(repository, containerImageTag),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `${prefix}-ingestor`,
        logRetention: logs.RetentionDays.TWO_WEEKS,
      }),
      environment: {
        NODE_ENV: environment,
        AWS_REGION: this.region,
        INGESTOR_LOOP_MS: '60000',
        TOKEN_SERVICE_URL: tokenServiceUrl,
        FB_GRAPH_API_VERSION: (this.node.tryGetContext('fbGraphApiVersion') as string) || 'v24.0',
        // Allow rate limit override per environment (default handled in code)
        RATE_LIMIT_PER_HOUR: (this.node.tryGetContext('rateLimitPerHour') as string) || '200',
        // DB_* from SSM (split host:port at runtime via CloudFormation Fn)
        DB_HOST: cdk.Fn.select(0, cdk.Fn.split(':', databaseEndpointValue)),
        DB_PORT: cdk.Fn.select(1, cdk.Fn.split(':', databaseEndpointValue)),
        DB_NAME: 'postolio',
        REDIS_HOST: redisEndpointParam.stringValue,
        REDIS_PORT: redisPortParam.stringValue,
        REDIS_URL: `redis://${redisEndpointParam.stringValue}:${redisPortParam.stringValue}`,
        ...(sentryDsn && { SENTRY_BACKEND_DSN: sentryDsn }),
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(databaseSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
      },
    });

    // Log level: default to 'info' (quieter); allow override via CDK context logLevel
    const ctxLogLevel = (this.node.tryGetContext('logLevel') as string) || 'info';
    container.addEnvironment('LOG_LEVEL', ctxLogLevel);

    // No bootstrap enqueues in production deployments

    // ==================== Service ====================
    // Prefer explicit private subnet IDs from SSM to avoid context drift
    const privateSubnetIdsCsv = ssm.StringParameter.valueFromLookup(
      this,
      `/postolio/${environment}/vpc/private-subnet-ids`
    );
    const privateSubnets = privateSubnetIdsCsv
      .split(',')
      .map((id, idx) => ec2.Subnet.fromSubnetId(this, `AnalyticsPrivSubnet${idx}`, id.trim()));

    const service = new ecs.FargateService(this, 'IngestorService', {
      serviceName: `${prefix}-service`,
      cluster: this.ecsCluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: { subnets: privateSubnets },
    });

    // ==================== CDK Nag Suppressions ====================
    // Execution role managed policy and wildcard allowances are standard for ECS execution
    acknowledgeNagRules(executionRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'ECS Execution role uses AWS managed policy AmazonECSTaskExecutionRolePolicy for pulling images and writing logs.',
        appliesTo: [
          'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
        ],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Execution role requires broad KMS decrypt for Secrets Manager and access to environment-scoped secrets.',
        appliesTo: [
          `Resource::arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio-${environment}/*`,
          `Resource::arn:aws:kms:${this.region}:${this.account}:key/*`,
          'Resource::*',
        ],
      },
    ]);

    // Task role managed policy and wildcard allowances for SSM/Secrets parameter reads
    acknowledgeNagRules(taskRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'Task role uses AWS managed policy AmazonSSMReadOnlyAccess for reading SSM parameters in the environment scope.',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/AmazonSSMReadOnlyAccess'],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Task role requires access to environment-scoped Secrets Manager and SSM parameters to discover DB/Redis endpoints.',
        appliesTo: [
          `Resource::arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio-${environment}/*`,
          `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/*`,
          'Resource::*',
        ],
      },
    ]);

    // ECS2: we intentionally pass non-sensitive env vars (sensitive values are injected as secrets)
    acknowledgeNagRules(taskDef, [
      {
        id: 'AwsSolutions-ECS2',
        reason:
          'Non-sensitive configuration is provided via env vars; secrets (DB credentials) are injected via Secrets Manager.',
      },
    ]);
  }
}
