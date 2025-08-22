import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as elasticache from 'aws-cdk-lib/aws-elasticache'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import { NagSuppressions } from 'cdk-nag'
import { Construct } from 'constructs'

export interface PostolioStackProps extends cdk.StackProps {
  environment: string
  domainName?: string
  hostedZoneId?: string
  useExternalDns?: boolean
  contentSchedulerStack?: cdk.Stack // Optional reference to ContentScheduler stack
}

export class PostolioStack extends cdk.Stack {
  /**
   * Generate a cryptographically secure random secret
   * Used for auto-generating API keys when not provided via environment
   */
  private generateRandomSecret(): string {
    // Use crypto.randomBytes for cryptographically secure random generation
    // 32 bytes = 256 bits of entropy, converted to base64
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('base64');
  }

  constructor(scope: Construct, id: string, props: PostolioStackProps) {
    super(scope, id, props)

    const { environment, domainName, hostedZoneId, useExternalDns, contentSchedulerStack } = props

    // Import ContentScheduler API URL if stack reference is provided
    const schedulerApiUrl = contentSchedulerStack 
      ? cdk.Fn.importValue(`postolio-scheduler-${environment}-api-endpoint`)
      : process.env.SCHEDULER_API_URL || 'https://scheduler-api-not-configured.example.com';


    // ECR Repository for backend container images - reference existing repository
    const ecrRepository = ecr.Repository.fromRepositoryName(this, 'PostolioRepository', 'postolio')

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
    })

    // VPC Flow Logs
    const flowLogsGroup = new logs.LogGroup(this, 'VpcFlowLogsGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // VPC
    const vpc = new ec2.Vpc(this, 'PostolioVpc', {
      maxAzs: 2,
      natGateways: 1, // Cost optimization: single NAT gateway
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
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      flowLogs: {
        'FlowLogCloudWatch': {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogsGroup, vpcFlowLogsRole),
        },
      },
    })

    // Security Groups
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for RDS PostgreSQL database',
    })

    const cacheSecurityGroup = new ec2.SecurityGroup(this, 'CacheSecurityGroup', {
      vpc,
      description: 'Security group for ElastiCache Redis',
    })

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'Security group for ECS tasks',
    })

    // Allow ECS to connect to database and cache
    dbSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(5433), 'Allow ECS tasks to connect to PostgreSQL')

    cacheSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(6380), 'Allow ECS tasks to connect to Redis')

    // Database secret with URL-safe password generation
    const dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      description: 'Postolio database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\{}()[],:;=&?#%><|!~`\'$*+-', // URL-problematic characters
        passwordLength: 32,
      },
    })

    // RDS PostgreSQL Database
    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromSecret(dbSecret),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      databaseName: 'postolio',
      deletionProtection: environment === 'prod', // Only enable deletion protection in production
      backupRetention: environment === 'prod' ? cdk.Duration.days(7) : cdk.Duration.days(1),
      deleteAutomatedBackups: environment !== 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
      storageEncrypted: true, // Enable encryption at rest
      multiAz: environment === 'prod', // Enable Multi-AZ for production
      port: 5433, // Use non-default port for security
    })

    // ElastiCache Redis Subnet Group
    const cacheSubnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      description: 'Subnet group for ElastiCache',
      subnetIds: vpc.isolatedSubnets.map((subnet: ec2.ISubnet) => subnet.subnetId),
    })

    // ElastiCache Redis
    const redis = new elasticache.CfnCacheCluster(this, 'RedisCache', {
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      vpcSecurityGroupIds: [cacheSecurityGroup.securityGroupId],
      cacheSubnetGroupName: cacheSubnetGroup.ref,
      port: 6380, // Use non-default port for security
    })

    // S3 Access Logs bucket for CloudFront (created first to be used by other buckets)
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `postolio-access-logs-${environment}-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // Required for CloudFront logging
    })

    // S3 Bucket for AI-generated images with intelligent tiering
    const imagesBucket = new s3.Bucket(this, 'AIImagesBucket', {
      bucketName: `postolio-ai-images-${environment}-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: environment === 'prod' 
        ? s3.BucketEncryption.KMS_MANAGED // SSE-KMS for production
        : s3.BucketEncryption.S3_MANAGED,  // SSE-S3 for development
      enforceSSL: true,
      versioned: environment === 'prod',
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'images-access-logs/',
      lifecycleRules: [
        {
          id: 'intelligent-tiering',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
        {
          id: 'compliance-deletion',
          enabled: true,
          expiration: cdk.Duration.days(2555), // 7 years for compliance
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    })

    // Grant CloudFront logging service permission to write to the access logs bucket
    accessLogsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontLogging',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
        actions: ['s3:PutObject', 's3:GetBucketAcl', 's3:PutBucketAcl'],
        resources: [
          accessLogsBucket.bucketArn,
          accessLogsBucket.arnForObjects('*')
        ],
      })
    )

    // S3 Bucket for frontend assets
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `postolio-frontend-${environment}-${cdk.Aws.ACCOUNT_ID}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'frontend-access-logs/',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      enforceSSL: true,
    })

    // SSL Certificate and Domain Configuration
    let certificate: acm.Certificate | undefined
    let hostedZone: route53.IHostedZone | undefined

    if (domainName) {
      if (hostedZoneId && !useExternalDns) {
        // Route 53 managed domain - automatic DNS validation
        hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
          hostedZoneId,
          zoneName: domainName.split('.').slice(-2).join('.'), // Get root domain (e.g., postolio.example from postolio.example)
        })

        // Create SSL certificate with DNS validation
        certificate = new acm.Certificate(this, 'SslCertificate', {
          domainName,
          certificateName: `${environment}-ssl-cert`,
          validation: acm.CertificateValidation.fromDns(hostedZone),
        })
      } else if (useExternalDns) {
        // External DNS provider - use email validation
        const rootDomain = domainName.split('.').slice(-2).join('.')
        certificate = new acm.Certificate(this, 'SslCertificate', {
          domainName,
          certificateName: `${environment}-ssl-cert`,
          validation: acm.CertificateValidation.fromEmail({
            [domainName]: `admin@${rootDomain}`,
          }),
        })
      }
    }

    // Create CloudFront OAI for secure S3 access
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for ${environment} frontend bucket`,
    })

    // Update bucket policy to only allow CloudFront OAI access
    frontendBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [frontendBucket.arnForObjects('*')],
        principals: [originAccessIdentity.grantPrincipal],
      })
    )

    // NOTE: Lambda@Edge removed due to production issues (403/502 errors)
    // Using CloudFront origin request rewriting instead for SPA routing

    // API Domain Configuration (postolio.example) - declare early for CloudFront
    const apiDomainName = 'postolio.example'
    const apiHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ApiHostedZone', {
      hostedZoneId: 'Z06253801J6I9ZG053USV',
      zoneName: 'postolio.example',
    })

    // SSL Certificate for API domain and WebSocket subdomain
    const apiCertificate = new acm.Certificate(this, 'ApiCertificate', {
      domainName: apiDomainName,
      subjectAlternativeNames: ['postolio.example'], // Add WebSocket subdomain
      validation: acm.CertificateValidation.fromDns(apiHostedZone),
    })

    // Placeholder for CloudFront distribution - will be created after ECS service

    // Application secrets with ContentScheduler integration
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      description: 'Postolio application secrets',
      secretObjectValue: {
        jwtSecret: cdk.SecretValue.unsafePlainText(
          cdk.Fn.select(2, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))
        ),
        redisUrl: cdk.SecretValue.unsafePlainText(`redis://${redis.attrRedisEndpointAddress}:6380`),
        openaiApiKey: cdk.SecretValue.unsafePlainText('PLACEHOLDER_OPENAI_KEY'),
        facebookAppId: cdk.SecretValue.unsafePlainText('PLACEHOLDER_FACEBOOK_APP_ID'),
        facebookAppSecret: cdk.SecretValue.unsafePlainText('PLACEHOLDER_FACEBOOK_APP_SECRET'),
        nodeEnv: cdk.SecretValue.unsafePlainText('production'),
        port: cdk.SecretValue.unsafePlainText('3000'),
        instagramRedirectUri: cdk.SecretValue.unsafePlainText(`https://${domainName || 'PLACEHOLDER_DOMAIN'}/auth/instagram/callback`),
  // ContentScheduler integration (SigV4 IAM auth only; API key deprecated)
  schedulerApiUrl: cdk.SecretValue.unsafePlainText(schedulerApiUrl),
        // Publisher API key for Lambda-to-API authentication
        // Use a secure random value or provide via environment variable
        publisherApiKey: cdk.SecretValue.unsafePlainText(
          process.env.PUBLISHER_API_KEY || this.generateRandomSecret()
        ),
      },
    })

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'PostolioCluster', {
      vpc,
      containerInsights: true,  // Will be deprecated but still works
    })

    // Task role with permissions to access secrets and S3
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    })

    dbSecret.grantRead(taskRole)
    appSecrets.grantRead(taskRole)
    
    // Grant permissions to upload/delete images in S3
    imagesBucket.grantReadWrite(taskRole)
    
    // Grant permissions to create CloudFront invalidations
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cloudfront:CreateInvalidation'],
      resources: ['*'], // Will be restricted to specific distribution after creation
    }))
    
    // Grant permissions for AWS SES email sending
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ses:SendEmail',
        'ses:SendRawEmail',
        'ses:GetIdentityVerificationAttributes',
        'ses:VerifyEmailIdentity'
      ],
      resources: ['*'], // SES resources are global
    }))

    // Custom task execution role policy
    const taskExecutionRolePolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ecr:GetAuthorizationToken',
            'ecr:BatchCheckLayerAvailability',
            'ecr:GetDownloadUrlForLayer',
            'ecr:BatchGetImage',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
          ],
          resources: ['arn:aws:logs:*:*:*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'secretsmanager:GetSecretValue',
            'secretsmanager:DescribeSecret',
          ],
          resources: [dbSecret.secretArn, appSecrets.secretArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['iam:PassRole'],
          resources: [taskRole.roleArn],
          conditions: {
            StringEquals: {
              'iam:PassedToService': 'ecs-tasks.amazonaws.com'
            }
          }
        })
      ],
    })

    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      inlinePolicies: {
        TaskExecutionRolePolicy: taskExecutionRolePolicy,
      },
    })

    // ALB Access Logs bucket
    const albAccessLogsBucket = new s3.Bucket(this, 'AlbAccessLogsBucket', {
      bucketName: `postolio-alb-logs-${environment}-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    })

    // ALB service account IDs for different regions
    const albAccountIds: { [key: string]: string } = {
      'us-east-1': '127311923021',
      'us-east-2': '033677994240',
      'us-west-1': '027434742980',
      'us-west-2': '797873946194',
      'eu-west-1': '156460612806',
      'eu-west-2': '652711504416',
      'eu-central-1': '054676820928',
      'ap-southeast-1': '114774131450',
      'ap-southeast-2': '783225319266',
      'ap-northeast-1': '582318560864',
    }

    // Grant ALB service permission to write logs to the bucket
    albAccessLogsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowALBLogging',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal(albAccountIds[cdk.Aws.REGION] || '127311923021')],
        actions: ['s3:PutObject'],
        resources: [albAccessLogsBucket.arnForObjects('*')],
      })
    )

    albAccessLogsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowALBLogDelivery',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [albAccessLogsBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            's3:x-amz-acl': 'bucket-owner-full-control'
          }
        }
      })
    )

    albAccessLogsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowALBLogDeliveryGetBucketAcl',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
        actions: ['s3:GetBucketAcl'],
        resources: [albAccessLogsBucket.bucketArn],
      })
    )

    // Grant permission to invoke Content Scheduler API using IAM authentication
    // Import the API ARN from ContentScheduler stack exports
    const schedulerApiArn = cdk.Fn.importValue(`postolio-scheduler-${environment}-api-arn`)
    
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:Invoke'],
      resources: [
        // Allow invoking all methods on the API
        // The schedulerApiArn already includes /*/*/*, so we don't need to add more
        schedulerApiArn
      ],
    }))
    
    // Get the image tag from context, defaulting to 'latest' if not provided
    const imageTag = this.node.tryGetContext('imageTag') || 'latest'
    
    // ECS Service with Application Load Balancer (CloudFront domain passed as environment variable)
    const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'PostolioService', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 2048, // Increased from 1024 to prevent OOM kills
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepository, imageTag),
        containerPort: 3000,
        executionRole,
        taskRole,
        secrets: {
          DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
          JWT_SECRET: ecs.Secret.fromSecretsManager(appSecrets, 'jwtSecret'),
          OPENAI_API_KEY: ecs.Secret.fromSecretsManager(appSecrets, 'openaiApiKey'),
          FACEBOOK_APP_ID: ecs.Secret.fromSecretsManager(appSecrets, 'facebookAppId'),
          FACEBOOK_APP_SECRET: ecs.Secret.fromSecretsManager(appSecrets, 'facebookAppSecret'),
          NODE_ENV: ecs.Secret.fromSecretsManager(appSecrets, 'nodeEnv'),
          PORT: ecs.Secret.fromSecretsManager(appSecrets, 'port'),
          REDIS_URL: ecs.Secret.fromSecretsManager(appSecrets, 'redisUrl'),
          PUBLISHER_API_KEY: ecs.Secret.fromSecretsManager(appSecrets, 'publisherApiKey'),
        },
        environment: {
          DB_HOST: database.instanceEndpoint.hostname,
          DB_PORT: database.instanceEndpoint.port.toString(),
          DB_NAME: 'postolio',
          CORS_ORIGIN: apiDomainName, // Use unified domain instead of CloudFront domain
          INSTAGRAM_REDIRECT_URI: `https://${apiDomainName}/api/auth/instagram/callback`,
          GOOGLE_REDIRECT_URI: `https://${apiDomainName}/api/auth/google/callback`,
          FACEBOOK_REDIRECT_URI: `https://${apiDomainName}/api/auth/facebook/callback`,
          S3_IMAGES_BUCKET: imagesBucket.bucketName,
          AWS_REGION: cdk.Aws.REGION,
          CLOUDFRONT_DOMAIN: apiDomainName, // Will be updated after distribution creation
          // Trim any trailing slash at runtime via container entrypoint logic (client also normalizes)
          SCHEDULER_API_URL: schedulerApiUrl,
          SCHEDULER_API_STAGE: environment,
          WS_DOMAIN: 'postolio.example', // WebSocket subdomain
          // AWS SES configuration
          USE_AWS_SES: 'true', // Use SES in production
          SES_FROM_EMAIL: domainName ? `noreply@${domainName}` : 'noreply@postolio.example',
          NODE_ENV: environment === 'prod' ? 'production' : environment,
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'postolio',
          logGroup: new logs.LogGroup(this, 'AppLogGroup', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
        }),
      },
      publicLoadBalancer: true,
      securityGroups: [ecsSecurityGroup],
    })

    // Add HTTPS listener with SSL certificate
    fargateService.loadBalancer.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [apiCertificate],
      defaultTargetGroups: [fargateService.targetGroup],
    })

    // Redirect HTTP to HTTPS for security
    fargateService.listener.addAction('RedirectToHttps', {
      action: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    })

    // Note: DNS record for postolio.example now points to CloudFront (created above) instead of ALB directly

    // Enable ALB access logs
    fargateService.loadBalancer.setAttribute('access_logs.s3.enabled', 'true')
    fargateService.loadBalancer.setAttribute('access_logs.s3.bucket', albAccessLogsBucket.bucketName)

    // Health check configuration with proper timeouts
    fargateService.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10), // Increased from default 5s
      healthyThresholdCount: 2, // Reduced from 5 to speed up healthy status
      unhealthyThresholdCount: 3, // Increased from 2 to be more tolerant
    })
    
    // Enable WebSocket support on target group
    // WebSocket connections require stickiness for proper session handling
    fargateService.targetGroup.enableCookieStickiness(cdk.Duration.hours(1))

    // Configure ECS service deployment settings
    const cfnServiceConfig = fargateService.service.node.defaultChild as ecs.CfnService
    cfnServiceConfig.deploymentConfiguration = {
      maximumPercent: 200,
      minimumHealthyPercent: 100, // Ensure zero-downtime deployments
    }
    
    // CRITICAL: Set health check grace period to allow container to start
    cfnServiceConfig.healthCheckGracePeriodSeconds = 300 // 5 minutes grace period

    // Auto Scaling
    const scalableTarget = fargateService.service.autoScaleTaskCount({
      minCapacity: environment === 'prod' ? 1 : 1,
      maxCapacity: environment === 'prod' ? 10 : 2,
    })

    scalableTarget.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    })

    scalableTarget.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
    })

    // Create OAI for images bucket
    const imagesOAI = new cloudfront.OriginAccessIdentity(this, 'ImagesOAI', {
      comment: `OAI for ${environment} images bucket`,
    })

    // Grant OAI access to images bucket
    imagesBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [imagesBucket.arnForObjects('*')],
        principals: [imagesOAI.grantPrincipal],
      })
    )

    // CloudFront Distribution with multiple origins for same-domain architecture
    const distributionProps: any = {
      // Default behavior - serves frontend from S3
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(frontendBucket, {
          originAccessIdentity: originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        // Note: Error responses for SPA routing should be handled here if needed,
        // but CloudFront doesn't support behavior-specific error responses.
        // The React app will handle routing on the client side.
      },
      // Additional behaviors for API routing and image serving
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.LoadBalancerV2Origin(fargateService.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL, // Enable POST, PUT, DELETE
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          compress: false,
        },
        '/images/*': {
          origin: origins.S3BucketOrigin.withOriginAccessIdentity(imagesBucket, {
            originAccessIdentity: imagesOAI,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
          responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'ImagesResponseHeadersPolicy', {
            corsBehavior: {
              accessControlAllowOrigins: ['*'],
              accessControlAllowHeaders: ['*'],
              accessControlAllowMethods: ['GET', 'HEAD'],
              accessControlAllowCredentials: false,
              accessControlMaxAge: cdk.Duration.hours(1),
              originOverride: false,
            },
          }),
        },
      },
      // Use postolio.example as the custom domain
      domainNames: ['postolio.example'],
      certificate: apiCertificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
      logBucket: accessLogsBucket,
      logFilePrefix: 'cloudfront-logs/',
      // IMPORTANT: Selective error response configuration
      // Only handle 403 errors (S3 access denied for non-existent objects)
      // This enables SPA routing while preserving API error responses
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      // Note: We explicitly DO NOT handle 404, 500, or other status codes
      // to ensure API errors pass through with their original response bodies
    }

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', distributionProps)
    
    // Add CloudFront distribution ID and ALB domain to ECS task environment
    // We need to update the container definition after it's created
    fargateService.taskDefinition.defaultContainer?.addEnvironment(
      'CLOUDFRONT_DISTRIBUTION_ID',
      distribution.distributionId
    )
    

    // Update existing DNS record for postolio.example to point to CloudFront (unified domain)
    // Note: We reuse the existing ApiDomainRecord logical ID to update the existing record
    new route53.ARecord(this, 'ApiDomainRecord', {
      zone: apiHostedZone,
      recordName: apiDomainName,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
    })

    // Create DNS record for custom domain (only if using Route 53 and different from API domain)
    if (domainName && hostedZone && !useExternalDns && domainName !== apiDomainName) {
      new route53.ARecord(this, 'DomainARecord', {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
      })
    }

    // Create Route53 record for WebSocket subdomain pointing directly to ALB
    new route53.ARecord(this, 'WebSocketDnsRecord', {
      zone: apiHostedZone,
      recordName: 'ws',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(fargateService.loadBalancer)
      ),
      comment: 'WebSocket subdomain pointing directly to ALB (bypasses CloudFront)',
    })

    // Output ALB DNS for WebSocket connections
    new cdk.CfnOutput(this, 'ALBDomainName', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name for WebSocket connections',
      exportName: `postolio-${environment}-alb-dns`,
    })
    
    new cdk.CfnOutput(this, 'WebSocketDomain', {
      value: 'postolio.example',
      description: 'WebSocket domain for direct ALB connections',
    })
    
    // Outputs
    new cdk.CfnOutput(this, 'ECRRepository', {
      value: ecrRepository.repositoryUri,
      description: 'ECR Repository URI for backend container images',
    })

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS name',
    })

    new cdk.CfnOutput(this, 'FrontendDistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'Frontend CloudFront distribution domain name',
    })

    if (domainName) {
      new cdk.CfnOutput(this, 'CustomDomainName', {
        value: domainName,
        description: 'Custom domain name for the application',
      })
    }

    new cdk.CfnOutput(this, 'ApplicationURL', {
      value: `https://${apiDomainName}`,
      description: 'Unified application URL (frontend + API)',
    })

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'Frontend S3 bucket name',
    })
    
    new cdk.CfnOutput(this, 'ImagesBucketName', {
      value: imagesBucket.bucketName,
      description: 'AI Images S3 bucket name',
    })
    
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID for cache invalidation',
    })

    new cdk.CfnOutput(this, 'DeployedImageTag', {
      value: imageTag,
      description: 'Docker image tag used for this deployment',
    })
    
    new cdk.CfnOutput(this, 'EcsClusterName', {
      value: cluster.clusterName,
      description: 'ECS Cluster name for deployments',
    })
    
    new cdk.CfnOutput(this, 'EcsServiceName', {
      value: fargateService.service.serviceName,
      description: 'ECS Service name for deployments',
    })
    
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
    })

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redis.attrRedisEndpointAddress,
      description: 'ElastiCache Redis endpoint',
    })

    new cdk.CfnOutput(this, 'AppSecretsArn', {
      value: appSecrets.secretArn,
      description: 'Application secrets ARN for manual configuration',
    })

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `https://${apiDomainName}/api`,
      description: 'Secure API base URL with custom domain',
    })

    new cdk.CfnOutput(this, 'ApiCertificateArn', {
      value: apiCertificate.certificateArn,
      description: 'API SSL certificate ARN',
    })

    if (certificate) {
      new cdk.CfnOutput(this, 'SslCertificateArn', {
        value: certificate.certificateArn,
        description: 'SSL certificate ARN',
      })
    }

    // Output DNS configuration for external DNS providers
    if (domainName && useExternalDns) {
      new cdk.CfnOutput(this, 'CloudFrontDistributionDomain', {
        value: distribution.distributionDomainName,
        description: 'CloudFront distribution domain - Create CNAME record for your domain pointing to this',
      })

      new cdk.CfnOutput(this, 'ExternalDnsInstructions', {
        value: `Create CNAME record: ${domainName} -> ${distribution.distributionDomainName}`,
        description: 'DNS record to create with your external DNS provider',
      })
    }

    // CDK Nag suppressions for legitimate use cases
    NagSuppressions.addResourceSuppressions(
      vpcFlowLogsRole,
      [{
        id: 'AwsSolutions-IAM5',
        reason: 'VPC Flow Logs require wildcard permissions for log group and stream operations',
        appliesTo: ['Resource::*'],
      }]
    )

    NagSuppressions.addResourceSuppressions(
      executionRole,
      [{
        id: 'AwsSolutions-IAM5',
        reason: 'ECS Task Execution requires wildcard ECR permissions for image pulls and CloudWatch Logs operations',
        appliesTo: ['Resource::*', 'Resource::arn:aws:logs:*:*:*'],
      }]
    )

    // Suppress the policy-level IAM5 warning 
    NagSuppressions.addResourceSuppressions(
      executionRole.node.findChild('DefaultPolicy'),
      [{
        id: 'AwsSolutions-IAM5',
        reason: 'ECS Task Execution requires wildcard permissions for ECR and CloudWatch Logs',
        appliesTo: ['Resource::*'],
      }]
    )

    NagSuppressions.addResourceSuppressions(
      dbSecret,
      [{
        id: 'AwsSolutions-SMG4',
        reason: 'Database password rotation will be managed manually for this application',
      }]
    )

    NagSuppressions.addResourceSuppressions(
      appSecrets,
      [{
        id: 'AwsSolutions-SMG4',
        reason: 'Application secrets rotation will be managed manually for this application',
      }]
    )

    NagSuppressions.addResourceSuppressions(
      fargateService.loadBalancer,
      [{
        id: 'AwsSolutions-EC23',
        reason: 'Load balancer needs to accept incoming traffic from the internet on port 80',
      }]
    )

    NagSuppressions.addResourceSuppressions(
      distribution,
      [{
        id: 'AwsSolutions-CFR1',
        reason: 'Geo restrictions not required for this application',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'WAF not required for this static website distribution',
      }]
    )

    NagSuppressions.addResourceSuppressions(
      database,
      [{
        id: 'AwsSolutions-RDS3',
        reason: 'Multi-AZ not required for development environment, enabled via configuration for production',
      }]
    )

    NagSuppressions.addResourceSuppressions(
      accessLogsBucket,
      [{
        id: 'AwsSolutions-S1',
        reason: 'This is the access logs bucket itself, does not need its own access logs',
      }]
    )
    
    // AI Images bucket has access logging configured to the accessLogsBucket
    // No suppression needed as logging is enabled

    NagSuppressions.addResourceSuppressions(
      albAccessLogsBucket,
      [{
        id: 'AwsSolutions-S1',
        reason: 'This is the ALB access logs bucket itself, does not need its own access logs',
      }]
    )

    // Fix remaining suppressions
    NagSuppressions.addResourceSuppressions(
      distribution,
      [{
        id: 'AwsSolutions-CFR4',
        reason: 'CloudFront uses default certificate which has minimum TLS version limitations',
      },
      {
        id: 'AwsSolutions-CFR5',
        reason: 'S3 website origin requires HTTP protocol, secured by OAI',
      }]
    )

    // Suppress load balancer security group warning
    NagSuppressions.addResourceSuppressions(
      fargateService.loadBalancer.node.findChild('SecurityGroup'),
      [{
        id: 'AwsSolutions-EC23',
        reason: 'Load balancer security group needs to accept HTTP traffic from internet on port 80',
      }]
    )

    // NOTE: Lambda@Edge suppressions removed - Lambda@Edge function was removed due to production issues
  }
}
