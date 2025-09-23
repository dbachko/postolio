/**
 * Foundation Stack - Shared Infrastructure Components
 * Contains all shared infrastructure that other stacks depend on:
 * - VPC and networking
 * - Database (RDS) and cache (Redis)
 * - Shared S3 buckets and KMS keys
 * - Security groups
 * - ECR repository
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface FoundationStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  enableVpcFlowLogs?: boolean;
  enableDatabaseProxy?: boolean;
}

export class FoundationStack extends cdk.Stack {
  // Exported resources for other stacks
  public readonly vpc: ec2.IVpc;
  public readonly database: rds.IDatabaseInstance;
  public readonly databaseProxy?: rds.IDatabaseProxy;
  public readonly cache: elasticache.CfnCacheCluster;
  public readonly sharedBucket: s3.IBucket;
  public readonly logsBucket: s3.IBucket;
  public readonly encryptionKey: kms.IKey;
  public readonly repository: ecr.IRepository;
  public readonly databaseSecurityGroup: ec2.ISecurityGroup;
  public readonly lambdaSecurityGroup: ec2.ISecurityGroup;
  public readonly ecsSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    const { environment, enableVpcFlowLogs = true, enableDatabaseProxy = true } = props;
    const prefix = `postolio-${environment}`;

    // ==================== KMS Encryption Key ====================
    this.encryptionKey = new kms.Key(this, 'FoundationEncryptionKey', {
      alias: `alias/${prefix}-foundation`,
      description: 'KMS key for encrypting Foundation stack resources',
      enableKeyRotation: true,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== ECR Repository ====================
    try {
      this.repository = ecr.Repository.fromRepositoryName(this, 'PostolioRepository', 'postolio');
    } catch {
      this.repository = new ecr.Repository(this, 'PostolioRepository', {
        repositoryName: 'postolio',
        imageScanOnPush: true,
        imageTagMutability: ecr.TagMutability.MUTABLE,
        lifecycleRules: [
          {
            rulePriority: 1,
            description: 'Keep last 10 images',
            maxImageCount: 10,
          },
        ],
      });
    }

    // ==================== VPC Configuration ====================
    const vpcFlowLogsRole = enableVpcFlowLogs ? new iam.Role(this, 'VpcFlowLogsRole', {
      assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
      inlinePolicies: {
        FlowLogsDeliveryRolePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    }) : undefined;

    const vpcFlowLogGroup = enableVpcFlowLogs ? new logs.LogGroup(this, 'VpcFlowLogGroup', {
      logGroupName: `/aws/vpc/${prefix}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    }) : undefined;

    this.vpc = new ec2.Vpc(this, 'FoundationVPC', {
      vpcName: `${prefix}-vpc`,
      maxAzs: 2,
      natGateways: environment === 'prod' ? 2 : 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: 'Database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    if (enableVpcFlowLogs && vpcFlowLogsRole && vpcFlowLogGroup) {
      new ec2.FlowLog(this, 'VpcFlowLog', {
        resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
        destination: ec2.FlowLogDestination.toCloudWatchLogs(vpcFlowLogGroup, vpcFlowLogsRole),
        trafficType: ec2.FlowLogTrafficType.ALL,
        flowLogName: `${prefix}-flow-log`,
      });
    }

    // VPC Endpoints for AWS services
    new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });

    new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    new ec2.GatewayVpcEndpoint(this, 'DynamoDBEndpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // ==================== Security Groups ====================
    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RDS database',
      allowAllOutbound: false,
    });

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions accessing database',
      allowAllOutbound: true,
    });

    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ECS tasks accessing database',
      allowAllOutbound: true,
    });

    // Allow Lambda and ECS to connect to database
    this.databaseSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda functions to connect to database'
    );

    this.databaseSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS tasks to connect to database'
    );

    // ==================== Database Configuration ====================
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
      vpc: this.vpc,
      description: 'Subnet group for RDS database',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      subnetGroupName: `${prefix}-db-subnet-group`,
    });

    const databaseSecret = new secretsmanager.Secret(this, 'DatabaseCredentials', {
      secretName: `${prefix}/database/credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    this.database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15_3,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        environment === 'prod' ? ec2.InstanceSize.MEDIUM : ec2.InstanceSize.MICRO
      ),
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      subnetGroup: dbSubnetGroup,
      securityGroups: [this.databaseSecurityGroup],
      databaseName: 'postolio',
      credentials: rds.Credentials.fromSecret(databaseSecret),
      allocatedStorage: environment === 'prod' ? 100 : 20,
      storageEncrypted: true,
      storageEncryptionKey: this.encryptionKey,
      backupRetention: environment === 'prod' ? cdk.Duration.days(30) : cdk.Duration.days(1),
      deleteAutomatedBackups: environment !== 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      enablePerformanceInsights: environment === 'prod',
    });

    // RDS Proxy for better Lambda connection management
    if (enableDatabaseProxy) {
      this.databaseProxy = new rds.DatabaseProxy(this, 'DatabaseProxy', {
        proxyTarget: rds.ProxyTarget.fromInstance(this.database),
        secrets: [databaseSecret],
        vpc: this.vpc,
        dbProxyName: `${prefix}-db-proxy`,
        debugLogging: environment !== 'prod',
        iamAuth: true,
        maxConnectionsPercent: 100,
        maxIdleConnectionsPercent: 50,
        initQuery: 'SET search_path TO public',
        securityGroups: [this.databaseSecurityGroup],
        requireTLS: true,
      });
    }

    // ==================== Cache Configuration ====================
    const cacheSecurityGroup = new ec2.SecurityGroup(this, 'CacheSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ElastiCache Redis cluster',
      allowAllOutbound: false,
    });

    cacheSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Lambda functions to connect to Redis'
    );

    cacheSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow ECS tasks to connect to Redis'
    );

    const cacheSubnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      description: 'Subnet group for ElastiCache Redis cluster',
      subnetIds: this.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }).subnetIds,
      cacheSubnetGroupName: `${prefix}-cache-subnet-group`,
    });

    this.cache = new elasticache.CfnCacheCluster(this, 'RedisCache', {
      cacheNodeType: environment === 'prod' ? 'cache.r7g.large' : 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      cacheSubnetGroupName: cacheSubnetGroup.ref,
      vpcSecurityGroupIds: [cacheSecurityGroup.securityGroupId],
      clusterName: `${prefix}-redis`,
      preferredMaintenanceWindow: 'sun:05:00-sun:06:00',
      snapshotRetentionLimit: environment === 'prod' ? 7 : 1,
    });

    // ==================== Shared S3 Buckets ====================
    this.logsBucket = new s3.Bucket(this, 'LogsBucket', {
      bucketName: `${prefix}-logs-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'delete-old-logs',
          enabled: true,
          expiration: cdk.Duration.days(environment === 'prod' ? 90 : 30),
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.sharedBucket = new s3.Bucket(this, 'SharedDataBucket', {
      bucketName: `${prefix}-shared-data-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          id: 'delete-old-versions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== SSM Parameters for Cross-Stack References ====================
    // VPC Parameters
    new ssm.StringParameter(this, 'VpcIdParameter', {
      parameterName: `/postolio/${environment}/vpc/id`,
      stringValue: this.vpc.vpcId,
      description: 'VPC ID for shared infrastructure',
    });

    new ssm.StringParameter(this, 'VpcCidrParameter', {
      parameterName: `/postolio/${environment}/vpc/cidr`,
      stringValue: this.vpc.vpcCidrBlock,
      description: 'VPC CIDR block',
    });

    new ssm.StringListParameter(this, 'PrivateSubnetIdsParameter', {
      parameterName: `/postolio/${environment}/vpc/private-subnet-ids`,
      stringListValue: this.vpc.privateSubnets.map(subnet => subnet.subnetId),
      description: 'Private subnet IDs for Lambda and ECS deployments',
    });

    new ssm.StringListParameter(this, 'PublicSubnetIdsParameter', {
      parameterName: `/postolio/${environment}/vpc/public-subnet-ids`,
      stringListValue: this.vpc.publicSubnets.map(subnet => subnet.subnetId),
      description: 'Public subnet IDs for ALB deployments',
    });

    // Database Parameters
    new ssm.StringParameter(this, 'DatabaseEndpointParameter', {
      parameterName: `/postolio/${environment}/database/endpoint`,
      stringValue: this.database.instanceEndpoint.socketAddress,
      description: 'RDS database endpoint',
    });

    new ssm.StringParameter(this, 'DatabaseSecretArnParameter', {
      parameterName: `/postolio/${environment}/database/secret-arn`,
      stringValue: databaseSecret.secretArn,
      description: 'ARN of the database credentials secret',
    });

    new ssm.StringParameter(this, 'DatabaseSecurityGroupParameter', {
      parameterName: `/postolio/${environment}/database/security-group-id`,
      stringValue: this.databaseSecurityGroup.securityGroupId,
      description: 'Database security group ID',
    });

    if (this.databaseProxy) {
      new ssm.StringParameter(this, 'DatabaseProxyEndpointParameter', {
        parameterName: `/postolio/${environment}/database/proxy-endpoint`,
        stringValue: this.databaseProxy.endpoint,
        description: 'RDS Proxy endpoint for Lambda connections',
      });
    }

    // Cache Parameters
    new ssm.StringParameter(this, 'CacheEndpointParameter', {
      parameterName: `/postolio/${environment}/cache/endpoint`,
      stringValue: this.cache.attrRedisEndpointAddress,
      description: 'Redis cache endpoint',
    });

    new ssm.StringParameter(this, 'CachePortParameter', {
      parameterName: `/postolio/${environment}/cache/port`,
      stringValue: this.cache.attrRedisEndpointPort,
      description: 'Redis cache port',
    });

    // Security Group Parameters
    new ssm.StringParameter(this, 'LambdaSecurityGroupParameter', {
      parameterName: `/postolio/${environment}/security-groups/lambda`,
      stringValue: this.lambdaSecurityGroup.securityGroupId,
      description: 'Security group ID for Lambda functions',
    });

    new ssm.StringParameter(this, 'EcsSecurityGroupParameter', {
      parameterName: `/postolio/${environment}/security-groups/ecs`,
      stringValue: this.ecsSecurityGroup.securityGroupId,
      description: 'Security group ID for ECS tasks',
    });

    // S3 Bucket Parameters
    new ssm.StringParameter(this, 'LogsBucketParameter', {
      parameterName: `/postolio/${environment}/s3/logs-bucket`,
      stringValue: this.logsBucket.bucketName,
      description: 'S3 bucket for centralized logs',
    });

    new ssm.StringParameter(this, 'SharedBucketParameter', {
      parameterName: `/postolio/${environment}/s3/shared-bucket`,
      stringValue: this.sharedBucket.bucketName,
      description: 'S3 bucket for shared application data',
    });

    // KMS Key Parameters
    new ssm.StringParameter(this, 'KmsKeyIdParameter', {
      parameterName: `/postolio/${environment}/kms/key-id`,
      stringValue: this.encryptionKey.keyId,
      description: 'KMS key ID for encryption',
    });

    new ssm.StringParameter(this, 'KmsKeyArnParameter', {
      parameterName: `/postolio/${environment}/kms/key-arn`,
      stringValue: this.encryptionKey.keyArn,
      description: 'KMS key ARN for encryption',
    });

    // ECR Parameters
    new ssm.StringParameter(this, 'EcrRepositoryUriParameter', {
      parameterName: `/postolio/${environment}/ecr/repository-uri`,
      stringValue: this.repository.repositoryUri,
      description: 'ECR repository URI for container images',
    });

    // ==================== Outputs ====================
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: `${prefix}-vpc-id`,
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.instanceEndpoint.socketAddress,
      description: 'RDS Database Endpoint',
      exportName: `${prefix}-database-endpoint`,
    });

    new cdk.CfnOutput(this, 'CacheEndpoint', {
      value: this.cache.attrRedisEndpointAddress,
      description: 'Redis Cache Endpoint',
      exportName: `${prefix}-cache-endpoint`,
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'URI of the ECR repository for API images',
      exportName: `${prefix}-ecr-uri`,
    });

    // ==================== CDK Nag Suppressions ====================
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Managed policies are acceptable for VPC Flow Logs role',
      },
      {
        id: 'AwsSolutions-RDS2',
        reason: 'Encryption at rest is enabled via storageEncrypted property',
      },
      {
        id: 'AwsSolutions-VPC7',
        reason: 'VPC Flow Logs are conditionally enabled based on environment',
      },
      {
        id: 'AwsSolutions-S1',
        reason: 'Access logging not required for centralized logs bucket to avoid recursive logging',
      },
      {
        id: 'AwsSolutions-AEC5',
        reason: 'Using standard Redis port 6379 for operational simplicity and team familiarity',
      },
      {
        id: 'AwsSolutions-SMG4',
        reason: 'Secret rotation not required for dev environment; can be enabled in production',
      },
      {
        id: 'AwsSolutions-RDS3',
        reason: 'Multi-AZ not required for dev environment due to cost optimization',
      },
      {
        id: 'AwsSolutions-RDS10',
        reason: 'Deletion protection disabled for dev environment to allow easy cleanup',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason: 'Using standard PostgreSQL port 5432 for operational simplicity',
      },
      {
        id: 'AwsSolutions-EC23',
        reason: 'VPC endpoint security group automatically configured by CDK',
      },
      {
        id: 'CdkNagValidationFailure',
        reason: 'VPC CIDR block is resolved at synthesis time, validation not applicable',
      },
    ]);
  }
}