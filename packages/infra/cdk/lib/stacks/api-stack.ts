/**
 * API Stack - Backend API Infrastructure (ECS)
 * Contains the main backend API running on ECS Fargate
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { WAFConstruct } from '../constructs/waf-construct';

export interface ApiStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  domainName?: string;
  hostedZoneId?: string;
  useExternalDns?: boolean;
}

export class ApiStack extends cdk.Stack {
  public readonly ecsCluster: ecs.Cluster;
  public readonly apiService: ecsPatterns.ApplicationLoadBalancedFargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { environment, domainName, hostedZoneId, useExternalDns } = props;
    const prefix = `postolio-${environment}-api`;

    // ECR Repository for backend container images - reference existing repository
    const ecrRepository = ecr.Repository.fromRepositoryName(this, 'PostolioRepository', 'postolio');

    // VPC Flow Logs role
    const vpcFlowLogsRole = new iam.Role(this, 'VpcFlowLogsRole', {
      assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
      inlinePolicies: {
        FlowLogsDeliveryRolePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
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
    });

    // Create VPC with proper configuration
    const vpc = new ec2.Vpc(this, 'PostolioVPC', {
      vpcName: `${prefix}-vpc`,
      maxAzs: 2,
      natGateways: environment === 'prod' ? 2 : 1,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private-with-egress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
      flowLogs: {
        cloudwatch: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(
            logs.LogGroup.fromLogGroupName(this, 'VpcFlowLogGroup', `/aws/vpc/${prefix}-flowlogs`)
          ),
          trafficType: ec2.FlowLogTrafficType.ALL,
        },
      },
    });

    // Store VPC details in SSM for other stacks
    new ssm.StringParameter(this, 'VpcIdParameter', {
      parameterName: `/postolio/${environment}/vpc/id`,
      stringValue: vpc.vpcId,
      description: 'VPC ID for Postolio application',
    });

    // Database subnet group
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
      description: 'Subnet group for RDS database',
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      subnetGroupName: `${prefix}-db-subnet-group`,
    });

    // Database security group
    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: vpc,
      description: 'Security group for RDS database',
      allowAllOutbound: false,
    });

    // Store database security group ID in SSM for microservices
    new ssm.StringParameter(this, 'DatabaseSecurityGroupParameter', {
      parameterName: `/postolio/${environment}/database/security-group-id`,
      stringValue: databaseSecurityGroup.securityGroupId,
      description: 'Database security group ID',
    });

    // RDS PostgreSQL Database
    const databaseSecret = new secretsmanager.Secret(this, 'DatabaseCredentials', {
      secretName: `${prefix}-database-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\',
      },
    });

    const database = new rds.DatabaseInstance(this, 'Database', {
      instanceIdentifier: `${prefix}-database`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: environment === 'prod'
        ? ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM)
        : ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      subnetGroup: dbSubnetGroup,
      securityGroups: [databaseSecurityGroup],
      credentials: rds.Credentials.fromSecret(databaseSecret),
      multiAz: environment === 'prod',
      storageEncrypted: true,
      backupRetention: environment === 'prod' ? cdk.Duration.days(7) : cdk.Duration.days(1),
      deletionProtection: environment === 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: environment === 'prod',
    });

    // Redis cache security group
    const cacheSecurityGroup = new ec2.SecurityGroup(this, 'CacheSecurityGroup', {
      vpc: vpc,
      description: 'Security group for Redis cache',
      allowAllOutbound: false,
    });

    // Redis cache subnet group
    const cacheSubnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      description: 'Subnet group for Redis cache',
      subnetIds: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }).subnetIds,
      cacheSubnetGroupName: `${prefix}-cache-subnet-group`,
    });

    // Redis ElastiCache cluster
    const redisCache = new elasticache.CfnCacheCluster(this, 'RedisCache', {
      cacheNodeType: environment === 'prod' ? 'cache.t3.micro' : 'cache.t2.micro',
      engine: 'redis',
      numCacheNodes: 1,
      cacheSubnetGroupName: cacheSubnetGroup.cacheSubnetGroupName,
      vpcSecurityGroupIds: [cacheSecurityGroup.securityGroupId],
      clusterName: `${prefix}-redis`,
    });

    redisCache.addDependency(cacheSubnetGroup);

    // ECS Cluster
    this.ecsCluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName: `${prefix}-cluster`,
      vpc: vpc,
      containerInsights: environment === 'prod',
    });

    // ECS Task Role with necessary permissions
    const taskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'),
      ],
      inlinePolicies: {
        PostolioTaskPolicy: new iam.PolicyDocument({
          statements: [
            // Secrets Manager permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
              ],
              resources: [
                databaseSecret.secretArn,
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio/${environment}/*`,
              ],
            }),
            // SSM Parameter Store permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:GetParameter',
                'ssm:GetParameters',
                'ssm:GetParametersByPath',
              ],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/*`,
              ],
            }),
            // Lambda invoke permissions for microservices
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'lambda:InvokeFunction',
              ],
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
              ],
            }),
          ],
        }),
      },
    });

    // Application Load Balanced Fargate Service
    this.apiService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'PostolioService', {
      serviceName: `${prefix}-service`,
      cluster: this.ecsCluster,
      cpu: environment === 'prod' ? 1024 : 512,
      memoryLimitMiB: environment === 'prod' ? 2048 : 1024,
      desiredCount: environment === 'prod' ? 2 : 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepository, `api-${environment}-latest`),
        containerPort: 3000,
        taskRole: taskRole,
        environment: {
          NODE_ENV: environment,
          PORT: '3000',
          LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        },
        secrets: {
          DATABASE_URL: ecs.Secret.fromSecretsManager(databaseSecret, 'connectionString'),
          JWT_SECRET: ecs.Secret.fromSecretsManager(databaseSecret, 'jwtSecret'),
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: `${prefix}-api`,
          logRetention: logs.RetentionDays.TWO_WEEKS,
        }),
      },
      publicLoadBalancer: true,
      domainName: domainName,
      domainZone: hostedZoneId ? route53.HostedZone.fromHostedZoneId(this, 'HostedZone', hostedZoneId) : undefined,
      listenerPort: domainName ? 443 : 80,
      protocol: domainName ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
      platformVersion: ecs.FargatePlatformVersion.LATEST,
    });

    this.loadBalancer = this.apiService.loadBalancer;

    // Configure security groups
    const appSecurityGroup = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc: vpc,
      description: 'Security group for Postolio application',
      allowAllOutbound: true,
    });

    this.apiService.service.connections.allowFromAnyIpv4(ec2.Port.tcp(443), 'HTTPS traffic');
    this.apiService.service.connections.allowFromAnyIpv4(ec2.Port.tcp(80), 'HTTP traffic');

    // Allow app to connect to database
    databaseSecurityGroup.addIngressRule(
      appSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow app to connect to database'
    );

    // Allow app to connect to Redis
    cacheSecurityGroup.addIngressRule(
      appSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow app to connect to Redis'
    );

    // Configure health check
    this.apiService.targetGroup.configureHealthCheck({
      path: '/api/health',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

    // Auto-scaling configuration
    const scaling = this.apiService.service.autoScaleTaskCount({
      minCapacity: environment === 'prod' ? 2 : 1,
      maxCapacity: environment === 'prod' ? 10 : 3,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2),
    });

    // WAF v2 for security
    const waf = new WAFConstruct(this, 'WAF', {
      resourceArn: this.loadBalancer.loadBalancerArn,
      environment,
    });

    // Store important outputs in SSM for other stacks
    new ssm.StringParameter(this, 'ApiUrlParameter', {
      parameterName: `/postolio/${environment}/api/url`,
      stringValue: `https://${this.apiService.loadBalancer.loadBalancerDnsName}`,
      description: 'API Load Balancer URL',
    });

    new ssm.StringParameter(this, 'DatabaseEndpointParameter', {
      parameterName: `/postolio/${environment}/database/endpoint`,
      stringValue: database.instanceEndpoint.hostname,
      description: 'Database endpoint hostname',
    });

    // Stack outputs
    new cdk.CfnOutput(this, 'EcsClusterName', {
      value: this.ecsCluster.clusterName,
      description: 'ECS Cluster Name',
      exportName: `${prefix}-cluster-name`,
    });

    new cdk.CfnOutput(this, 'EcsServiceName', {
      value: this.apiService.service.serviceName,
      description: 'ECS Service Name',
      exportName: `${prefix}-service-name`,
    });

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: this.apiService.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS Name',
      exportName: `${prefix}-lb-dns`,
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS Database Endpoint',
      exportName: `${prefix}-db-endpoint`,
    });

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redisCache.attrRedisEndpointAddress,
      description: 'Redis Cache Endpoint',
      exportName: `${prefix}-redis-endpoint`,
    });

    // CDK NAG Suppressions
    NagSuppressions.addResourceSuppressions(
      taskRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'ECS task role requires broad permissions for microservices communication',
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-ECS2',
          reason: 'Environment variables contain non-sensitive configuration',
        },
        {
          id: 'AwsSolutions-EC23',
          reason: 'Security groups allow necessary traffic for application functionality',
        },
      ],
      true
    );
  }
}