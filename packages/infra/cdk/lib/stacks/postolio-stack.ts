import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import {
  ServiceDiscoveryManager,
  getServiceDiscoveryEnvVars,
} from "../utils/service-discovery-infrastructure";

export interface PostolioStackProps extends cdk.StackProps {
  environment: string;
  domainName?: string;
  hostedZoneId?: string;
  useExternalDns?: boolean;
  serviceDiscoveryNamespaceId?: string; // Use shared namespace
  // No stack references needed - services use Cloud Map for discovery
}

export class PostolioStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PostolioStackProps) {
    super(scope, id, props);

    const {
      environment,
      domainName,
      hostedZoneId,
      useExternalDns,
      serviceDiscoveryNamespaceId,
    } = props;

    // Services use Cloud Map for discovery - no hardcoded URLs needed

    // ECR Repository for backend container images - reference existing repository
    const ecrRepository = ecr.Repository.fromRepositoryName(
      this,
      "PostolioRepository",
      "postolio",
    );

    // VPC Flow Logs role
    const vpcFlowLogsRole = new iam.Role(this, "VpcFlowLogsRole", {
      assumedBy: new iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
      inlinePolicies: {
        FlowLogsDeliveryRolePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
              ],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    // VPC Flow Logs
    const flowLogsGroup = new logs.LogGroup(this, "VpcFlowLogsGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // VPC
    const vpc = new ec2.Vpc(this, "PostolioVpc", {
      maxAzs: 2,
      natGateways: 1, // Cost optimization: single NAT gateway
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: "Isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      flowLogs: {
        FlowLogCloudWatch: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(
            flowLogsGroup,
            vpcFlowLogsRole,
          ),
        },
      },
    });

    // Use shared Service Discovery namespace
    const serviceDiscovery = new ServiceDiscoveryManager(
      this,
      "ServiceDiscovery",
      {
        vpc, // Note: VPC is provided but we're using HTTP namespace from shared stack
        environment: environment as "dev" | "staging" | "prod",
        existingNamespaceId:
          serviceDiscoveryNamespaceId ||
          cdk.Fn.importValue(`ServiceDiscovery-${environment}-NamespaceId`),
      },
    );

    // Security Groups
    const dbSecurityGroup = new ec2.SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      {
        vpc,
        description: "Security group for RDS PostgreSQL database",
      },
    );

    const cacheSecurityGroup = new ec2.SecurityGroup(
      this,
      "CacheSecurityGroup",
      {
        vpc,
        description: "Security group for ElastiCache Redis",
      },
    );

    const ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc,
      description: "Security group for ECS tasks",
    });

    // Allow ECS to connect to database and cache
    dbSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5433),
      "Allow ECS tasks to connect to PostgreSQL",
    );

    cacheSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(6380),
      "Allow ECS tasks to connect to Redis",
    );

    // Database secret with URL-safe password generation
    const dbSecret = new secretsmanager.Secret(this, "DatabaseSecret", {
      description: "Postolio database credentials",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "postgres" }),
        generateStringKey: "password",
        excludeCharacters: "\"@/\\{}()[],:;=&?#%><|!~`'$*+-", // URL-problematic characters
        passwordLength: 32,
      },
    });

    // RDS PostgreSQL Database
    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      credentials: rds.Credentials.fromSecret(dbSecret),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      databaseName: "postolio",
      deletionProtection: environment === "prod", // Only enable deletion protection in production
      backupRetention:
        environment === "prod" ? cdk.Duration.days(7) : cdk.Duration.days(1),
      deleteAutomatedBackups: environment !== "prod",
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.SNAPSHOT
          : cdk.RemovalPolicy.DESTROY,
      storageEncrypted: true, // Enable encryption at rest
      multiAz: environment === "prod", // Enable Multi-AZ for production
      port: 5433, // Use non-default port for security
    });

    // ElastiCache Redis Subnet Group
    const cacheSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "CacheSubnetGroup",
      {
        description: "Subnet group for ElastiCache",
        subnetIds: vpc.isolatedSubnets.map(
          (subnet: ec2.ISubnet) => subnet.subnetId,
        ),
      },
    );

    // ElastiCache Redis
    const redis = new elasticache.CfnCacheCluster(this, "RedisCache", {
      cacheNodeType: "cache.t3.micro",
      engine: "redis",
      numCacheNodes: 1,
      vpcSecurityGroupIds: [cacheSecurityGroup.securityGroupId],
      cacheSubnetGroupName: cacheSubnetGroup.ref,
      port: 6380, // Use non-default port for security
    });

    // S3 Access Logs bucket for CloudFront (created first to be used by other buckets)
    const accessLogsBucket = new s3.Bucket(this, "AccessLogsBucket", {
      bucketName: `postolio-access-logs-${environment}-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // Required for CloudFront logging
    });

    // S3 Bucket for AI-generated images with intelligent tiering
    const imagesBucket = new s3.Bucket(this, "AIImagesBucket", {
      bucketName: `postolio-ai-images-${environment}-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption:
        environment === "prod"
          ? s3.BucketEncryption.KMS_MANAGED // SSE-KMS for production
          : s3.BucketEncryption.S3_MANAGED, // SSE-S3 for development
      enforceSSL: true,
      versioned: environment === "prod",
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "images-access-logs/",
      lifecycleRules: [
        {
          id: "intelligent-tiering",
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
          id: "compliance-deletion",
          enabled: true,
          expiration: cdk.Duration.days(2555), // 7 years for compliance
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 3600,
        },
      ],
    });

    // Grant CloudFront logging service permission to write to the access logs bucket
    accessLogsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudFrontLogging",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("delivery.logs.amazonaws.com")],
        actions: ["s3:PutObject", "s3:GetBucketAcl", "s3:PutBucketAcl"],
        resources: [
          accessLogsBucket.bucketArn,
          accessLogsBucket.arnForObjects("*"),
        ],
      }),
    );

    // S3 Bucket for frontend assets
    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: `postolio-frontend-${environment}-${cdk.Aws.ACCOUNT_ID}`,
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "index.html",
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "frontend-access-logs/",
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      enforceSSL: true,
    });

    // SSL Certificate and Domain Configuration
    let certificate: acm.Certificate | undefined;
    let hostedZone: route53.IHostedZone | undefined;

    if (domainName) {
      if (hostedZoneId && !useExternalDns) {
        // Route 53 managed domain - automatic DNS validation
        hostedZone = route53.HostedZone.fromHostedZoneAttributes(
          this,
          "HostedZone",
          {
            hostedZoneId,
            zoneName: domainName.split(".").slice(-2).join("."), // Get root domain (e.g., postolio.example from postolio.example)
          },
        );

        // Create SSL certificate with DNS validation
        certificate = new acm.Certificate(this, "SslCertificate", {
          domainName,
          certificateName: `${environment}-ssl-cert`,
          validation: acm.CertificateValidation.fromDns(hostedZone),
        });
      } else if (useExternalDns) {
        // External DNS provider - use email validation
        const rootDomain = domainName.split(".").slice(-2).join(".");
        certificate = new acm.Certificate(this, "SslCertificate", {
          domainName,
          certificateName: `${environment}-ssl-cert`,
          validation: acm.CertificateValidation.fromEmail({
            [domainName]: `admin@${rootDomain}`,
          }),
        });
      }
    }

    // Create CloudFront OAC for secure S3 access (replacing deprecated OAI)
    const frontendOAC = new cloudfront.S3OriginAccessControl(
      this,
      "FrontendOAC",
      {
        description: `OAC for ${environment} frontend bucket`,
        signing: cloudfront.Signing.SIGV4_ALWAYS,
      },
    );

    // Note: Bucket policy for OAC will be added after CloudFront distribution creation
    // because we need the distribution ID

    // NOTE: Lambda@Edge removed due to production issues (403/502 errors)
    // Using CloudFront origin request rewriting instead for SPA routing

    // API Domain Configuration (postolio.example) - declare early for CloudFront
    const apiDomainName = "postolio.example";
    const apiHostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "ApiHostedZone",
      {
        hostedZoneId: "Z06253801J6I9ZG053USV",
        zoneName: "postolio.example",
      },
    );

    // SSL Certificate for API domain and WebSocket subdomain
    const apiCertificate = new acm.Certificate(this, "ApiCertificate", {
      domainName: apiDomainName,
      subjectAlternativeNames: ["postolio.example"], // Add WebSocket subdomain
      validation: acm.CertificateValidation.fromDns(apiHostedZone),
    });

    // Placeholder for CloudFront distribution - will be created after ECS service

    // Infrastructure secrets - Only CDK-generated or infrastructure-specific secrets
    // User-provided secrets (OPENAI_API_KEY, etc.) are now passed as environment variables from GitHub Secrets
    const appSecrets = new secretsmanager.Secret(this, "AppSecrets", {
      description: "Postolio infrastructure secrets (CDK-generated only)",
      secretObjectValue: {
        // Authentication secrets (CDK-generated)
        jwtSecret: cdk.SecretValue.unsafePlainText(
          cdk.Fn.select(
            2,
            cdk.Fn.split(
              "-",
              cdk.Fn.select(2, cdk.Fn.split("/", cdk.Aws.STACK_ID)),
            ),
          ),
        ),

        // NOTE: Redis endpoint moved to environment variables (AWS best practice)
        // Non-sensitive internal endpoints should use env vars for automatic updates

        // NOTE: Publisher now uses AWS IAM SigV4 authentication instead of API keys
        // NOTE: User-provided secrets moved to environment variables:
        // - openaiApiKey -> OPENAI_API_KEY (from GitHub Secrets)
        // - googleClientSecret -> GOOGLE_CLIENT_SECRET (from GitHub Secrets)
        // - facebookAppSecret -> FACEBOOK_APP_SECRET (from GitHub Secrets)
      },
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "PostolioCluster", {
      vpc,
      // Migrate to Container Insights v2 per CDK deprecation
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // Task role with permissions to access secrets and S3
    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    dbSecret.grantRead(taskRole);
    appSecrets.grantRead(taskRole);

    // Grant permissions to upload/delete images in S3
    imagesBucket.grantReadWrite(taskRole);

    // Grant permissions to create CloudFront invalidations
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cloudfront:CreateInvalidation"],
        resources: ["*"], // Will be restricted to specific distribution after creation
      }),
    );

    // Grant permissions for AWS SES email sending
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:GetIdentityVerificationAttributes",
          "ses:VerifyEmailIdentity",
        ],
        resources: ["*"], // SES resources are global
      }),
    );

    // Grant permissions to invoke Token Service API
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["execute-api:Invoke"],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:*/*/POST/tokens`,
          `arn:aws:execute-api:${this.region}:${this.account}:*/*/DELETE/tokens`,
          `arn:aws:execute-api:${this.region}:${this.account}:*/*/POST/tokens/refresh`,
          `arn:aws:execute-api:${this.region}:${this.account}:*/*/GET/health`,
        ],
      }),
    );

    // Grant permissions for Service Discovery
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["servicediscovery:DiscoverInstances"],
        resources: ["*"], // Service discovery requires wildcard
      }),
    );

    // Custom task execution role policy
    const taskExecutionRolePolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ecr:GetAuthorizationToken",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
          ],
          resources: ["*"],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          resources: ["arn:aws:logs:*:*:*"],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "secretsmanager:GetSecretValue",
            "secretsmanager:DescribeSecret",
          ],
          resources: [dbSecret.secretArn, appSecrets.secretArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["iam:PassRole"],
          resources: [taskRole.roleArn],
          conditions: {
            StringEquals: {
              "iam:PassedToService": "ecs-tasks.amazonaws.com",
            },
          },
        }),
      ],
    });

    const executionRole = new iam.Role(this, "TaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      inlinePolicies: {
        TaskExecutionRolePolicy: taskExecutionRolePolicy,
      },
    });

    // ALB Access Logs bucket
    const albAccessLogsBucket = new s3.Bucket(this, "AlbAccessLogsBucket", {
      bucketName: `postolio-alb-logs-${environment}-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    // ALB service account IDs for different regions
    const albAccountIds: { [key: string]: string } = {
      "us-east-1": "127311923021",
      "us-east-2": "033677994240",
      "us-west-1": "027434742980",
      "us-west-2": "797873946194",
      "eu-west-1": "156460612806",
      "eu-west-2": "652711504416",
      "eu-central-1": "054676820928",
      "ap-southeast-1": "114774131450",
      "ap-southeast-2": "783225319266",
      "ap-northeast-1": "582318560864",
    };

    // Grant ALB service permission to write logs to the bucket
    albAccessLogsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowALBLogging",
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.AccountPrincipal(
            albAccountIds[cdk.Aws.REGION] || "127311923021",
          ),
        ],
        actions: ["s3:PutObject"],
        resources: [albAccessLogsBucket.arnForObjects("*")],
      }),
    );

    albAccessLogsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowALBLogDelivery",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("delivery.logs.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [albAccessLogsBucket.arnForObjects("*")],
        conditions: {
          StringEquals: {
            "s3:x-amz-acl": "bucket-owner-full-control",
          },
        },
      }),
    );

    albAccessLogsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowALBLogDeliveryGetBucketAcl",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("delivery.logs.amazonaws.com")],
        actions: ["s3:GetBucketAcl"],
        resources: [albAccessLogsBucket.bucketArn],
      }),
    );

    // Grant permission to invoke APIs discovered via Cloud Map
    // Services will discover endpoints at runtime
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["execute-api:Invoke"],
        resources: ["*"], // Allow invoking any API Gateway discovered via Cloud Map
      }),
    );

    // Get the image tag from context, defaulting to 'latest' if not provided
    // Now prefixed with 'api-' to distinguish from web images
    const baseImageTag = this.node.tryGetContext("imageTag") || "latest";
    const imageTag = baseImageTag.startsWith("api-") ? baseImageTag : `api-${baseImageTag}`;

    // ECS Service with Application Load Balancer (CloudFront domain passed as environment variable)
    const fargateService =
      new ecsPatterns.ApplicationLoadBalancedFargateService(
        this,
        "PostolioService",
        {
          cluster,
          cpu: 512,
          memoryLimitMiB: 2048, // Increased from 1024 to prevent OOM kills
          desiredCount: 1,
          taskImageOptions: {
            image: ecs.ContainerImage.fromEcrRepository(
              ecrRepository,
              imageTag,
            ),
            containerPort: 3000,
            executionRole,
            taskRole,
            secrets: {
              // Database credentials (from AWS Secrets Manager)
              DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, "username"),
              DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),

              // Infrastructure secrets (from AWS Secrets Manager)
              JWT_SECRET: ecs.Secret.fromSecretsManager(
                appSecrets,
                "jwtSecret",
              ),
            },
            environment: {
              // Database configuration
              DB_HOST: database.instanceEndpoint.hostname,
              DB_PORT: database.instanceEndpoint.port.toString(),
              DB_NAME: "postolio",

              // Redis configuration (AWS best practice: use env vars for non-sensitive endpoints)
              REDIS_HOST: redis.attrRedisEndpointAddress,
              REDIS_PORT: "6380",

              // User-provided secrets (from GitHub Secrets via CDK context)
              OPENAI_API_KEY:
                this.node.tryGetContext("openaiApiKey") ||
                process.env.OPENAI_API_KEY ||
                "",
              GOOGLE_CLIENT_SECRET:
                this.node.tryGetContext("googleClientSecret") ||
                process.env.GOOGLE_CLIENT_SECRET ||
                "",
              FACEBOOK_APP_SECRET:
                this.node.tryGetContext("facebookAppSecret") ||
                process.env.FACEBOOK_APP_SECRET ||
                "",

              // OAuth Client IDs (public values from GitHub Environment Variables via CDK context)
              GOOGLE_CLIENT_ID:
                this.node.tryGetContext("googleClientId") ||
                process.env.GOOGLE_CLIENT_ID ||
                "",
              FACEBOOK_APP_ID:
                this.node.tryGetContext("facebookAppId") ||
                process.env.FACEBOOK_APP_ID ||
                "",
              INSTAGRAM_APP_ID:
                this.node.tryGetContext("instagramAppId") ||
                process.env.INSTAGRAM_APP_ID ||
                "",
              LINKEDIN_CLIENT_ID:
                this.node.tryGetContext("linkedinClientId") ||
                process.env.LINKEDIN_CLIENT_ID ||
                "",
              TIKTOK_CLIENT_KEY:
                this.node.tryGetContext("tiktokClientKey") ||
                process.env.TIKTOK_CLIENT_KEY ||
                "",

              // URLs and domains
              CORS_ORIGIN: apiDomainName, // Use unified domain instead of CloudFront domain
              FRONTEND_URL: `https://${apiDomainName}`, // Critical: Set frontend URL for emails
              INSTAGRAM_REDIRECT_URI: `https://${apiDomainName}/api/auth/instagram/callback`,
              GOOGLE_REDIRECT_URI: `https://${apiDomainName}/api/auth/google/callback`,
              FACEBOOK_REDIRECT_URI: `https://${apiDomainName}/api/auth/facebook/callback`,

              // AWS resources
              S3_IMAGES_BUCKET: imagesBucket.bucketName,
              AWS_REGION: cdk.Aws.REGION,
              CLOUDFRONT_DOMAIN: apiDomainName, // Will be updated after distribution creation

              // Service endpoints (discovered via Cloud Map at runtime)
              SCHEDULER_API_STAGE: environment,
              WS_DOMAIN: "postolio.example", // WebSocket subdomain

              // Service Discovery Configuration
              ...getServiceDiscoveryEnvVars(serviceDiscovery.getClientConfig()),

              // AWS SES configuration
              USE_AWS_SES: "true", // Use SES in production
              SES_FROM_EMAIL: "noreply@postolio.example", // Use consistent sender address

              // Environment configuration (from GitHub Environment Variables via context)
              NODE_ENV:
                this.node.tryGetContext("nodeEnv") ||
                (environment === "prod" ? "production" : environment),
              PORT: this.node.tryGetContext("port") || "3000",
              LOG_LEVEL: this.node.tryGetContext("logLevel") || "info",
              ENABLE_MONITORING:
                this.node.tryGetContext("enableMonitoring") || "false",
            },
            logDriver: ecs.LogDrivers.awsLogs({
              streamPrefix: "postolio",
              logGroup: new logs.LogGroup(this, "AppLogGroup", {
                retention: logs.RetentionDays.ONE_WEEK,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
              }),
            }),
          },
          publicLoadBalancer: true,
          securityGroups: [ecsSecurityGroup],
        },
      );

    // Add HTTPS listener with SSL certificate
    fargateService.loadBalancer.addListener("HttpsListener", {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [apiCertificate],
      defaultTargetGroups: [fargateService.targetGroup],
    });

    // Redirect HTTP to HTTPS for security
    fargateService.listener.addAction("RedirectToHttps", {
      action: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });

    // Note: DNS record for postolio.example now points to CloudFront (created above) instead of ALB directly

    // Enable ALB access logs
    fargateService.loadBalancer.setAttribute("access_logs.s3.enabled", "true");
    fargateService.loadBalancer.setAttribute(
      "access_logs.s3.bucket",
      albAccessLogsBucket.bucketName,
    );

    // Health check configuration with proper timeouts
    fargateService.targetGroup.configureHealthCheck({
      path: "/health",
      healthyHttpCodes: "200",
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10), // Increased from default 5s
      healthyThresholdCount: 2, // Reduced from 5 to speed up healthy status
      unhealthyThresholdCount: 3, // Increased from 2 to be more tolerant
    });

    // Enable WebSocket support on target group
    // WebSocket connections require stickiness for proper session handling
    fargateService.targetGroup.enableCookieStickiness(cdk.Duration.hours(1));

    // Configure ECS service deployment settings
    const cfnServiceConfig = fargateService.service.node
      .defaultChild as ecs.CfnService;
    cfnServiceConfig.deploymentConfiguration = {
      maximumPercent: 200,
      minimumHealthyPercent: 100, // Ensure zero-downtime deployments
    };

    // CRITICAL: Set health check grace period to allow container to start
    cfnServiceConfig.healthCheckGracePeriodSeconds = 300; // 5 minutes grace period

    // Register main app with service discovery
    const mainAppService = serviceDiscovery.registerService("main-app", {
      customAttributes: {
        url: `https://${apiDomainName}/api`,
        type: "ecs",
        environment,
      },
    });

    // Associate ECS service with Cloud Map service
    fargateService.service.associateCloudMapService({
      service: mainAppService,
    });

    // Auto Scaling
    const scalableTarget = fargateService.service.autoScaleTaskCount({
      minCapacity: environment === "prod" ? 1 : 1,
      maxCapacity: environment === "prod" ? 10 : 2,
    });

    scalableTarget.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 70,
    });

    scalableTarget.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent: 80,
    });

    // Create OAC for images bucket (replacing deprecated OAI)
    const imagesOAC = new cloudfront.S3OriginAccessControl(this, "ImagesOAC", {
      description: `OAC for ${environment} images bucket`,
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // Note: Bucket policy for OAC will be added after CloudFront distribution creation

    // CloudFront Distribution with multiple origins for same-domain architecture
    const distributionProps: any = {
      // Default behavior - serves frontend from S3
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket, {
          originAccessControl: frontendOAC,
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
        "/api/*": {
          origin: new origins.LoadBalancerV2Origin(
            fargateService.loadBalancer,
            {
              protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            },
          ),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL, // Enable POST, PUT, DELETE
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          compress: false,
        },
        "/images/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(imagesBucket, {
            originAccessControl: imagesOAC,
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
          responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(
            this,
            "ImagesResponseHeadersPolicy",
            {
              corsBehavior: {
                accessControlAllowOrigins: ["*"],
                accessControlAllowHeaders: ["*"],
                accessControlAllowMethods: ["GET", "HEAD"],
                accessControlAllowCredentials: false,
                accessControlMaxAge: cdk.Duration.hours(1),
                originOverride: false,
              },
            },
          ),
        },
      },
      // Use postolio.example as the custom domain
      domainNames: ["postolio.example"],
      certificate: apiCertificate,
      defaultRootObject: "index.html",
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
      logBucket: accessLogsBucket,
      logFilePrefix: "cloudfront-logs/",
      // IMPORTANT: Selective error response configuration
      // Only handle 403 errors (S3 access denied for non-existent objects)
      // This enables SPA routing while preserving API error responses
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(5),
        },
      ],
      // Note: We explicitly DO NOT handle 404, 500, or other status codes
      // to ensure API errors pass through with their original response bodies
    };

    const distribution = new cloudfront.Distribution(
      this,
      "FrontendDistribution",
      distributionProps,
    );

    // Add bucket policies for OAC after distribution creation
    // Frontend bucket policy for OAC
    frontendBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudFrontServicePrincipalReadOnly",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [frontendBucket.arnForObjects("*")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    );

    // Images bucket policy for OAC
    imagesBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudFrontServicePrincipalReadOnly",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [imagesBucket.arnForObjects("*")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    );

    // Add CloudFront distribution ID and ALB domain to ECS task environment
    // We need to update the container definition after it's created
    fargateService.taskDefinition.defaultContainer?.addEnvironment(
      "CLOUDFRONT_DISTRIBUTION_ID",
      distribution.distributionId,
    );

    // Update existing DNS record for postolio.example to point to CloudFront (unified domain)
    // Note: We reuse the existing ApiDomainRecord logical ID to update the existing record
    new route53.ARecord(this, "ApiDomainRecord", {
      zone: apiHostedZone,
      recordName: apiDomainName,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      ),
    });

    // Create DNS record for custom domain (only if using Route 53 and different from API domain)
    if (
      domainName &&
      hostedZone &&
      !useExternalDns &&
      domainName !== apiDomainName
    ) {
      new route53.ARecord(this, "DomainARecord", {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(distribution),
        ),
      });
    }

    // Create Route53 record for WebSocket subdomain pointing directly to ALB
    new route53.ARecord(this, "WebSocketDnsRecord", {
      zone: apiHostedZone,
      recordName: "ws",
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(fargateService.loadBalancer),
      ),
      comment:
        "WebSocket subdomain pointing directly to ALB (bypasses CloudFront)",
    });

    // Output ALB DNS for WebSocket connections
    new cdk.CfnOutput(this, "ALBDomainName", {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description:
        "Application Load Balancer DNS name for WebSocket connections",
      exportName: `postolio-${environment}-alb-dns`,
    });

    new cdk.CfnOutput(this, "WebSocketDomain", {
      value: "postolio.example",
      description: "WebSocket domain for direct ALB connections",
    });

    // Outputs
    new cdk.CfnOutput(this, "ECRRepository", {
      value: ecrRepository.repositoryUri,
      description: "ECR Repository URI for backend container images",
    });

    new cdk.CfnOutput(this, "LoadBalancerDNS", {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: "Load Balancer DNS name",
    });

    new cdk.CfnOutput(this, "FrontendDistributionDomainName", {
      value: distribution.distributionDomainName,
      description: "Frontend CloudFront distribution domain name",
    });

    if (domainName) {
      new cdk.CfnOutput(this, "CustomDomainName", {
        value: domainName,
        description: "Custom domain name for the application",
      });
    }

    new cdk.CfnOutput(this, "ApplicationURL", {
      value: `https://${apiDomainName}`,
      description: "Unified application URL (frontend + API)",
    });

    new cdk.CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName,
      description: "Frontend S3 bucket name",
    });

    new cdk.CfnOutput(this, "ImagesBucketName", {
      value: imagesBucket.bucketName,
      description: "AI Images S3 bucket name",
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution ID for cache invalidation",
    });

    new cdk.CfnOutput(this, "DeployedImageTag", {
      value: imageTag,
      description: "Docker image tag used for this deployment",
    });

    new cdk.CfnOutput(this, "EcsClusterName", {
      value: cluster.clusterName,
      description: "ECS Cluster name for deployments",
    });

    new cdk.CfnOutput(this, "EcsServiceName", {
      value: fargateService.service.serviceName,
      description: "ECS Service name for deployments",
    });

    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: database.instanceEndpoint.hostname,
      description: "RDS PostgreSQL endpoint",
    });

    new cdk.CfnOutput(this, "RedisEndpoint", {
      value: redis.attrRedisEndpointAddress,
      description: "ElastiCache Redis endpoint",
    });

    new cdk.CfnOutput(this, "AppSecretsArn", {
      value: appSecrets.secretArn,
      description: "Application secrets ARN for manual configuration",
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: `https://${apiDomainName}/api`,
      description: "Secure API base URL with custom domain",
    });

    new cdk.CfnOutput(this, "ApiCertificateArn", {
      value: apiCertificate.certificateArn,
      description: "API SSL certificate ARN",
    });

    if (certificate) {
      new cdk.CfnOutput(this, "SslCertificateArn", {
        value: certificate.certificateArn,
        description: "SSL certificate ARN",
      });
    }

    // Output DNS configuration for external DNS providers
    if (domainName && useExternalDns) {
      new cdk.CfnOutput(this, "CloudFrontDistributionDomain", {
        value: distribution.distributionDomainName,
        description:
          "CloudFront distribution domain - Create CNAME record for your domain pointing to this",
      });

      new cdk.CfnOutput(this, "ExternalDnsInstructions", {
        value: `Create CNAME record: ${domainName} -> ${distribution.distributionDomainName}`,
        description: "DNS record to create with your external DNS provider",
      });
    }

    // CDK Nag suppressions for legitimate use cases
    NagSuppressions.addResourceSuppressions(vpcFlowLogsRole, [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "VPC Flow Logs require wildcard permissions for log group and stream operations",
        appliesTo: ["Resource::*"],
      },
    ]);

    // Suppress S3 frontend bucket OAC warning
    NagSuppressions.addResourceSuppressions(frontendBucket, [
      {
        id: "AwsSolutions-S5",
        reason:
          "Frontend bucket is secured with CloudFront OAC (Origin Access Control) which is the modern replacement for OAI. The bucket policy is added after distribution creation to avoid circular dependencies.",
      },
    ]);

    // Suppress TaskRole S3 wildcard permissions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/TaskRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "ECS task requires S3 operations for image storage, CloudFront/SES wildcard permissions, Service Discovery, and Token Service API invocation",
          appliesTo: [
            "Action::s3:Abort*",
            "Action::s3:DeleteObject*",
            "Action::s3:GetBucket*",
            "Action::s3:GetObject*",
            "Action::s3:List*",
            "Resource::<AIImagesBucket56BD98E8.Arn>/*",
            "Resource::*", // For CloudFront invalidations, SES operations, and Service Discovery
            // Token Service API Gateway permissions (wildcards required as API Gateway ID changes with deployments)
            "Resource::arn:aws:execute-api:us-east-1:000000000000:*/*/POST/tokens",
            "Resource::arn:aws:execute-api:us-east-1:000000000000:*/*/DELETE/tokens",
            "Resource::arn:aws:execute-api:us-east-1:000000000000:*/*/POST/tokens/refresh",
            "Resource::arn:aws:execute-api:us-east-1:000000000000:*/*/GET/health",
          ],
        },
      ],
    );

    NagSuppressions.addResourceSuppressions(executionRole, [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "ECS Task Execution requires wildcard ECR permissions for image pulls and CloudWatch Logs operations",
        appliesTo: ["Resource::*", "Resource::arn:aws:logs:*:*:*"],
      },
    ]);

    // Suppress the policy-level IAM5 warning
    NagSuppressions.addResourceSuppressions(
      executionRole.node.findChild("DefaultPolicy"),
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "ECS Task Execution requires wildcard permissions for ECR and CloudWatch Logs",
          appliesTo: ["Resource::*"],
        },
      ],
    );

    NagSuppressions.addResourceSuppressions(dbSecret, [
      {
        id: "AwsSolutions-SMG4",
        reason:
          "Database password rotation will be managed manually for this application",
      },
    ]);

    NagSuppressions.addResourceSuppressions(appSecrets, [
      {
        id: "AwsSolutions-SMG4",
        reason:
          "Application secrets rotation will be managed manually for this application",
      },
    ]);

    NagSuppressions.addResourceSuppressions(fargateService.loadBalancer, [
      {
        id: "AwsSolutions-EC23",
        reason:
          "Load balancer needs to accept incoming traffic from the internet on port 80",
      },
    ]);

    NagSuppressions.addResourceSuppressions(distribution, [
      {
        id: "AwsSolutions-CFR1",
        reason: "Geo restrictions not required for this application",
      },
      {
        id: "AwsSolutions-CFR2",
        reason: "WAF not required for this static website distribution",
      },
    ]);

    NagSuppressions.addResourceSuppressions(database, [
      {
        id: "AwsSolutions-RDS3",
        reason:
          "Multi-AZ not required for development environment, enabled via configuration for production",
      },
      {
        id: "AwsSolutions-RDS10",
        reason:
          "Deletion protection disabled for development environment, enabled for production",
      },
    ]);

    // Suppress ECS Task Definition environment variables warning
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/PostolioService/TaskDef/Resource`,
      [
        {
          id: "AwsSolutions-ECS2",
          reason:
            "Environment variables contain non-sensitive configuration. Sensitive data stored in Secrets Manager",
        },
      ],
    );

    NagSuppressions.addResourceSuppressions(accessLogsBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "This is the access logs bucket itself, does not need its own access logs",
      },
    ]);

    // AI Images bucket has access logging configured to the accessLogsBucket
    // No suppression needed as logging is enabled

    NagSuppressions.addResourceSuppressions(albAccessLogsBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "This is the ALB access logs bucket itself, does not need its own access logs",
      },
    ]);

    // Fix remaining suppressions
    NagSuppressions.addResourceSuppressions(distribution, [
      {
        id: "AwsSolutions-CFR4",
        reason:
          "CloudFront uses default certificate which has minimum TLS version limitations",
      },
      {
        id: "AwsSolutions-CFR5",
        reason: "S3 website origin requires HTTP protocol, secured by OAC",
      },
    ]);

    // Suppress load balancer security group warning
    NagSuppressions.addResourceSuppressions(
      fargateService.loadBalancer.node.findChild("SecurityGroup"),
      [
        {
          id: "AwsSolutions-EC23",
          reason:
            "Load balancer security group needs to accept HTTP traffic from internet on port 80",
        },
      ],
    );

    // NOTE: Lambda@Edge suppressions removed - Lambda@Edge function was removed due to production issues
  }
}
