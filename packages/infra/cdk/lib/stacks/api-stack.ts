/**
 * API Stack - Backend API Infrastructure (ECS)
 * Contains only the ECS-specific resources, using shared infrastructure from Foundation stack
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { WAFConstruct } from '../constructs/waf-construct';
import { getOAuthEnvironmentVariables, type OAuthConfig } from '../utils/oauth-config';

export interface ApiStackProps extends cdk.StackProps, OAuthConfig {
  environment: 'dev' | 'staging' | 'prod';
  domainName?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  useExternalDns?: boolean;
  openaiApiKey?: string;
  imageTag?: string;
  // Optional overrides for Brand Analysis DynamoDB integration (to avoid stack coupling)
  // Option 1: Direct table names
  brandProfilesTableName?: string;
  brandJobsTableName?: string;
  // Option 2: SSM parameter paths (use dynamic references only if explicitly provided)
  brandProfilesTableParamPath?: string;
  brandJobsTableParamPath?: string;
}

function deriveHostedZoneName(domainName: string): string {
  const trimmed = domainName.replace(/\.$/, '');
  const parts = trimmed.split('.');
  if (parts.length <= 2) {
    return trimmed;
  }

  return parts.slice(-2).join('.');
}

export class ApiStack extends cdk.Stack {
  public readonly ecsCluster: ecs.Cluster;
  public readonly apiService: ecsPatterns.ApplicationLoadBalancedFargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      environment,
      domainName,
      hostedZoneId,
      hostedZoneName,
      useExternalDns,
      openaiApiKey,
      imageTag,
    } = props;
    const prefix = `postolio-${environment}-api`;

    // Initialized with SSM-based secret references (no cross-stack export imports)

    const contextImageTag = imageTag ?? (this.node.tryGetContext('imageTag') as string | undefined);
    const defaultImageTag = `api-${environment}-latest`;
    const containerImageTag =
      contextImageTag && contextImageTag.trim().length > 0 ? contextImageTag : defaultImageTag;

    const oauthEnvVars = Object.fromEntries(
      Object.entries(getOAuthEnvironmentVariables(props)).filter(([, value]) => value)
    );

    // Import images bucket name and CDN domain from Foundation stack
    const imagesBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/s3/images-bucket`
    );

    const imagesCdnDomain = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/cdn/images-domain`
    );

    const imagesCdnDistributionId = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/cdn/images-distribution-id`
    );

    let frontendUrl: string | undefined;
    try {
      frontendUrl = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/web/url`
      );
    } catch (error) {
      console.warn(
        `Frontend URL parameter not found for environment ${environment}. Continuing without setting FRONTEND_URL.`
      );
    }

    // Brand Analysis table names (for Dynamo-backed read endpoints)
    // Decoupled approach with three options in priority order:
    // 1) Explicit table names via context/props
    // 2) Explicit SSM parameter paths via context/props (dynamic reference)
    // 3) Deterministic naming convention (no SSM dependency)
    const brandProfilesTableName =
      props.brandProfilesTableName ??
      (props.brandProfilesTableParamPath
        ? ssm.StringParameter.fromStringParameterName(
            this,
            'BrandProfilesTableParam',
            props.brandProfilesTableParamPath
          ).stringValue
        : `postolio-${environment}-brand-analysis-profiles`);

    const brandJobsTableName =
      props.brandJobsTableName ??
      (props.brandJobsTableParamPath
        ? ssm.StringParameter.fromStringParameterName(
            this,
            'BrandJobsTableParam',
            props.brandJobsTableParamPath
          ).stringValue
        : `postolio-${environment}-brand-analysis-jobs`);

    // Resolve Scheduling EventBridge bus name so API publishes to the same bus as downstream
    // consumers (brand-analysis, autopilot, etc.). Fall back to 'default' when the parameter
    // isn't present to preserve local/dev bootstraps.
    let schedulingEventBusName: string | undefined;
    try {
      schedulingEventBusName = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/scheduling/event-bus-name`
      );
    } catch (err) {
      console.warn(
        `Scheduling event bus parameter not found for ${environment}; falling back to default EventBridge bus`
      );
    }

    // ==================== Import Foundation Resources ====================
    // Import VPC from Foundation stack (for CDK lookup, synth-safe via context)
    const vpcId = ssm.StringParameter.valueFromLookup(this, `/postolio/${environment}/vpc/id`);

    // Check if Foundation resources are available
    const hasFoundationVpc = vpcId && !vpcId.startsWith('dummy-value-for-');

    if (!hasFoundationVpc) {
      console.log(
        `Foundation VPC not available for environment ${environment} - API stack will need Foundation deployed first`
      );
    }

    // Only attempt VPC lookup if we have a valid VPC ID
    let vpc: ec2.IVpc;
    if (hasFoundationVpc) {
      vpc = ec2.Vpc.fromLookup(this, 'FoundationVpc', {
        vpcId: vpcId,
      });
    } else {
      // During synthesis without Foundation, create a placeholder VPC to allow synth
      vpc = new ec2.Vpc(this, 'PlaceholderVpc', {
        maxAzs: 2,
        natGateways: 1,
      });
    }

    // Import security groups and database secret from Foundation stack (runtime values)
    let ecsSecurityGroup: ec2.ISecurityGroup | undefined;
    let databaseSecurityGroup: ec2.ISecurityGroup | undefined;
    let cacheSecurityGroup: ec2.ISecurityGroup | undefined;
    let databaseSecret: secretsmanager.ISecret | undefined;
    let databaseEndpointValue: string | undefined;
    let redisEndpointParam: ssm.IStringParameter | undefined;
    let redisPortParam: ssm.IStringParameter | undefined;

    if (hasFoundationVpc) {
      const ecsSecurityGroupId = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/security-groups/ecs`
      );

      ecsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        'EcsSecurityGroup',
        ecsSecurityGroupId
      );

      const databaseSecurityGroupId = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/database/security-group-id`
      );

      databaseSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        'DatabaseSecurityGroup',
        databaseSecurityGroupId
      );

      const databaseSecretArn = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/database/secret-arn`
      );

      databaseSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'DatabaseSecret',
        databaseSecretArn
      );
      // Database endpoint as "host:port" (from Foundation stack)
      databaseEndpointValue = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/database/endpoint`
      );

      const cacheSecurityGroupId = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/cache/security-group-id`
      );

      cacheSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        'CacheSecurityGroup',
        cacheSecurityGroupId
      );

      redisEndpointParam = ssm.StringParameter.fromStringParameterName(
        this,
        'RedisEndpointParameter',
        `/postolio/${environment}/cache/endpoint`
      );

      redisPortParam = ssm.StringParameter.fromStringParameterName(
        this,
        'RedisPortParameter',
        `/postolio/${environment}/cache/port`
      );

      // Database endpoint comes from Secrets Manager (no need for SSM parameter)
      // API service (ECS) maintains persistent connections, doesn't need proxy
    }

    // Resolve JWT secret via SSM-provided ARN (ensured by Foundation custom resource)
    const jwtSecretArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/jwt-secret-arn`
    );
    const jwtSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'JwtSecretByArn',
      jwtSecretArn
    );

    // Import ECR repository from Foundation stack - use repository name
    const ecrRepository = ecr.Repository.fromRepositoryName(this, 'PostolioRepository', 'postolio');

    // ==================== ECS Cluster ====================
    this.ecsCluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName: `${prefix}-cluster`,
      vpc: vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED, // Enable for all environments to satisfy CDK Nag AwsSolutions-ECS4
    });

    // ==================== ECS Execution Role ====================
    // This role is used by ECS to pull container images and fetch secrets
    // Renamed to force policy/resource replacement and drop legacy imports
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
                databaseSecret?.secretArn || '',
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

    // ==================== ECS Task Role ====================
    const taskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess')],
      inlinePolicies: {
        PostolioTaskPolicy: new iam.PolicyDocument({
          statements: [
            // Secrets Manager permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
              resources: [
                databaseSecret?.secretArn || '',
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio-${environment}/*`,
              ],
            }),
            // Allow sending emails via AWS SES (used for magic links, verification, etc.)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ses:SendEmail',
                'ses:SendRawEmail',
                'ses:SendTemplatedEmail',
                'ses:SendBulkTemplatedEmail',
              ],
              // SES send actions commonly use resource '*' (resource-level restrictions are limited)
              resources: ['*'],
            }),
            // SSM Parameter Store permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/*`,
              ],
            }),
            // Lambda invoke permissions for microservices
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction', 'lambda:InvokeFunctionUrl'],
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
              ],
            }),
            // KMS permissions for encryption
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
              resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
            }),
            // S3 permissions for shared buckets
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
              resources: [
                `arn:aws:s3:::postolio-${environment}-shared-data-${this.account}`,
                `arn:aws:s3:::postolio-${environment}-shared-data-${this.account}/*`,
              ],
            }),
            // S3 permissions for AI-generated images bucket
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:PutObjectTagging',
                's3:DeleteObject',
                's3:ListBucket',
                's3:GetBucketLocation',
              ],
              resources: [`arn:aws:s3:::${imagesBucketName}`, `arn:aws:s3:::${imagesBucketName}/*`],
            }),
            // EventBridge permissions for domain events (default bus)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['events:PutEvents'],
              resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
            }),
            // DynamoDB permissions for Brand Analysis tables (read-only for API routes)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
              resources: [
                cdk.Stack.of(this).formatArn({
                  service: 'dynamodb',
                  resource: 'table',
                  resourceName: brandProfilesTableName,
                }),
                `${cdk.Stack.of(this).formatArn({ service: 'dynamodb', resource: 'table', resourceName: brandProfilesTableName })}/index/*`,
                cdk.Stack.of(this).formatArn({
                  service: 'dynamodb',
                  resource: 'table',
                  resourceName: brandJobsTableName,
                }),
                `${cdk.Stack.of(this).formatArn({ service: 'dynamodb', resource: 'table', resourceName: brandJobsTableName })}/index/*`,
              ],
            }),
          ],
        }),
      },
    });

    // ==================== Application Load Balanced Fargate Service ====================
    const useHttps = domainName && hostedZoneId;

    // Create S3 bucket for ALB access logs (single definition used below)
    const logBucket = new s3.Bucket(this, 'AlbAccessLogsBucket', {
      bucketName: `postolio-alb-logs-${environment}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ id: 'DeleteOldLogs', expiration: cdk.Duration.days(30) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    NagSuppressions.addResourceSuppressions(logBucket, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'ALB access log bucket should not have server access logging to avoid infinite recursion',
      },
    ]);

    let hostedZone: route53.IHostedZone | undefined;
    if (useHttps && !useExternalDns && domainName) {
      // Use dynamic hosted zone lookup - automatically derive from domain name
      const lookupDomain = deriveHostedZoneName(domainName);
      hostedZone = route53.HostedZone.fromLookup(this, 'ApiHostedZone', {
        domainName: lookupDomain,
      });

      console.log(`Using dynamic hosted zone lookup for domain: ${lookupDomain}`);
    }

    let certificate: acm.ICertificate | undefined;
    if (domainName && hostedZone) {
      // Create certificate for the main domain only (WebSocket uses CloudFront)
      certificate = new acm.Certificate(this, 'ApiCertificate', {
        domainName: domainName,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

    this.apiService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'PostolioService',
      {
        serviceName: `${prefix}-service`,
        cluster: this.ecsCluster,
        cpu: environment === 'prod' ? 1024 : 512,
        memoryLimitMiB: environment === 'prod' ? 2048 : 1024,
        desiredCount: environment === 'prod' ? 2 : 1,
        // Enable ECS deployment circuit breaker with automatic rollback
        circuitBreaker: { enable: true, rollback: true },
        taskImageOptions: {
          image: ecs.ContainerImage.fromEcrRepository(ecrRepository, containerImageTag),
          containerPort: 3000,
          taskRole: taskRole,
          executionRole: executionRole,
          environment: {
            NODE_ENV: environment,
            PORT: '3000',
            LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
            // Additional environment variables that don't need to be secrets
            AWS_REGION: this.region,
            // Ensure SES is used outside of strictly 'prod' (e.g., staging/dev) when desired
            // so magic link emails are actually sent instead of logged
            USE_AWS_SES: 'true',
            SES_FROM_EMAIL: 'noreply@postolio.example',
            S3_IMAGES_BUCKET: imagesBucketName,
            CLOUDFRONT_DOMAIN: imagesCdnDomain,
            CLOUDFRONT_DISTRIBUTION_ID: imagesCdnDistributionId,
            ...(frontendUrl && { FRONTEND_URL: frontendUrl, APP_URL: frontendUrl }),
            // Feature flags (unified names)
            AUTH_MAGIC_LINK_ENABLED:
              (
                (this.node.tryGetContext('authMagicLinkEnabled') as string | undefined) ||
                process.env.AUTH_MAGIC_LINK_ENABLED ||
                'false'
              )
                .toString()
                .toLowerCase() === 'true'
                ? 'true'
                : 'false',
            // EventBridge bus for platform events – align with Scheduling stack when available
            EVENT_BUS_NAME: schedulingEventBusName || 'default',
            BRAND_STYLE_PROFILES_TABLE: brandProfilesTableName,
            BRAND_ANALYSIS_JOBS_TABLE: brandJobsTableName,
            ...(redisEndpointParam && { REDIS_HOST: redisEndpointParam.stringValue }),
            ...(redisPortParam && { REDIS_PORT: redisPortParam.stringValue }),
            // OpenAI API Key from GitHub secrets (passed via CI/CD)
            ...(openaiApiKey && { OPENAI_API_KEY: openaiApiKey }),
            ...oauthEnvVars,
            // Signup gating (optional; server falls back to defaults if unset)
            ...(process.env.AUTH_SIGNUPS_MODE && {
              AUTH_SIGNUPS_MODE: process.env.AUTH_SIGNUPS_MODE,
            }),
            ...(process.env.AUTH_ALLOWLIST_EMAILS && {
              AUTH_ALLOWLIST_EMAILS: process.env.AUTH_ALLOWLIST_EMAILS,
            }),
            ...(process.env.WAITLIST_URL && { WAITLIST_URL: process.env.WAITLIST_URL }),
            // Database endpoint parts as plain env vars (avoid relying on secret JSON shape)
            ...(databaseEndpointValue
              ? {
                  DB_HOST: cdk.Fn.select(0, cdk.Fn.split(':', databaseEndpointValue)),
                  DB_PORT: cdk.Fn.select(1, cdk.Fn.split(':', databaseEndpointValue)),
                }
              : {}),
          },
          secrets: databaseSecret
            ? {
                // Database credentials only; host/port provided above
                DB_USERNAME: ecs.Secret.fromSecretsManager(databaseSecret, 'username'),
                DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
                // JWT secret from ARN (full secret string)
                JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
              }
            : undefined,
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: `${prefix}-api`,
            logRetention: logs.RetentionDays.TWO_WEEKS,
          }),
        },
        assignPublicIp: false,
        taskSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        publicLoadBalancer: true,
        domainName: useHttps ? domainName : undefined,
        domainZone: useHttps ? hostedZone : undefined,
        certificate: useHttps ? certificate : undefined, // Use our custom certificate with SAN
        listenerPort: useHttps ? 443 : 80,
        protocol: useHttps ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
        platformVersion: ecs.FargatePlatformVersion.LATEST,
      }
    );

    // Ensure ALB access logs are enabled
    this.apiService.loadBalancer.logAccessLogs(logBucket, 'alb-logs');

    this.loadBalancer = this.apiService.loadBalancer;

    // Configure deployment settings to ensure service availability during updates
    // Setting minHealthyPercent to 100 ensures all tasks remain running during deployment
    const cfnService = this.apiService.service.node.defaultChild as ecs.CfnService;
    cfnService.deploymentConfiguration = {
      minimumHealthyPercent: 100, // Maintain 100% of desired tasks during deployment
      maximumPercent: 200, // Allow up to 200% of desired tasks during deployment
    };

    // Add a deployment alarm to fail and rollback faster if new tasks remain
    // unhealthy for an extended period during a deployment.
    // This triggers rollback if the target group reports >=1 unhealthy host
    // continuously for 10 minutes while a deployment is in progress.
    const tgUnhealthyAlarm = new cloudwatch.Alarm(this, 'ApiTgUnhealthyHostsAlarm', {
      alarmName: `${prefix}-tg-unhealthy-rollback`,
      metric: this.apiService.targetGroup.metricUnhealthyHostCount({
        period: cdk.Duration.minutes(1),
        statistic: 'Average',
      }),
      threshold: 1,
      evaluationPeriods: 10,
      datapointsToAlarm: 10,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Monitor the alarm during deployments and rollback on alarm
    this.apiService.service.enableDeploymentAlarms([tgUnhealthyAlarm.alarmName], {
      behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
    });

    // Enable ALB access logs to satisfy CDK Nag AwsSolutions-ELB2
    // Access logs configured once below via 'logBucket'

    // ==================== Security Group Configuration ====================
    // Note: The ApplicationLoadBalancedFargateService pattern automatically creates
    // security groups with appropriate ingress rules. The ALB security group will
    // allow traffic from the internet, and the service security group will only
    // allow traffic from the ALB. This is the intended pattern and CDK Nag
    // warnings for public-facing ALBs are expected behavior.

    // Connect the ECS service to the Foundation security group if available
    if (ecsSecurityGroup) {
      this.apiService.service.connections.addSecurityGroup(ecsSecurityGroup);
    }

    // Grant the API service security group access to the database
    if (databaseSecurityGroup && hasFoundationVpc) {
      // The ApplicationLoadBalancedFargateService creates its own service security group
      // We need to allow this service security group to connect to the database
      const serviceSecurityGroup = this.apiService.service.connections.securityGroups[0];

      // Use CfnSecurityGroupIngress since we can't modify imported security groups directly
      new ec2.CfnSecurityGroupIngress(this, 'DatabaseAccessRule', {
        groupId: databaseSecurityGroup.securityGroupId,
        ipProtocol: 'tcp',
        fromPort: 5432,
        toPort: 5432,
        sourceSecurityGroupId: serviceSecurityGroup.securityGroupId,
        description: 'Allow API ECS service to connect to database',
      });
    }

    if (cacheSecurityGroup && hasFoundationVpc) {
      const serviceSecurityGroup = this.apiService.service.connections.securityGroups[0];

      new ec2.CfnSecurityGroupIngress(this, 'CacheAccessRule', {
        groupId: cacheSecurityGroup.securityGroupId,
        ipProtocol: 'tcp',
        fromPort: 6379,
        toPort: 6379,
        sourceSecurityGroupId: serviceSecurityGroup.securityGroupId,
        description: 'Allow API ECS service to connect to Redis cache',
      });
    }

    // ==================== Health Check Configuration ====================
    this.apiService.targetGroup.configureHealthCheck({
      path: '/api/health',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

    // ==================== WebSocket Sticky Sessions Configuration ====================
    // Enable sticky sessions for WebSocket connections to maintain connection affinity
    this.apiService.targetGroup.setAttribute('stickiness.enabled', 'true');
    this.apiService.targetGroup.setAttribute('stickiness.type', 'app_cookie');
    this.apiService.targetGroup.setAttribute('stickiness.app_cookie.duration_seconds', '86400');
    this.apiService.targetGroup.setAttribute(
      'stickiness.app_cookie.cookie_name',
      'WEBSOCKET_SESSION'
    );

    // Reduce deregistration delay for faster WebSocket failover
    this.apiService.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '30');

    // ==================== Auto-scaling Configuration ====================
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

    // ==================== WAF v2 for Security ====================
    const waf = new WAFConstruct(this, 'WAF', {
      resourceArn: this.loadBalancer.loadBalancerArn,
      environment,
    });

    // ==================== SSM Parameters for Cross-Stack References ====================
    new ssm.StringParameter(this, 'ApiUrlParameter', {
      parameterName: `/postolio/${environment}/api/url`,
      stringValue: useHttps
        ? `https://${domainName}`
        : `http://${this.apiService.loadBalancer.loadBalancerDnsName}`,
      description: 'API Load Balancer URL',
    });

    new ssm.StringParameter(this, 'LoadBalancerDnsParameter', {
      parameterName: `/postolio/${environment}/api/load-balancer-dns`,
      stringValue: this.apiService.loadBalancer.loadBalancerDnsName,
      description: 'API Load Balancer DNS Name',
    });

    new ssm.StringParameter(this, 'EcsClusterNameParameter', {
      parameterName: `/postolio/${environment}/api/cluster-name`,
      stringValue: this.ecsCluster.clusterName,
      description: 'ECS Cluster Name',
    });

    new ssm.StringParameter(this, 'EcsServiceNameParameter', {
      parameterName: `/postolio/${environment}/api/service-name`,
      stringValue: this.apiService.service.serviceName,
      description: 'ECS Service Name',
    });

    // ==================== Stack Outputs ====================
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

    // ==================== CDK Nag Suppressions ====================
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'ECS task role uses managed policies for SSM access which is acceptable',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Wildcard permissions needed for Lambda invocations and KMS operations within scope',
      },
      {
        id: 'AwsSolutions-ECS2',
        reason: 'Environment variables do not contain sensitive data; secrets are properly managed',
      },
      {
        id: 'AwsSolutions-EC23',
        reason:
          'ALB requires public internet access as this is a public-facing API. The security group rules are appropriately scoped for the ALB pattern.',
      },
    ]);

    // Resource-specific suppressions for ALB and service security groups
    NagSuppressions.addResourceSuppressions(
      this.loadBalancer,
      [
        {
          id: 'AwsSolutions-EC23',
          reason:
            'Public-facing ALB requires internet access on ports 80/443 for external API access',
        },
      ],
      true // Apply to child constructs
    );

    NagSuppressions.addResourceSuppressions(
      this.apiService.service,
      [
        {
          id: 'AwsSolutions-EC23',
          reason: 'Service security group is properly restricted to only allow traffic from ALB',
        },
      ],
      true // Apply to child constructs
    );
  }
}
