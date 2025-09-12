"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostolioStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ecsPatterns = __importStar(require("aws-cdk-lib/aws-ecs-patterns"));
const elbv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const rds = __importStar(require("aws-cdk-lib/aws-rds"));
const elasticache = __importStar(require("aws-cdk-lib/aws-elasticache"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const cloudfront = __importStar(require("aws-cdk-lib/aws-cloudfront"));
const origins = __importStar(require("aws-cdk-lib/aws-cloudfront-origins"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const route53 = __importStar(require("aws-cdk-lib/aws-route53"));
const route53Targets = __importStar(require("aws-cdk-lib/aws-route53-targets"));
const acm = __importStar(require("aws-cdk-lib/aws-certificatemanager"));
const cdk_nag_1 = require("cdk-nag");
const service_discovery_infrastructure_1 = require("../utils/service-discovery-infrastructure");
class PostolioStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment, domainName, hostedZoneId, useExternalDns, serviceDiscoveryNamespaceId } = props;
        // Services use Cloud Map for discovery - no hardcoded URLs needed
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
        // VPC Flow Logs
        const flowLogsGroup = new logs.LogGroup(this, 'VpcFlowLogsGroup', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
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
        });
        // Use shared Service Discovery namespace
        const serviceDiscovery = new service_discovery_infrastructure_1.ServiceDiscoveryManager(this, 'ServiceDiscovery', {
            vpc, // Note: VPC is provided but we're using HTTP namespace from shared stack
            environment: environment,
            existingNamespaceId: serviceDiscoveryNamespaceId || cdk.Fn.importValue(`ServiceDiscovery-${environment}-NamespaceId`),
        });
        // Security Groups
        const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
            vpc,
            description: 'Security group for RDS PostgreSQL database',
        });
        const cacheSecurityGroup = new ec2.SecurityGroup(this, 'CacheSecurityGroup', {
            vpc,
            description: 'Security group for ElastiCache Redis',
        });
        const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
            vpc,
            description: 'Security group for ECS tasks',
        });
        // Allow ECS to connect to database and cache
        dbSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(5433), 'Allow ECS tasks to connect to PostgreSQL');
        cacheSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(6380), 'Allow ECS tasks to connect to Redis');
        // Database secret with URL-safe password generation
        const dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
            description: 'Postolio database credentials',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ username: 'postgres' }),
                generateStringKey: 'password',
                excludeCharacters: '"@/\\{}()[],:;=&?#%><|!~`\'$*+-', // URL-problematic characters
                passwordLength: 32,
            },
        });
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
        });
        // ElastiCache Redis Subnet Group
        const cacheSubnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
            description: 'Subnet group for ElastiCache',
            subnetIds: vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
        });
        // ElastiCache Redis
        const redis = new elasticache.CfnCacheCluster(this, 'RedisCache', {
            cacheNodeType: 'cache.t3.micro',
            engine: 'redis',
            numCacheNodes: 1,
            vpcSecurityGroupIds: [cacheSecurityGroup.securityGroupId],
            cacheSubnetGroupName: cacheSubnetGroup.ref,
            port: 6380, // Use non-default port for security
        });
        // S3 Access Logs bucket for CloudFront (created first to be used by other buckets)
        const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
            bucketName: `postolio-access-logs-${environment}-${cdk.Aws.ACCOUNT_ID}`,
            removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // Required for CloudFront logging
        });
        // S3 Bucket for AI-generated images with intelligent tiering
        const imagesBucket = new s3.Bucket(this, 'AIImagesBucket', {
            bucketName: `postolio-ai-images-${environment}-${cdk.Aws.ACCOUNT_ID}`,
            removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: environment === 'prod'
                ? s3.BucketEncryption.KMS_MANAGED // SSE-KMS for production
                : s3.BucketEncryption.S3_MANAGED, // SSE-S3 for development
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
        });
        // Grant CloudFront logging service permission to write to the access logs bucket
        accessLogsBucket.addToResourcePolicy(new iam.PolicyStatement({
            sid: 'AllowCloudFrontLogging',
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
            actions: ['s3:PutObject', 's3:GetBucketAcl', 's3:PutBucketAcl'],
            resources: [
                accessLogsBucket.bucketArn,
                accessLogsBucket.arnForObjects('*')
            ],
        }));
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
        });
        // SSL Certificate and Domain Configuration
        let certificate;
        let hostedZone;
        if (domainName) {
            if (hostedZoneId && !useExternalDns) {
                // Route 53 managed domain - automatic DNS validation
                hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
                    hostedZoneId,
                    zoneName: domainName.split('.').slice(-2).join('.'), // Get root domain (e.g., postolio.example from postolio.example)
                });
                // Create SSL certificate with DNS validation
                certificate = new acm.Certificate(this, 'SslCertificate', {
                    domainName,
                    certificateName: `${environment}-ssl-cert`,
                    validation: acm.CertificateValidation.fromDns(hostedZone),
                });
            }
            else if (useExternalDns) {
                // External DNS provider - use email validation
                const rootDomain = domainName.split('.').slice(-2).join('.');
                certificate = new acm.Certificate(this, 'SslCertificate', {
                    domainName,
                    certificateName: `${environment}-ssl-cert`,
                    validation: acm.CertificateValidation.fromEmail({
                        [domainName]: `admin@${rootDomain}`,
                    }),
                });
            }
        }
        // Create CloudFront OAC for secure S3 access (replacing deprecated OAI)
        const frontendOAC = new cloudfront.S3OriginAccessControl(this, 'FrontendOAC', {
            description: `OAC for ${environment} frontend bucket`,
            signing: cloudfront.Signing.SIGV4_ALWAYS,
        });
        // Note: Bucket policy for OAC will be added after CloudFront distribution creation
        // because we need the distribution ID
        // NOTE: Lambda@Edge removed due to production issues (403/502 errors)
        // Using CloudFront origin request rewriting instead for SPA routing
        // API Domain Configuration (postolio.example) - declare early for CloudFront
        const apiDomainName = 'postolio.example';
        const apiHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ApiHostedZone', {
            hostedZoneId: 'Z06253801J6I9ZG053USV',
            zoneName: 'postolio.example',
        });
        // SSL Certificate for API domain and WebSocket subdomain
        const apiCertificate = new acm.Certificate(this, 'ApiCertificate', {
            domainName: apiDomainName,
            subjectAlternativeNames: ['postolio.example'], // Add WebSocket subdomain
            validation: acm.CertificateValidation.fromDns(apiHostedZone),
        });
        // Placeholder for CloudFront distribution - will be created after ECS service
        // Infrastructure secrets - Only CDK-generated or infrastructure-specific secrets
        // User-provided secrets (OPENAI_API_KEY, etc.) are now passed as environment variables from GitHub Secrets
        const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
            description: 'Postolio infrastructure secrets (CDK-generated only)',
            secretObjectValue: {
                // Authentication secrets (CDK-generated)
                jwtSecret: cdk.SecretValue.unsafePlainText(cdk.Fn.select(2, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))),
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
        const cluster = new ecs.Cluster(this, 'PostolioCluster', {
            vpc,
            // Migrate to Container Insights v2 per CDK deprecation
            containerInsightsV2: ecs.ContainerInsights.ENABLED,
        });
        // Task role with permissions to access secrets and S3
        const taskRole = new iam.Role(this, 'TaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });
        dbSecret.grantRead(taskRole);
        appSecrets.grantRead(taskRole);
        // Grant permissions to upload/delete images in S3
        imagesBucket.grantReadWrite(taskRole);
        // Grant permissions to create CloudFront invalidations
        taskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['cloudfront:CreateInvalidation'],
            resources: ['*'], // Will be restricted to specific distribution after creation
        }));
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
        }));
        // Grant permissions to invoke Token Service API
        taskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'execute-api:Invoke'
            ],
            resources: [
                `arn:aws:execute-api:${this.region}:${this.account}:*/*/POST/tokens`,
                `arn:aws:execute-api:${this.region}:${this.account}:*/*/DELETE/tokens`,
                `arn:aws:execute-api:${this.region}:${this.account}:*/*/POST/tokens/refresh`,
                `arn:aws:execute-api:${this.region}:${this.account}:*/*/GET/health`
            ],
        }));
        // Grant permissions for Service Discovery
        taskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'servicediscovery:DiscoverInstances'
            ],
            resources: ['*'], // Service discovery requires wildcard
        }));
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
        });
        const executionRole = new iam.Role(this, 'TaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            inlinePolicies: {
                TaskExecutionRolePolicy: taskExecutionRolePolicy,
            },
        });
        // ALB Access Logs bucket
        const albAccessLogsBucket = new s3.Bucket(this, 'AlbAccessLogsBucket', {
            bucketName: `postolio-alb-logs-${environment}-${cdk.Aws.ACCOUNT_ID}`,
            removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
        });
        // ALB service account IDs for different regions
        const albAccountIds = {
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
        };
        // Grant ALB service permission to write logs to the bucket
        albAccessLogsBucket.addToResourcePolicy(new iam.PolicyStatement({
            sid: 'AllowALBLogging',
            effect: iam.Effect.ALLOW,
            principals: [new iam.AccountPrincipal(albAccountIds[cdk.Aws.REGION] || '127311923021')],
            actions: ['s3:PutObject'],
            resources: [albAccessLogsBucket.arnForObjects('*')],
        }));
        albAccessLogsBucket.addToResourcePolicy(new iam.PolicyStatement({
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
        }));
        albAccessLogsBucket.addToResourcePolicy(new iam.PolicyStatement({
            sid: 'AllowALBLogDeliveryGetBucketAcl',
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
            actions: ['s3:GetBucketAcl'],
            resources: [albAccessLogsBucket.bucketArn],
        }));
        // Grant permission to invoke APIs discovered via Cloud Map
        // Services will discover endpoints at runtime
        taskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['execute-api:Invoke'],
            resources: ['*'], // Allow invoking any API Gateway discovered via Cloud Map
        }));
        // Get the image tag from context, defaulting to 'latest' if not provided
        const imageTag = this.node.tryGetContext('imageTag') || 'latest';
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
                    // Database credentials (from AWS Secrets Manager)
                    DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
                    DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
                    // Infrastructure secrets (from AWS Secrets Manager)
                    JWT_SECRET: ecs.Secret.fromSecretsManager(appSecrets, 'jwtSecret'),
                },
                environment: {
                    // Database configuration
                    DB_HOST: database.instanceEndpoint.hostname,
                    DB_PORT: database.instanceEndpoint.port.toString(),
                    DB_NAME: 'postolio',
                    // Redis configuration (AWS best practice: use env vars for non-sensitive endpoints)
                    REDIS_HOST: redis.attrRedisEndpointAddress,
                    REDIS_PORT: '6380',
                    // User-provided secrets (from GitHub Secrets via CDK context)
                    OPENAI_API_KEY: this.node.tryGetContext('openaiApiKey') || process.env.OPENAI_API_KEY || '',
                    GOOGLE_CLIENT_SECRET: this.node.tryGetContext('googleClientSecret') || process.env.GOOGLE_CLIENT_SECRET || '',
                    FACEBOOK_APP_SECRET: this.node.tryGetContext('facebookAppSecret') || process.env.FACEBOOK_APP_SECRET || '',
                    // OAuth Client IDs (public values from GitHub Environment Variables via CDK context)
                    GOOGLE_CLIENT_ID: this.node.tryGetContext('googleClientId') || process.env.GOOGLE_CLIENT_ID || '',
                    FACEBOOK_APP_ID: this.node.tryGetContext('facebookAppId') || process.env.FACEBOOK_APP_ID || '',
                    INSTAGRAM_APP_ID: this.node.tryGetContext('instagramAppId') || process.env.INSTAGRAM_APP_ID || '',
                    LINKEDIN_CLIENT_ID: this.node.tryGetContext('linkedinClientId') || process.env.LINKEDIN_CLIENT_ID || '',
                    TIKTOK_CLIENT_KEY: this.node.tryGetContext('tiktokClientKey') || process.env.TIKTOK_CLIENT_KEY || '',
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
                    WS_DOMAIN: 'postolio.example', // WebSocket subdomain
                    // Service Discovery Configuration
                    ...(0, service_discovery_infrastructure_1.getServiceDiscoveryEnvVars)(serviceDiscovery.getClientConfig()),
                    // AWS SES configuration
                    USE_AWS_SES: 'true', // Use SES in production
                    SES_FROM_EMAIL: 'noreply@postolio.example', // Use consistent sender address
                    // Environment configuration (from GitHub Environment Variables via context)
                    NODE_ENV: this.node.tryGetContext('nodeEnv') || (environment === 'prod' ? 'production' : environment),
                    PORT: this.node.tryGetContext('port') || '3000',
                    LOG_LEVEL: this.node.tryGetContext('logLevel') || 'info',
                    ENABLE_MONITORING: this.node.tryGetContext('enableMonitoring') || 'false',
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
        });
        // Add HTTPS listener with SSL certificate
        fargateService.loadBalancer.addListener('HttpsListener', {
            port: 443,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            certificates: [apiCertificate],
            defaultTargetGroups: [fargateService.targetGroup],
        });
        // Redirect HTTP to HTTPS for security
        fargateService.listener.addAction('RedirectToHttps', {
            action: elbv2.ListenerAction.redirect({
                protocol: 'HTTPS',
                port: '443',
                permanent: true,
            }),
        });
        // Note: DNS record for postolio.example now points to CloudFront (created above) instead of ALB directly
        // Enable ALB access logs
        fargateService.loadBalancer.setAttribute('access_logs.s3.enabled', 'true');
        fargateService.loadBalancer.setAttribute('access_logs.s3.bucket', albAccessLogsBucket.bucketName);
        // Health check configuration with proper timeouts
        fargateService.targetGroup.configureHealthCheck({
            path: '/health',
            healthyHttpCodes: '200',
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(10), // Increased from default 5s
            healthyThresholdCount: 2, // Reduced from 5 to speed up healthy status
            unhealthyThresholdCount: 3, // Increased from 2 to be more tolerant
        });
        // Enable WebSocket support on target group
        // WebSocket connections require stickiness for proper session handling
        fargateService.targetGroup.enableCookieStickiness(cdk.Duration.hours(1));
        // Configure ECS service deployment settings
        const cfnServiceConfig = fargateService.service.node.defaultChild;
        cfnServiceConfig.deploymentConfiguration = {
            maximumPercent: 200,
            minimumHealthyPercent: 100, // Ensure zero-downtime deployments
        };
        // CRITICAL: Set health check grace period to allow container to start
        cfnServiceConfig.healthCheckGracePeriodSeconds = 300; // 5 minutes grace period
        // Register main app with service discovery
        const mainAppService = serviceDiscovery.registerService('main-app', {
            customAttributes: {
                url: `https://${apiDomainName}/api`,
                type: 'ecs',
                environment,
            },
        });
        // Associate ECS service with Cloud Map service
        fargateService.service.associateCloudMapService({
            service: mainAppService,
        });
        // Auto Scaling
        const scalableTarget = fargateService.service.autoScaleTaskCount({
            minCapacity: environment === 'prod' ? 1 : 1,
            maxCapacity: environment === 'prod' ? 10 : 2,
        });
        scalableTarget.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 70,
        });
        scalableTarget.scaleOnMemoryUtilization('MemoryScaling', {
            targetUtilizationPercent: 80,
        });
        // Create OAC for images bucket (replacing deprecated OAI)
        const imagesOAC = new cloudfront.S3OriginAccessControl(this, 'ImagesOAC', {
            description: `OAC for ${environment} images bucket`,
            signing: cloudfront.Signing.SIGV4_ALWAYS,
        });
        // Note: Bucket policy for OAC will be added after CloudFront distribution creation
        // CloudFront Distribution with multiple origins for same-domain architecture
        const distributionProps = {
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
                    origin: origins.S3BucketOrigin.withOriginAccessControl(imagesBucket, {
                        originAccessControl: imagesOAC,
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
        };
        const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', distributionProps);
        // Add bucket policies for OAC after distribution creation
        // Frontend bucket policy for OAC
        frontendBucket.addToResourcePolicy(new iam.PolicyStatement({
            sid: 'AllowCloudFrontServicePrincipalReadOnly',
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
            actions: ['s3:GetObject'],
            resources: [frontendBucket.arnForObjects('*')],
            conditions: {
                StringEquals: {
                    'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
                },
            },
        }));
        // Images bucket policy for OAC
        imagesBucket.addToResourcePolicy(new iam.PolicyStatement({
            sid: 'AllowCloudFrontServicePrincipalReadOnly',
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
            actions: ['s3:GetObject'],
            resources: [imagesBucket.arnForObjects('*')],
            conditions: {
                StringEquals: {
                    'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
                },
            },
        }));
        // Add CloudFront distribution ID and ALB domain to ECS task environment
        // We need to update the container definition after it's created
        fargateService.taskDefinition.defaultContainer?.addEnvironment('CLOUDFRONT_DISTRIBUTION_ID', distribution.distributionId);
        // Update existing DNS record for postolio.example to point to CloudFront (unified domain)
        // Note: We reuse the existing ApiDomainRecord logical ID to update the existing record
        new route53.ARecord(this, 'ApiDomainRecord', {
            zone: apiHostedZone,
            recordName: apiDomainName,
            target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
        });
        // Create DNS record for custom domain (only if using Route 53 and different from API domain)
        if (domainName && hostedZone && !useExternalDns && domainName !== apiDomainName) {
            new route53.ARecord(this, 'DomainARecord', {
                zone: hostedZone,
                recordName: domainName,
                target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
            });
        }
        // Create Route53 record for WebSocket subdomain pointing directly to ALB
        new route53.ARecord(this, 'WebSocketDnsRecord', {
            zone: apiHostedZone,
            recordName: 'ws',
            target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(fargateService.loadBalancer)),
            comment: 'WebSocket subdomain pointing directly to ALB (bypasses CloudFront)',
        });
        // Output ALB DNS for WebSocket connections
        new cdk.CfnOutput(this, 'ALBDomainName', {
            value: fargateService.loadBalancer.loadBalancerDnsName,
            description: 'Application Load Balancer DNS name for WebSocket connections',
            exportName: `postolio-${environment}-alb-dns`,
        });
        new cdk.CfnOutput(this, 'WebSocketDomain', {
            value: 'postolio.example',
            description: 'WebSocket domain for direct ALB connections',
        });
        // Outputs
        new cdk.CfnOutput(this, 'ECRRepository', {
            value: ecrRepository.repositoryUri,
            description: 'ECR Repository URI for backend container images',
        });
        new cdk.CfnOutput(this, 'LoadBalancerDNS', {
            value: fargateService.loadBalancer.loadBalancerDnsName,
            description: 'Load Balancer DNS name',
        });
        new cdk.CfnOutput(this, 'FrontendDistributionDomainName', {
            value: distribution.distributionDomainName,
            description: 'Frontend CloudFront distribution domain name',
        });
        if (domainName) {
            new cdk.CfnOutput(this, 'CustomDomainName', {
                value: domainName,
                description: 'Custom domain name for the application',
            });
        }
        new cdk.CfnOutput(this, 'ApplicationURL', {
            value: `https://${apiDomainName}`,
            description: 'Unified application URL (frontend + API)',
        });
        new cdk.CfnOutput(this, 'FrontendBucketName', {
            value: frontendBucket.bucketName,
            description: 'Frontend S3 bucket name',
        });
        new cdk.CfnOutput(this, 'ImagesBucketName', {
            value: imagesBucket.bucketName,
            description: 'AI Images S3 bucket name',
        });
        new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
            value: distribution.distributionId,
            description: 'CloudFront distribution ID for cache invalidation',
        });
        new cdk.CfnOutput(this, 'DeployedImageTag', {
            value: imageTag,
            description: 'Docker image tag used for this deployment',
        });
        new cdk.CfnOutput(this, 'EcsClusterName', {
            value: cluster.clusterName,
            description: 'ECS Cluster name for deployments',
        });
        new cdk.CfnOutput(this, 'EcsServiceName', {
            value: fargateService.service.serviceName,
            description: 'ECS Service name for deployments',
        });
        new cdk.CfnOutput(this, 'DatabaseEndpoint', {
            value: database.instanceEndpoint.hostname,
            description: 'RDS PostgreSQL endpoint',
        });
        new cdk.CfnOutput(this, 'RedisEndpoint', {
            value: redis.attrRedisEndpointAddress,
            description: 'ElastiCache Redis endpoint',
        });
        new cdk.CfnOutput(this, 'AppSecretsArn', {
            value: appSecrets.secretArn,
            description: 'Application secrets ARN for manual configuration',
        });
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: `https://${apiDomainName}/api`,
            description: 'Secure API base URL with custom domain',
        });
        new cdk.CfnOutput(this, 'ApiCertificateArn', {
            value: apiCertificate.certificateArn,
            description: 'API SSL certificate ARN',
        });
        if (certificate) {
            new cdk.CfnOutput(this, 'SslCertificateArn', {
                value: certificate.certificateArn,
                description: 'SSL certificate ARN',
            });
        }
        // Output DNS configuration for external DNS providers
        if (domainName && useExternalDns) {
            new cdk.CfnOutput(this, 'CloudFrontDistributionDomain', {
                value: distribution.distributionDomainName,
                description: 'CloudFront distribution domain - Create CNAME record for your domain pointing to this',
            });
            new cdk.CfnOutput(this, 'ExternalDnsInstructions', {
                value: `Create CNAME record: ${domainName} -> ${distribution.distributionDomainName}`,
                description: 'DNS record to create with your external DNS provider',
            });
        }
        // CDK Nag suppressions for legitimate use cases
        cdk_nag_1.NagSuppressions.addResourceSuppressions(vpcFlowLogsRole, [{
                id: 'AwsSolutions-IAM5',
                reason: 'VPC Flow Logs require wildcard permissions for log group and stream operations',
                appliesTo: ['Resource::*'],
            }]);
        // Suppress S3 frontend bucket OAC warning  
        cdk_nag_1.NagSuppressions.addResourceSuppressions(frontendBucket, [{
                id: 'AwsSolutions-S5',
                reason: 'Frontend bucket is secured with CloudFront OAC (Origin Access Control) which is the modern replacement for OAI. The bucket policy is added after distribution creation to avoid circular dependencies.'
            }]);
        // Suppress TaskRole S3 wildcard permissions
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/TaskRole/DefaultPolicy/Resource`, [{
                id: 'AwsSolutions-IAM5',
                reason: 'ECS task requires S3 operations for image storage, CloudFront/SES wildcard permissions, Service Discovery, and Token Service API invocation',
                appliesTo: [
                    'Action::s3:Abort*',
                    'Action::s3:DeleteObject*',
                    'Action::s3:GetBucket*',
                    'Action::s3:GetObject*',
                    'Action::s3:List*',
                    'Resource::<AIImagesBucket56BD98E8.Arn>/*',
                    'Resource::*', // For CloudFront invalidations, SES operations, and Service Discovery
                    // Token Service API Gateway permissions (wildcards required as API Gateway ID changes with deployments)
                    'Resource::arn:aws:execute-api:us-east-1:000000000000:*/*/POST/tokens',
                    'Resource::arn:aws:execute-api:us-east-1:000000000000:*/*/DELETE/tokens',
                    'Resource::arn:aws:execute-api:us-east-1:000000000000:*/*/POST/tokens/refresh',
                    'Resource::arn:aws:execute-api:us-east-1:000000000000:*/*/GET/health',
                ],
            }]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(executionRole, [{
                id: 'AwsSolutions-IAM5',
                reason: 'ECS Task Execution requires wildcard ECR permissions for image pulls and CloudWatch Logs operations',
                appliesTo: ['Resource::*', 'Resource::arn:aws:logs:*:*:*'],
            }]);
        // Suppress the policy-level IAM5 warning 
        cdk_nag_1.NagSuppressions.addResourceSuppressions(executionRole.node.findChild('DefaultPolicy'), [{
                id: 'AwsSolutions-IAM5',
                reason: 'ECS Task Execution requires wildcard permissions for ECR and CloudWatch Logs',
                appliesTo: ['Resource::*'],
            }]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(dbSecret, [{
                id: 'AwsSolutions-SMG4',
                reason: 'Database password rotation will be managed manually for this application',
            }]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(appSecrets, [{
                id: 'AwsSolutions-SMG4',
                reason: 'Application secrets rotation will be managed manually for this application',
            }]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(fargateService.loadBalancer, [{
                id: 'AwsSolutions-EC23',
                reason: 'Load balancer needs to accept incoming traffic from the internet on port 80',
            }]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(distribution, [{
                id: 'AwsSolutions-CFR1',
                reason: 'Geo restrictions not required for this application',
            },
            {
                id: 'AwsSolutions-CFR2',
                reason: 'WAF not required for this static website distribution',
            }]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(database, [{
                id: 'AwsSolutions-RDS3',
                reason: 'Multi-AZ not required for development environment, enabled via configuration for production',
            },
            {
                id: 'AwsSolutions-RDS10',
                reason: 'Deletion protection disabled for development environment, enabled for production',
            }]);
        // Suppress ECS Task Definition environment variables warning
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/PostolioService/TaskDef/Resource`, [{
                id: 'AwsSolutions-ECS2',
                reason: 'Environment variables contain non-sensitive configuration. Sensitive data stored in Secrets Manager',
            }]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(accessLogsBucket, [{
                id: 'AwsSolutions-S1',
                reason: 'This is the access logs bucket itself, does not need its own access logs',
            }]);
        // AI Images bucket has access logging configured to the accessLogsBucket
        // No suppression needed as logging is enabled
        cdk_nag_1.NagSuppressions.addResourceSuppressions(albAccessLogsBucket, [{
                id: 'AwsSolutions-S1',
                reason: 'This is the ALB access logs bucket itself, does not need its own access logs',
            }]);
        // Fix remaining suppressions
        cdk_nag_1.NagSuppressions.addResourceSuppressions(distribution, [{
                id: 'AwsSolutions-CFR4',
                reason: 'CloudFront uses default certificate which has minimum TLS version limitations',
            },
            {
                id: 'AwsSolutions-CFR5',
                reason: 'S3 website origin requires HTTP protocol, secured by OAC',
            }]);
        // Suppress load balancer security group warning
        cdk_nag_1.NagSuppressions.addResourceSuppressions(fargateService.loadBalancer.node.findChild('SecurityGroup'), [{
                id: 'AwsSolutions-EC23',
                reason: 'Load balancer security group needs to accept HTTP traffic from internet on port 80',
            }]);
        // NOTE: Lambda@Edge suppressions removed - Lambda@Edge function was removed due to production issues
    }
}
exports.PostolioStack = PostolioStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9zdG9saW8tc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwb3N0b2xpby1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBa0M7QUFDbEMseURBQTBDO0FBQzFDLHlEQUEwQztBQUMxQywwRUFBMkQ7QUFDM0QsOEVBQStEO0FBQy9ELHlEQUEwQztBQUMxQyx5REFBMEM7QUFDMUMseUVBQTBEO0FBQzFELHVEQUF3QztBQUN4Qyx1RUFBd0Q7QUFDeEQsNEVBQTZEO0FBQzdELCtFQUFnRTtBQUNoRSwyREFBNEM7QUFDNUMseURBQTBDO0FBQzFDLGlFQUFrRDtBQUNsRCxnRkFBaUU7QUFDakUsd0VBQXlEO0FBQ3pELHFDQUF5QztBQUV6QyxnR0FBK0c7QUFXL0csTUFBYSxhQUFjLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFFMUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF5QjtRQUNqRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQTtRQUV2QixNQUFNLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxZQUFZLEVBQUUsY0FBYyxFQUFFLDJCQUEyQixFQUFFLEdBQUcsS0FBSyxDQUFBO1FBRXBHLGtFQUFrRTtRQUdsRSw4RUFBOEU7UUFDOUUsTUFBTSxhQUFhLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUUsVUFBVSxDQUFDLENBQUE7UUFFL0YscUJBQXFCO1FBQ3JCLE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDNUQsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLDZCQUE2QixDQUFDO1lBQ2xFLGNBQWMsRUFBRTtnQkFDZCwwQkFBMEIsRUFBRSxJQUFJLEdBQUcsQ0FB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QUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsMERBQTBEO2FBQ25FLENBQUMsQ0FDSCxDQUFBO1FBRUQsZ0RBQWdEO1FBQ2hELHlCQUFlLENBQUMsdUJBQXVCLENBQ3JDLGNBQWMsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxlQUFlLENBQUMsRUFDM0QsQ0FBQztnQkFDQyxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsb0ZBQW9GO2FBQzdGLENBQUMsQ0FDSCxDQUFBO1FBRUQscUdBQXFHO0lBQ3ZHLENBQUM7Q0FDRjtBQS9pQ0Qsc0NBK2lDQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJ1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnXG5pbXBvcnQgKiBhcyBlY3NQYXR0ZXJucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzLXBhdHRlcm5zJ1xuaW1wb3J0ICogYXMgZWxidjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNsb2FkYmFsYW5jaW5ndjInXG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcidcbmltcG9ydCAqIGFzIHJkcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmRzJ1xuaW1wb3J0ICogYXMgZWxhc3RpY2FjaGUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNhY2hlJ1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJ1xuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udCdcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2lucydcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcidcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCAqIGFzIHJvdXRlNTMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJvdXRlNTMnXG5pbXBvcnQgKiBhcyByb3V0ZTUzVGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtcm91dGU1My10YXJnZXRzJ1xuaW1wb3J0ICogYXMgYWNtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXInXG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJ1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cydcbmltcG9ydCB7IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLCBnZXRTZXJ2aWNlRGlzY292ZXJ5RW52VmFycyB9IGZyb20gJy4uL3V0aWxzL3NlcnZpY2UtZGlzY292ZXJ5LWluZnJhc3RydWN0dXJlJ1xuXG5leHBvcnQgaW50ZXJmYWNlIFBvc3RvbGlvU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52aXJvbm1lbnQ6IHN0cmluZ1xuICBkb21haW5OYW1lPzogc3RyaW5nXG4gIGhvc3RlZFpvbmVJZD86IHN0cmluZ1xuICB1c2VFeHRlcm5hbERucz86IGJvb2xlYW5cbiAgc2VydmljZURpc2NvdmVyeU5hbWVzcGFjZUlkPzogc3RyaW5nOyAvLyBVc2Ugc2hhcmVkIG5hbWVzcGFjZVxuICAvLyBObyBzdGFjayByZWZlcmVuY2VzIG5lZWRlZCAtIHNlcnZpY2VzIHVzZSBDbG91ZCBNYXAgZm9yIGRpc2NvdmVyeVxufVxuXG5leHBvcnQgY2xhc3MgUG9zdG9saW9TdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFBvc3RvbGlvU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpXG5cbiAgICBjb25zdCB7IGVudmlyb25tZW50LCBkb21haW5OYW1lLCBob3N0ZWRab25lSWQsIHVzZUV4dGVybmFsRG5zLCBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlSWQgfSA9IHByb3BzXG5cbiAgICAvLyBTZXJ2aWNlcyB1c2UgQ2xvdWQgTWFwIGZvciBkaXNjb3ZlcnkgLSBubyBoYXJkY29kZWQgVVJMcyBuZWVkZWRcblxuXG4gICAgLy8gRUNSIFJlcG9zaXRvcnkgZm9yIGJhY2tlbmQgY29udGFpbmVyIGltYWdlcyAtIHJlZmVyZW5jZSBleGlzdGluZyByZXBvc2l0b3J5XG4gICAgY29uc3QgZWNyUmVwb3NpdG9yeSA9IGVjci5SZXBvc2l0b3J5LmZyb21SZXBvc2l0b3J5TmFtZSh0aGlzLCAnUG9zdG9saW9SZXBvc2l0b3J5JywgJ3Bvc3RvbGlvJylcblxuICAgIC8vIFZQQyBGbG93IExvZ3Mgcm9sZVxuICAgIGNvbnN0IHZwY0Zsb3dMb2dzUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnVnBjRmxvd0xvZ3NSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ3ZwYy1mbG93LWxvZ3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgRmxvd0xvZ3NEZWxpdmVyeVJvbGVQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxuICAgICAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJyxcbiAgICAgICAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ0dyb3VwcycsXG4gICAgICAgICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgLy8gVlBDIEZsb3cgTG9nc1xuICAgIGNvbnN0IGZsb3dMb2dzR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnVnBjRmxvd0xvZ3NHcm91cCcsIHtcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KVxuXG4gICAgLy8gVlBDXG4gICAgY29uc3QgdnBjID0gbmV3IGVjMi5WcGModGhpcywgJ1Bvc3RvbGlvVnBjJywge1xuICAgICAgbWF4QXpzOiAyLFxuICAgICAgbmF0R2F0ZXdheXM6IDEsIC8vIENvc3Qgb3B0aW1pemF0aW9uOiBzaW5nbGUgTkFUIGdhdGV3YXlcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAnUHVibGljJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ1ByaXZhdGUnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjgsXG4gICAgICAgICAgbmFtZTogJ0lzb2xhdGVkJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGZsb3dMb2dzOiB7XG4gICAgICAgICdGbG93TG9nQ2xvdWRXYXRjaCc6IHtcbiAgICAgICAgICBkZXN0aW5hdGlvbjogZWMyLkZsb3dMb2dEZXN0aW5hdGlvbi50b0Nsb3VkV2F0Y2hMb2dzKGZsb3dMb2dzR3JvdXAsIHZwY0Zsb3dMb2dzUm9sZSksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICAvLyBVc2Ugc2hhcmVkIFNlcnZpY2UgRGlzY292ZXJ5IG5hbWVzcGFjZVxuICAgIGNvbnN0IHNlcnZpY2VEaXNjb3ZlcnkgPSBuZXcgU2VydmljZURpc2NvdmVyeU1hbmFnZXIodGhpcywgJ1NlcnZpY2VEaXNjb3ZlcnknLCB7XG4gICAgICB2cGMsIC8vIE5vdGU6IFZQQyBpcyBwcm92aWRlZCBidXQgd2UncmUgdXNpbmcgSFRUUCBuYW1lc3BhY2UgZnJvbSBzaGFyZWQgc3RhY2tcbiAgICAgIGVudmlyb25tZW50OiBlbnZpcm9ubWVudCBhcyAnZGV2JyB8ICdzdGFnaW5nJyB8ICdwcm9kJyxcbiAgICAgIGV4aXN0aW5nTmFtZXNwYWNlSWQ6IHNlcnZpY2VEaXNjb3ZlcnlOYW1lc3BhY2VJZCB8fCBjZGsuRm4uaW1wb3J0VmFsdWUoYFNlcnZpY2VEaXNjb3ZlcnktJHtlbnZpcm9ubWVudH0tTmFtZXNwYWNlSWRgKSxcbiAgICB9KVxuXG4gICAgLy8gU2VjdXJpdHkgR3JvdXBzXG4gICAgY29uc3QgZGJTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdEYXRhYmFzZVNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBSRFMgUG9zdGdyZVNRTCBkYXRhYmFzZScsXG4gICAgfSlcblxuICAgIGNvbnN0IGNhY2hlU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnQ2FjaGVTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgRWxhc3RpQ2FjaGUgUmVkaXMnLFxuICAgIH0pXG5cbiAgICBjb25zdCBlY3NTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdFY3NTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgRUNTIHRhc2tzJyxcbiAgICB9KVxuXG4gICAgLy8gQWxsb3cgRUNTIHRvIGNvbm5lY3QgdG8gZGF0YWJhc2UgYW5kIGNhY2hlXG4gICAgZGJTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKGVjc1NlY3VyaXR5R3JvdXAsIGVjMi5Qb3J0LnRjcCg1NDMzKSwgJ0FsbG93IEVDUyB0YXNrcyB0byBjb25uZWN0IHRvIFBvc3RncmVTUUwnKVxuXG4gICAgY2FjaGVTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKGVjc1NlY3VyaXR5R3JvdXAsIGVjMi5Qb3J0LnRjcCg2MzgwKSwgJ0FsbG93IEVDUyB0YXNrcyB0byBjb25uZWN0IHRvIFJlZGlzJylcblxuICAgIC8vIERhdGFiYXNlIHNlY3JldCB3aXRoIFVSTC1zYWZlIHBhc3N3b3JkIGdlbmVyYXRpb25cbiAgICBjb25zdCBkYlNlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ0RhdGFiYXNlU2VjcmV0Jywge1xuICAgICAgZGVzY3JpcHRpb246ICdQb3N0b2xpbyBkYXRhYmFzZSBjcmVkZW50aWFscycsXG4gICAgICBnZW5lcmF0ZVNlY3JldFN0cmluZzoge1xuICAgICAgICBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogSlNPTi5zdHJpbmdpZnkoeyB1c2VybmFtZTogJ3Bvc3RncmVzJyB9KSxcbiAgICAgICAgZ2VuZXJhdGVTdHJpbmdLZXk6ICdwYXNzd29yZCcsXG4gICAgICAgIGV4Y2x1ZGVDaGFyYWN0ZXJzOiAnXCJAL1xcXFx7fSgpW10sOjs9Jj8jJT48fCF+YFxcJyQqKy0nLCAvLyBVUkwtcHJvYmxlbWF0aWMgY2hhcmFjdGVyc1xuICAgICAgICBwYXNzd29yZExlbmd0aDogMzIsXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICAvLyBSRFMgUG9zdGdyZVNRTCBEYXRhYmFzZVxuICAgIGNvbnN0IGRhdGFiYXNlID0gbmV3IHJkcy5EYXRhYmFzZUluc3RhbmNlKHRoaXMsICdEYXRhYmFzZScsIHtcbiAgICAgIGVuZ2luZTogcmRzLkRhdGFiYXNlSW5zdGFuY2VFbmdpbmUucG9zdGdyZXMoe1xuICAgICAgICB2ZXJzaW9uOiByZHMuUG9zdGdyZXNFbmdpbmVWZXJzaW9uLlZFUl8xNSxcbiAgICAgIH0pLFxuICAgICAgaW5zdGFuY2VUeXBlOiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLlQzLCBlYzIuSW5zdGFuY2VTaXplLk1JQ1JPKSxcbiAgICAgIGNyZWRlbnRpYWxzOiByZHMuQ3JlZGVudGlhbHMuZnJvbVNlY3JldChkYlNlY3JldCksXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiB7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICB9LFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtkYlNlY3VyaXR5R3JvdXBdLFxuICAgICAgZGF0YWJhc2VOYW1lOiAncG9zdG9saW8nLFxuICAgICAgZGVsZXRpb25Qcm90ZWN0aW9uOiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnLCAvLyBPbmx5IGVuYWJsZSBkZWxldGlvbiBwcm90ZWN0aW9uIGluIHByb2R1Y3Rpb25cbiAgICAgIGJhY2t1cFJldGVudGlvbjogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IGNkay5EdXJhdGlvbi5kYXlzKDcpIDogY2RrLkR1cmF0aW9uLmRheXMoMSksXG4gICAgICBkZWxldGVBdXRvbWF0ZWRCYWNrdXBzOiBlbnZpcm9ubWVudCAhPT0gJ3Byb2QnLFxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IGNkay5SZW1vdmFsUG9saWN5LlNOQVBTSE9UIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHN0b3JhZ2VFbmNyeXB0ZWQ6IHRydWUsIC8vIEVuYWJsZSBlbmNyeXB0aW9uIGF0IHJlc3RcbiAgICAgIG11bHRpQXo6IGVudmlyb25tZW50ID09PSAncHJvZCcsIC8vIEVuYWJsZSBNdWx0aS1BWiBmb3IgcHJvZHVjdGlvblxuICAgICAgcG9ydDogNTQzMywgLy8gVXNlIG5vbi1kZWZhdWx0IHBvcnQgZm9yIHNlY3VyaXR5XG4gICAgfSlcblxuICAgIC8vIEVsYXN0aUNhY2hlIFJlZGlzIFN1Ym5ldCBHcm91cFxuICAgIGNvbnN0IGNhY2hlU3VibmV0R3JvdXAgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuU3VibmV0R3JvdXAodGhpcywgJ0NhY2hlU3VibmV0R3JvdXAnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1N1Ym5ldCBncm91cCBmb3IgRWxhc3RpQ2FjaGUnLFxuICAgICAgc3VibmV0SWRzOiB2cGMuaXNvbGF0ZWRTdWJuZXRzLm1hcCgoc3VibmV0OiBlYzIuSVN1Ym5ldCkgPT4gc3VibmV0LnN1Ym5ldElkKSxcbiAgICB9KVxuXG4gICAgLy8gRWxhc3RpQ2FjaGUgUmVkaXNcbiAgICBjb25zdCByZWRpcyA9IG5ldyBlbGFzdGljYWNoZS5DZm5DYWNoZUNsdXN0ZXIodGhpcywgJ1JlZGlzQ2FjaGUnLCB7XG4gICAgICBjYWNoZU5vZGVUeXBlOiAnY2FjaGUudDMubWljcm8nLFxuICAgICAgZW5naW5lOiAncmVkaXMnLFxuICAgICAgbnVtQ2FjaGVOb2RlczogMSxcbiAgICAgIHZwY1NlY3VyaXR5R3JvdXBJZHM6IFtjYWNoZVNlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkXSxcbiAgICAgIGNhY2hlU3VibmV0R3JvdXBOYW1lOiBjYWNoZVN1Ym5ldEdyb3VwLnJlZixcbiAgICAgIHBvcnQ6IDYzODAsIC8vIFVzZSBub24tZGVmYXVsdCBwb3J0IGZvciBzZWN1cml0eVxuICAgIH0pXG5cbiAgICAvLyBTMyBBY2Nlc3MgTG9ncyBidWNrZXQgZm9yIENsb3VkRnJvbnQgKGNyZWF0ZWQgZmlyc3QgdG8gYmUgdXNlZCBieSBvdGhlciBidWNrZXRzKVxuICAgIGNvbnN0IGFjY2Vzc0xvZ3NCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdBY2Nlc3NMb2dzQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYHBvc3RvbGlvLWFjY2Vzcy1sb2dzLSR7ZW52aXJvbm1lbnR9LSR7Y2RrLkF3cy5BQ0NPVU5UX0lEfWAsXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgb2JqZWN0T3duZXJzaGlwOiBzMy5PYmplY3RPd25lcnNoaXAuQlVDS0VUX09XTkVSX1BSRUZFUlJFRCwgLy8gUmVxdWlyZWQgZm9yIENsb3VkRnJvbnQgbG9nZ2luZ1xuICAgIH0pXG5cbiAgICAvLyBTMyBCdWNrZXQgZm9yIEFJLWdlbmVyYXRlZCBpbWFnZXMgd2l0aCBpbnRlbGxpZ2VudCB0aWVyaW5nXG4gICAgY29uc3QgaW1hZ2VzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQUlJbWFnZXNCdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiBgcG9zdG9saW8tYWktaW1hZ2VzLSR7ZW52aXJvbm1lbnR9LSR7Y2RrLkF3cy5BQ0NPVU5UX0lEfWAsXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICBlbmNyeXB0aW9uOiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnIFxuICAgICAgICA/IHMzLkJ1Y2tldEVuY3J5cHRpb24uS01TX01BTkFHRUQgLy8gU1NFLUtNUyBmb3IgcHJvZHVjdGlvblxuICAgICAgICA6IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCwgIC8vIFNTRS1TMyBmb3IgZGV2ZWxvcG1lbnRcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICB2ZXJzaW9uZWQ6IGVudmlyb25tZW50ID09PSAncHJvZCcsXG4gICAgICBzZXJ2ZXJBY2Nlc3NMb2dzQnVja2V0OiBhY2Nlc3NMb2dzQnVja2V0LFxuICAgICAgc2VydmVyQWNjZXNzTG9nc1ByZWZpeDogJ2ltYWdlcy1hY2Nlc3MtbG9ncy8nLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnaW50ZWxsaWdlbnQtdGllcmluZycsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTkZSRVFVRU5UX0FDQ0VTUyxcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygzMCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5HTEFDSUVSLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDkwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkRFRVBfQVJDSElWRSxcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygzNjUpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdjb21wbGlhbmNlLWRlbGV0aW9uJyxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDI1NTUpLCAvLyA3IHllYXJzIGZvciBjb21wbGlhbmNlXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgY29yczogW1xuICAgICAgICB7XG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IFtzMy5IdHRwTWV0aG9kcy5HRVQsIHMzLkh0dHBNZXRob2RzLkhFQURdLFxuICAgICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbJyonXSxcbiAgICAgICAgICBhbGxvd2VkSGVhZGVyczogWycqJ10sXG4gICAgICAgICAgbWF4QWdlOiAzNjAwLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KVxuXG4gICAgLy8gR3JhbnQgQ2xvdWRGcm9udCBsb2dnaW5nIHNlcnZpY2UgcGVybWlzc2lvbiB0byB3cml0ZSB0byB0aGUgYWNjZXNzIGxvZ3MgYnVja2V0XG4gICAgYWNjZXNzTG9nc0J1Y2tldC5hZGRUb1Jlc291cmNlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdBbGxvd0Nsb3VkRnJvbnRMb2dnaW5nJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBwcmluY2lwYWxzOiBbbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdkZWxpdmVyeS5sb2dzLmFtYXpvbmF3cy5jb20nKV0sXG4gICAgICAgIGFjdGlvbnM6IFsnczM6UHV0T2JqZWN0JywgJ3MzOkdldEJ1Y2tldEFjbCcsICdzMzpQdXRCdWNrZXRBY2wnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYWNjZXNzTG9nc0J1Y2tldC5idWNrZXRBcm4sXG4gICAgICAgICAgYWNjZXNzTG9nc0J1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJylcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gUzMgQnVja2V0IGZvciBmcm9udGVuZCBhc3NldHNcbiAgICBjb25zdCBmcm9udGVuZEJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0Zyb250ZW5kQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYHBvc3RvbGlvLWZyb250ZW5kLSR7ZW52aXJvbm1lbnR9LSR7Y2RrLkF3cy5BQ0NPVU5UX0lEfWAsXG4gICAgICB3ZWJzaXRlSW5kZXhEb2N1bWVudDogJ2luZGV4Lmh0bWwnLFxuICAgICAgd2Vic2l0ZUVycm9yRG9jdW1lbnQ6ICdpbmRleC5odG1sJyxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBzZXJ2ZXJBY2Nlc3NMb2dzQnVja2V0OiBhY2Nlc3NMb2dzQnVja2V0LFxuICAgICAgc2VydmVyQWNjZXNzTG9nc1ByZWZpeDogJ2Zyb250ZW5kLWFjY2Vzcy1sb2dzLycsXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgfSlcblxuICAgIC8vIFNTTCBDZXJ0aWZpY2F0ZSBhbmQgRG9tYWluIENvbmZpZ3VyYXRpb25cbiAgICBsZXQgY2VydGlmaWNhdGU6IGFjbS5DZXJ0aWZpY2F0ZSB8IHVuZGVmaW5lZFxuICAgIGxldCBob3N0ZWRab25lOiByb3V0ZTUzLklIb3N0ZWRab25lIHwgdW5kZWZpbmVkXG5cbiAgICBpZiAoZG9tYWluTmFtZSkge1xuICAgICAgaWYgKGhvc3RlZFpvbmVJZCAmJiAhdXNlRXh0ZXJuYWxEbnMpIHtcbiAgICAgICAgLy8gUm91dGUgNTMgbWFuYWdlZCBkb21haW4gLSBhdXRvbWF0aWMgRE5TIHZhbGlkYXRpb25cbiAgICAgICAgaG9zdGVkWm9uZSA9IHJvdXRlNTMuSG9zdGVkWm9uZS5mcm9tSG9zdGVkWm9uZUF0dHJpYnV0ZXModGhpcywgJ0hvc3RlZFpvbmUnLCB7XG4gICAgICAgICAgaG9zdGVkWm9uZUlkLFxuICAgICAgICAgIHpvbmVOYW1lOiBkb21haW5OYW1lLnNwbGl0KCcuJykuc2xpY2UoLTIpLmpvaW4oJy4nKSwgLy8gR2V0IHJvb3QgZG9tYWluIChlLmcuLCBwb3N0b2wuaW8gZnJvbSBhcHAucG9zdG9sLmlvKVxuICAgICAgICB9KVxuXG4gICAgICAgIC8vIENyZWF0ZSBTU0wgY2VydGlmaWNhdGUgd2l0aCBETlMgdmFsaWRhdGlvblxuICAgICAgICBjZXJ0aWZpY2F0ZSA9IG5ldyBhY20uQ2VydGlmaWNhdGUodGhpcywgJ1NzbENlcnRpZmljYXRlJywge1xuICAgICAgICAgIGRvbWFpbk5hbWUsXG4gICAgICAgICAgY2VydGlmaWNhdGVOYW1lOiBgJHtlbnZpcm9ubWVudH0tc3NsLWNlcnRgLFxuICAgICAgICAgIHZhbGlkYXRpb246IGFjbS5DZXJ0aWZpY2F0ZVZhbGlkYXRpb24uZnJvbURucyhob3N0ZWRab25lKSxcbiAgICAgICAgfSlcbiAgICAgIH0gZWxzZSBpZiAodXNlRXh0ZXJuYWxEbnMpIHtcbiAgICAgICAgLy8gRXh0ZXJuYWwgRE5TIHByb3ZpZGVyIC0gdXNlIGVtYWlsIHZhbGlkYXRpb25cbiAgICAgICAgY29uc3Qgcm9vdERvbWFpbiA9IGRvbWFpbk5hbWUuc3BsaXQoJy4nKS5zbGljZSgtMikuam9pbignLicpXG4gICAgICAgIGNlcnRpZmljYXRlID0gbmV3IGFjbS5DZXJ0aWZpY2F0ZSh0aGlzLCAnU3NsQ2VydGlmaWNhdGUnLCB7XG4gICAgICAgICAgZG9tYWluTmFtZSxcbiAgICAgICAgICBjZXJ0aWZpY2F0ZU5hbWU6IGAke2Vudmlyb25tZW50fS1zc2wtY2VydGAsXG4gICAgICAgICAgdmFsaWRhdGlvbjogYWNtLkNlcnRpZmljYXRlVmFsaWRhdGlvbi5mcm9tRW1haWwoe1xuICAgICAgICAgICAgW2RvbWFpbk5hbWVdOiBgYWRtaW5AJHtyb290RG9tYWlufWAsXG4gICAgICAgICAgfSksXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIENsb3VkRnJvbnQgT0FDIGZvciBzZWN1cmUgUzMgYWNjZXNzIChyZXBsYWNpbmcgZGVwcmVjYXRlZCBPQUkpXG4gICAgY29uc3QgZnJvbnRlbmRPQUMgPSBuZXcgY2xvdWRmcm9udC5TM09yaWdpbkFjY2Vzc0NvbnRyb2wodGhpcywgJ0Zyb250ZW5kT0FDJywge1xuICAgICAgZGVzY3JpcHRpb246IGBPQUMgZm9yICR7ZW52aXJvbm1lbnR9IGZyb250ZW5kIGJ1Y2tldGAsXG4gICAgICBzaWduaW5nOiBjbG91ZGZyb250LlNpZ25pbmcuU0lHVjRfQUxXQVlTLFxuICAgIH0pXG5cbiAgICAvLyBOb3RlOiBCdWNrZXQgcG9saWN5IGZvciBPQUMgd2lsbCBiZSBhZGRlZCBhZnRlciBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBjcmVhdGlvblxuICAgIC8vIGJlY2F1c2Ugd2UgbmVlZCB0aGUgZGlzdHJpYnV0aW9uIElEXG5cbiAgICAvLyBOT1RFOiBMYW1iZGFARWRnZSByZW1vdmVkIGR1ZSB0byBwcm9kdWN0aW9uIGlzc3VlcyAoNDAzLzUwMiBlcnJvcnMpXG4gICAgLy8gVXNpbmcgQ2xvdWRGcm9udCBvcmlnaW4gcmVxdWVzdCByZXdyaXRpbmcgaW5zdGVhZCBmb3IgU1BBIHJvdXRpbmdcblxuICAgIC8vIEFQSSBEb21haW4gQ29uZmlndXJhdGlvbiAoYXBwLnBvc3RvbC5pbykgLSBkZWNsYXJlIGVhcmx5IGZvciBDbG91ZEZyb250XG4gICAgY29uc3QgYXBpRG9tYWluTmFtZSA9ICdhcHAucG9zdG9sLmlvJ1xuICAgIGNvbnN0IGFwaUhvc3RlZFpvbmUgPSByb3V0ZTUzLkhvc3RlZFpvbmUuZnJvbUhvc3RlZFpvbmVBdHRyaWJ1dGVzKHRoaXMsICdBcGlIb3N0ZWRab25lJywge1xuICAgICAgaG9zdGVkWm9uZUlkOiAnWjA2MjUzODAxSjZJOVpHMDUzVVNWJyxcbiAgICAgIHpvbmVOYW1lOiAncG9zdG9sLmlvJyxcbiAgICB9KVxuXG4gICAgLy8gU1NMIENlcnRpZmljYXRlIGZvciBBUEkgZG9tYWluIGFuZCBXZWJTb2NrZXQgc3ViZG9tYWluXG4gICAgY29uc3QgYXBpQ2VydGlmaWNhdGUgPSBuZXcgYWNtLkNlcnRpZmljYXRlKHRoaXMsICdBcGlDZXJ0aWZpY2F0ZScsIHtcbiAgICAgIGRvbWFpbk5hbWU6IGFwaURvbWFpbk5hbWUsXG4gICAgICBzdWJqZWN0QWx0ZXJuYXRpdmVOYW1lczogWyd3cy5wb3N0b2wuaW8nXSwgLy8gQWRkIFdlYlNvY2tldCBzdWJkb21haW5cbiAgICAgIHZhbGlkYXRpb246IGFjbS5DZXJ0aWZpY2F0ZVZhbGlkYXRpb24uZnJvbURucyhhcGlIb3N0ZWRab25lKSxcbiAgICB9KVxuXG4gICAgLy8gUGxhY2Vob2xkZXIgZm9yIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIC0gd2lsbCBiZSBjcmVhdGVkIGFmdGVyIEVDUyBzZXJ2aWNlXG5cbiAgICAvLyBJbmZyYXN0cnVjdHVyZSBzZWNyZXRzIC0gT25seSBDREstZ2VuZXJhdGVkIG9yIGluZnJhc3RydWN0dXJlLXNwZWNpZmljIHNlY3JldHNcbiAgICAvLyBVc2VyLXByb3ZpZGVkIHNlY3JldHMgKE9QRU5BSV9BUElfS0VZLCBldGMuKSBhcmUgbm93IHBhc3NlZCBhcyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZnJvbSBHaXRIdWIgU2VjcmV0c1xuICAgIGNvbnN0IGFwcFNlY3JldHMgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdBcHBTZWNyZXRzJywge1xuICAgICAgZGVzY3JpcHRpb246ICdQb3N0b2xpbyBpbmZyYXN0cnVjdHVyZSBzZWNyZXRzIChDREstZ2VuZXJhdGVkIG9ubHkpJyxcbiAgICAgIHNlY3JldE9iamVjdFZhbHVlOiB7XG4gICAgICAgIC8vIEF1dGhlbnRpY2F0aW9uIHNlY3JldHMgKENESy1nZW5lcmF0ZWQpXG4gICAgICAgIGp3dFNlY3JldDogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChcbiAgICAgICAgICBjZGsuRm4uc2VsZWN0KDIsIGNkay5Gbi5zcGxpdCgnLScsIGNkay5Gbi5zZWxlY3QoMiwgY2RrLkZuLnNwbGl0KCcvJywgY2RrLkF3cy5TVEFDS19JRCkpKSlcbiAgICAgICAgKSxcbiAgICAgICAgXG4gICAgICAgIC8vIE5PVEU6IFJlZGlzIGVuZHBvaW50IG1vdmVkIHRvIGVudmlyb25tZW50IHZhcmlhYmxlcyAoQVdTIGJlc3QgcHJhY3RpY2UpXG4gICAgICAgIC8vIE5vbi1zZW5zaXRpdmUgaW50ZXJuYWwgZW5kcG9pbnRzIHNob3VsZCB1c2UgZW52IHZhcnMgZm9yIGF1dG9tYXRpYyB1cGRhdGVzXG4gICAgICAgIFxuICAgICAgICAvLyBOT1RFOiBQdWJsaXNoZXIgbm93IHVzZXMgQVdTIElBTSBTaWdWNCBhdXRoZW50aWNhdGlvbiBpbnN0ZWFkIG9mIEFQSSBrZXlzXG4gICAgICAgIC8vIE5PVEU6IFVzZXItcHJvdmlkZWQgc2VjcmV0cyBtb3ZlZCB0byBlbnZpcm9ubWVudCB2YXJpYWJsZXM6XG4gICAgICAgIC8vIC0gb3BlbmFpQXBpS2V5IC0+IE9QRU5BSV9BUElfS0VZIChmcm9tIEdpdEh1YiBTZWNyZXRzKVxuICAgICAgICAvLyAtIGdvb2dsZUNsaWVudFNlY3JldCAtPiBHT09HTEVfQ0xJRU5UX1NFQ1JFVCAoZnJvbSBHaXRIdWIgU2VjcmV0cylcbiAgICAgICAgLy8gLSBmYWNlYm9va0FwcFNlY3JldCAtPiBGQUNFQk9PS19BUFBfU0VDUkVUIChmcm9tIEdpdEh1YiBTZWNyZXRzKVxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgLy8gRUNTIENsdXN0ZXJcbiAgICBjb25zdCBjbHVzdGVyID0gbmV3IGVjcy5DbHVzdGVyKHRoaXMsICdQb3N0b2xpb0NsdXN0ZXInLCB7XG4gICAgICB2cGMsXG4gICAgICAvLyBNaWdyYXRlIHRvIENvbnRhaW5lciBJbnNpZ2h0cyB2MiBwZXIgQ0RLIGRlcHJlY2F0aW9uXG4gICAgICBjb250YWluZXJJbnNpZ2h0c1YyOiBlY3MuQ29udGFpbmVySW5zaWdodHMuRU5BQkxFRCxcbiAgICB9KVxuXG4gICAgLy8gVGFzayByb2xlIHdpdGggcGVybWlzc2lvbnMgdG8gYWNjZXNzIHNlY3JldHMgYW5kIFMzXG4gICAgY29uc3QgdGFza1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1Rhc2tSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgfSlcblxuICAgIGRiU2VjcmV0LmdyYW50UmVhZCh0YXNrUm9sZSlcbiAgICBhcHBTZWNyZXRzLmdyYW50UmVhZCh0YXNrUm9sZSlcbiAgICBcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byB1cGxvYWQvZGVsZXRlIGltYWdlcyBpbiBTM1xuICAgIGltYWdlc0J1Y2tldC5ncmFudFJlYWRXcml0ZSh0YXNrUm9sZSlcbiAgICBcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byBjcmVhdGUgQ2xvdWRGcm9udCBpbnZhbGlkYXRpb25zXG4gICAgdGFza1JvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydjbG91ZGZyb250OkNyZWF0ZUludmFsaWRhdGlvbiddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSwgLy8gV2lsbCBiZSByZXN0cmljdGVkIHRvIHNwZWNpZmljIGRpc3RyaWJ1dGlvbiBhZnRlciBjcmVhdGlvblxuICAgIH0pKVxuICAgIFxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBBV1MgU0VTIGVtYWlsIHNlbmRpbmdcbiAgICB0YXNrUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzZXM6U2VuZEVtYWlsJyxcbiAgICAgICAgJ3NlczpTZW5kUmF3RW1haWwnLFxuICAgICAgICAnc2VzOkdldElkZW50aXR5VmVyaWZpY2F0aW9uQXR0cmlidXRlcycsXG4gICAgICAgICdzZXM6VmVyaWZ5RW1haWxJZGVudGl0eSdcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBTRVMgcmVzb3VyY2VzIGFyZSBnbG9iYWxcbiAgICB9KSlcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIGludm9rZSBUb2tlbiBTZXJ2aWNlIEFQSVxuICAgIHRhc2tSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2V4ZWN1dGUtYXBpOkludm9rZSdcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6ZXhlY3V0ZS1hcGk6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OiovKi9QT1NUL3Rva2Vuc2AsXG4gICAgICAgIGBhcm46YXdzOmV4ZWN1dGUtYXBpOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fToqLyovREVMRVRFL3Rva2Vuc2AsXG4gICAgICAgIGBhcm46YXdzOmV4ZWN1dGUtYXBpOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fToqLyovUE9TVC90b2tlbnMvcmVmcmVzaGAsXG4gICAgICAgIGBhcm46YXdzOmV4ZWN1dGUtYXBpOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fToqLyovR0VUL2hlYWx0aGBcbiAgICAgIF0sXG4gICAgfSkpXG4gICAgXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIFNlcnZpY2UgRGlzY292ZXJ5XG4gICAgdGFza1JvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnc2VydmljZWRpc2NvdmVyeTpEaXNjb3Zlckluc3RhbmNlcydcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBTZXJ2aWNlIGRpc2NvdmVyeSByZXF1aXJlcyB3aWxkY2FyZFxuICAgIH0pKVxuXG4gICAgLy8gQ3VzdG9tIHRhc2sgZXhlY3V0aW9uIHJvbGUgcG9saWN5XG4gICAgY29uc3QgdGFza0V4ZWN1dGlvblJvbGVQb2xpY3kgPSBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbicsXG4gICAgICAgICAgICAnZWNyOkJhdGNoQ2hlY2tMYXllckF2YWlsYWJpbGl0eScsXG4gICAgICAgICAgICAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLFxuICAgICAgICAgICAgJ2VjcjpCYXRjaEdldEltYWdlJyxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgIH0pLFxuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6bG9nczoqOio6KiddLFxuICAgICAgICB9KSxcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAnc2VjcmV0c21hbmFnZXI6R2V0U2VjcmV0VmFsdWUnLFxuICAgICAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkRlc2NyaWJlU2VjcmV0JyxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHJlc291cmNlczogW2RiU2VjcmV0LnNlY3JldEFybiwgYXBwU2VjcmV0cy5zZWNyZXRBcm5dLFxuICAgICAgICB9KSxcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICBhY3Rpb25zOiBbJ2lhbTpQYXNzUm9sZSddLFxuICAgICAgICAgIHJlc291cmNlczogW3Rhc2tSb2xlLnJvbGVBcm5dLFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgICAnaWFtOlBhc3NlZFRvU2VydmljZSc6ICdlY3MtdGFza3MuYW1hem9uYXdzLmNvbSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICBdLFxuICAgIH0pXG5cbiAgICBjb25zdCBleGVjdXRpb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdUYXNrRXhlY3V0aW9uUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgVGFza0V4ZWN1dGlvblJvbGVQb2xpY3k6IHRhc2tFeGVjdXRpb25Sb2xlUG9saWN5LFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgLy8gQUxCIEFjY2VzcyBMb2dzIGJ1Y2tldFxuICAgIGNvbnN0IGFsYkFjY2Vzc0xvZ3NCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdBbGJBY2Nlc3NMb2dzQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYHBvc3RvbGlvLWFsYi1sb2dzLSR7ZW52aXJvbm1lbnR9LSR7Y2RrLkF3cy5BQ0NPVU5UX0lEfWAsXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgIH0pXG5cbiAgICAvLyBBTEIgc2VydmljZSBhY2NvdW50IElEcyBmb3IgZGlmZmVyZW50IHJlZ2lvbnNcbiAgICBjb25zdCBhbGJBY2NvdW50SWRzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9ID0ge1xuICAgICAgJ3VzLWVhc3QtMSc6ICcxMjczMTE5MjMwMjEnLFxuICAgICAgJ3VzLWVhc3QtMic6ICcwMzM2Nzc5OTQyNDAnLFxuICAgICAgJ3VzLXdlc3QtMSc6ICcwMjc0MzQ3NDI5ODAnLFxuICAgICAgJ3VzLXdlc3QtMic6ICc3OTc4NzM5NDYxOTQnLFxuICAgICAgJ2V1LXdlc3QtMSc6ICcxNTY0NjA2MTI4MDYnLFxuICAgICAgJ2V1LXdlc3QtMic6ICc2NTI3MTE1MDQ0MTYnLFxuICAgICAgJ2V1LWNlbnRyYWwtMSc6ICcwNTQ2NzY4MjA5MjgnLFxuICAgICAgJ2FwLXNvdXRoZWFzdC0xJzogJzExNDc3NDEzMTQ1MCcsXG4gICAgICAnYXAtc291dGhlYXN0LTInOiAnNzgzMjI1MzE5MjY2JyxcbiAgICAgICdhcC1ub3J0aGVhc3QtMSc6ICc1ODIzMTg1NjA4NjQnLFxuICAgIH1cblxuICAgIC8vIEdyYW50IEFMQiBzZXJ2aWNlIHBlcm1pc3Npb24gdG8gd3JpdGUgbG9ncyB0byB0aGUgYnVja2V0XG4gICAgYWxiQWNjZXNzTG9nc0J1Y2tldC5hZGRUb1Jlc291cmNlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdBbGxvd0FMQkxvZ2dpbmcnLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIHByaW5jaXBhbHM6IFtuZXcgaWFtLkFjY291bnRQcmluY2lwYWwoYWxiQWNjb3VudElkc1tjZGsuQXdzLlJFR0lPTl0gfHwgJzEyNzMxMTkyMzAyMScpXSxcbiAgICAgICAgYWN0aW9uczogWydzMzpQdXRPYmplY3QnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYWxiQWNjZXNzTG9nc0J1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJyldLFxuICAgICAgfSlcbiAgICApXG5cbiAgICBhbGJBY2Nlc3NMb2dzQnVja2V0LmFkZFRvUmVzb3VyY2VQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0FsbG93QUxCTG9nRGVsaXZlcnknLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIHByaW5jaXBhbHM6IFtuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2RlbGl2ZXJ5LmxvZ3MuYW1hem9uYXdzLmNvbScpXSxcbiAgICAgICAgYWN0aW9uczogWydzMzpQdXRPYmplY3QnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYWxiQWNjZXNzTG9nc0J1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJyldLFxuICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAnczM6eC1hbXotYWNsJzogJ2J1Y2tldC1vd25lci1mdWxsLWNvbnRyb2wnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIClcblxuICAgIGFsYkFjY2Vzc0xvZ3NCdWNrZXQuYWRkVG9SZXNvdXJjZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnQWxsb3dBTEJMb2dEZWxpdmVyeUdldEJ1Y2tldEFjbCcsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgcHJpbmNpcGFsczogW25ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZGVsaXZlcnkubG9ncy5hbWF6b25hd3MuY29tJyldLFxuICAgICAgICBhY3Rpb25zOiBbJ3MzOkdldEJ1Y2tldEFjbCddLFxuICAgICAgICByZXNvdXJjZXM6IFthbGJBY2Nlc3NMb2dzQnVja2V0LmJ1Y2tldEFybl0sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb24gdG8gaW52b2tlIEFQSXMgZGlzY292ZXJlZCB2aWEgQ2xvdWQgTWFwXG4gICAgLy8gU2VydmljZXMgd2lsbCBkaXNjb3ZlciBlbmRwb2ludHMgYXQgcnVudGltZVxuICAgIHRhc2tSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnZXhlY3V0ZS1hcGk6SW52b2tlJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBBbGxvdyBpbnZva2luZyBhbnkgQVBJIEdhdGV3YXkgZGlzY292ZXJlZCB2aWEgQ2xvdWQgTWFwXG4gICAgfSkpXG4gICAgXG4gICAgLy8gR2V0IHRoZSBpbWFnZSB0YWcgZnJvbSBjb250ZXh0LCBkZWZhdWx0aW5nIHRvICdsYXRlc3QnIGlmIG5vdCBwcm92aWRlZFxuICAgIGNvbnN0IGltYWdlVGFnID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2ltYWdlVGFnJykgfHwgJ2xhdGVzdCdcbiAgICBcbiAgICAvLyBFQ1MgU2VydmljZSB3aXRoIEFwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXIgKENsb3VkRnJvbnQgZG9tYWluIHBhc3NlZCBhcyBlbnZpcm9ubWVudCB2YXJpYWJsZSlcbiAgICBjb25zdCBmYXJnYXRlU2VydmljZSA9IG5ldyBlY3NQYXR0ZXJucy5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlZEZhcmdhdGVTZXJ2aWNlKHRoaXMsICdQb3N0b2xpb1NlcnZpY2UnLCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgY3B1OiA1MTIsXG4gICAgICBtZW1vcnlMaW1pdE1pQjogMjA0OCwgLy8gSW5jcmVhc2VkIGZyb20gMTAyNCB0byBwcmV2ZW50IE9PTSBraWxsc1xuICAgICAgZGVzaXJlZENvdW50OiAxLFxuICAgICAgdGFza0ltYWdlT3B0aW9uczoge1xuICAgICAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21FY3JSZXBvc2l0b3J5KGVjclJlcG9zaXRvcnksIGltYWdlVGFnKSxcbiAgICAgICAgY29udGFpbmVyUG9ydDogMzAwMCxcbiAgICAgICAgZXhlY3V0aW9uUm9sZSxcbiAgICAgICAgdGFza1JvbGUsXG4gICAgICAgIHNlY3JldHM6IHtcbiAgICAgICAgICAvLyBEYXRhYmFzZSBjcmVkZW50aWFscyAoZnJvbSBBV1MgU2VjcmV0cyBNYW5hZ2VyKVxuICAgICAgICAgIERCX1VTRVJOQU1FOiBlY3MuU2VjcmV0LmZyb21TZWNyZXRzTWFuYWdlcihkYlNlY3JldCwgJ3VzZXJuYW1lJyksXG4gICAgICAgICAgREJfUEFTU1dPUkQ6IGVjcy5TZWNyZXQuZnJvbVNlY3JldHNNYW5hZ2VyKGRiU2VjcmV0LCAncGFzc3dvcmQnKSxcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBJbmZyYXN0cnVjdHVyZSBzZWNyZXRzIChmcm9tIEFXUyBTZWNyZXRzIE1hbmFnZXIpXG4gICAgICAgICAgSldUX1NFQ1JFVDogZWNzLlNlY3JldC5mcm9tU2VjcmV0c01hbmFnZXIoYXBwU2VjcmV0cywgJ2p3dFNlY3JldCcpLFxuICAgICAgICB9LFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIC8vIERhdGFiYXNlIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgICBEQl9IT1NUOiBkYXRhYmFzZS5pbnN0YW5jZUVuZHBvaW50Lmhvc3RuYW1lLFxuICAgICAgICAgIERCX1BPUlQ6IGRhdGFiYXNlLmluc3RhbmNlRW5kcG9pbnQucG9ydC50b1N0cmluZygpLFxuICAgICAgICAgIERCX05BTUU6ICdwb3N0b2xpbycsXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gUmVkaXMgY29uZmlndXJhdGlvbiAoQVdTIGJlc3QgcHJhY3RpY2U6IHVzZSBlbnYgdmFycyBmb3Igbm9uLXNlbnNpdGl2ZSBlbmRwb2ludHMpXG4gICAgICAgICAgUkVESVNfSE9TVDogcmVkaXMuYXR0clJlZGlzRW5kcG9pbnRBZGRyZXNzLFxuICAgICAgICAgIFJFRElTX1BPUlQ6ICc2MzgwJyxcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBVc2VyLXByb3ZpZGVkIHNlY3JldHMgKGZyb20gR2l0SHViIFNlY3JldHMgdmlhIENESyBjb250ZXh0KVxuICAgICAgICAgIE9QRU5BSV9BUElfS0VZOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnb3BlbmFpQXBpS2V5JykgfHwgcHJvY2Vzcy5lbnYuT1BFTkFJX0FQSV9LRVkgfHwgJycsXG4gICAgICAgICAgR09PR0xFX0NMSUVOVF9TRUNSRVQ6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdnb29nbGVDbGllbnRTZWNyZXQnKSB8fCBwcm9jZXNzLmVudi5HT09HTEVfQ0xJRU5UX1NFQ1JFVCB8fCAnJyxcbiAgICAgICAgICBGQUNFQk9PS19BUFBfU0VDUkVUOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZmFjZWJvb2tBcHBTZWNyZXQnKSB8fCBwcm9jZXNzLmVudi5GQUNFQk9PS19BUFBfU0VDUkVUIHx8ICcnLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIE9BdXRoIENsaWVudCBJRHMgKHB1YmxpYyB2YWx1ZXMgZnJvbSBHaXRIdWIgRW52aXJvbm1lbnQgVmFyaWFibGVzIHZpYSBDREsgY29udGV4dClcbiAgICAgICAgICBHT09HTEVfQ0xJRU5UX0lEOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZ29vZ2xlQ2xpZW50SWQnKSB8fCBwcm9jZXNzLmVudi5HT09HTEVfQ0xJRU5UX0lEIHx8ICcnLFxuICAgICAgICAgIEZBQ0VCT09LX0FQUF9JRDogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2ZhY2Vib29rQXBwSWQnKSB8fCBwcm9jZXNzLmVudi5GQUNFQk9PS19BUFBfSUQgfHwgJycsXG4gICAgICAgICAgSU5TVEFHUkFNX0FQUF9JRDogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2luc3RhZ3JhbUFwcElkJykgfHwgcHJvY2Vzcy5lbnYuSU5TVEFHUkFNX0FQUF9JRCB8fCAnJyxcbiAgICAgICAgICBMSU5LRURJTl9DTElFTlRfSUQ6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdsaW5rZWRpbkNsaWVudElkJykgfHwgcHJvY2Vzcy5lbnYuTElOS0VESU5fQ0xJRU5UX0lEIHx8ICcnLFxuICAgICAgICAgIFRJS1RPS19DTElFTlRfS0VZOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgndGlrdG9rQ2xpZW50S2V5JykgfHwgcHJvY2Vzcy5lbnYuVElLVE9LX0NMSUVOVF9LRVkgfHwgJycsXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gVVJMcyBhbmQgZG9tYWluc1xuICAgICAgICAgIENPUlNfT1JJR0lOOiBhcGlEb21haW5OYW1lLCAvLyBVc2UgdW5pZmllZCBkb21haW4gaW5zdGVhZCBvZiBDbG91ZEZyb250IGRvbWFpblxuICAgICAgICAgIEZST05URU5EX1VSTDogYGh0dHBzOi8vJHthcGlEb21haW5OYW1lfWAsIC8vIENyaXRpY2FsOiBTZXQgZnJvbnRlbmQgVVJMIGZvciBlbWFpbHNcbiAgICAgICAgICBJTlNUQUdSQU1fUkVESVJFQ1RfVVJJOiBgaHR0cHM6Ly8ke2FwaURvbWFpbk5hbWV9L2FwaS9hdXRoL2luc3RhZ3JhbS9jYWxsYmFja2AsXG4gICAgICAgICAgR09PR0xFX1JFRElSRUNUX1VSSTogYGh0dHBzOi8vJHthcGlEb21haW5OYW1lfS9hcGkvYXV0aC9nb29nbGUvY2FsbGJhY2tgLFxuICAgICAgICAgIEZBQ0VCT09LX1JFRElSRUNUX1VSSTogYGh0dHBzOi8vJHthcGlEb21haW5OYW1lfS9hcGkvYXV0aC9mYWNlYm9vay9jYWxsYmFja2AsXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gQVdTIHJlc291cmNlc1xuICAgICAgICAgIFMzX0lNQUdFU19CVUNLRVQ6IGltYWdlc0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICAgIEFXU19SRUdJT046IGNkay5Bd3MuUkVHSU9OLFxuICAgICAgICAgIENMT1VERlJPTlRfRE9NQUlOOiBhcGlEb21haW5OYW1lLCAvLyBXaWxsIGJlIHVwZGF0ZWQgYWZ0ZXIgZGlzdHJpYnV0aW9uIGNyZWF0aW9uXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gU2VydmljZSBlbmRwb2ludHMgKGRpc2NvdmVyZWQgdmlhIENsb3VkIE1hcCBhdCBydW50aW1lKVxuICAgICAgICAgIFNDSEVEVUxFUl9BUElfU1RBR0U6IGVudmlyb25tZW50LFxuICAgICAgICAgIFdTX0RPTUFJTjogJ3dzLnBvc3RvbC5pbycsIC8vIFdlYlNvY2tldCBzdWJkb21haW5cbiAgICAgICAgICBcbiAgICAgICAgICAvLyBTZXJ2aWNlIERpc2NvdmVyeSBDb25maWd1cmF0aW9uXG4gICAgICAgICAgLi4uZ2V0U2VydmljZURpc2NvdmVyeUVudlZhcnMoc2VydmljZURpc2NvdmVyeS5nZXRDbGllbnRDb25maWcoKSksXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gQVdTIFNFUyBjb25maWd1cmF0aW9uXG4gICAgICAgICAgVVNFX0FXU19TRVM6ICd0cnVlJywgLy8gVXNlIFNFUyBpbiBwcm9kdWN0aW9uXG4gICAgICAgICAgU0VTX0ZST01fRU1BSUw6ICdub3JlcGx5QHBvc3RvbC5pbycsIC8vIFVzZSBjb25zaXN0ZW50IHNlbmRlciBhZGRyZXNzXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gRW52aXJvbm1lbnQgY29uZmlndXJhdGlvbiAoZnJvbSBHaXRIdWIgRW52aXJvbm1lbnQgVmFyaWFibGVzIHZpYSBjb250ZXh0KVxuICAgICAgICAgIE5PREVfRU5WOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbm9kZUVudicpIHx8IChlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gJ3Byb2R1Y3Rpb24nIDogZW52aXJvbm1lbnQpLFxuICAgICAgICAgIFBPUlQ6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdwb3J0JykgfHwgJzMwMDAnLFxuICAgICAgICAgIExPR19MRVZFTDogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2xvZ0xldmVsJykgfHwgJ2luZm8nLFxuICAgICAgICAgIEVOQUJMRV9NT05JVE9SSU5HOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZW5hYmxlTW9uaXRvcmluZycpIHx8ICdmYWxzZScsXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ0RyaXZlcjogZWNzLkxvZ0RyaXZlcnMuYXdzTG9ncyh7XG4gICAgICAgICAgc3RyZWFtUHJlZml4OiAncG9zdG9saW8nLFxuICAgICAgICAgIGxvZ0dyb3VwOiBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnQXBwTG9nR3JvdXAnLCB7XG4gICAgICAgICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgfSksXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICAgIHB1YmxpY0xvYWRCYWxhbmNlcjogdHJ1ZSxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbZWNzU2VjdXJpdHlHcm91cF0sXG4gICAgfSlcblxuICAgIC8vIEFkZCBIVFRQUyBsaXN0ZW5lciB3aXRoIFNTTCBjZXJ0aWZpY2F0ZVxuICAgIGZhcmdhdGVTZXJ2aWNlLmxvYWRCYWxhbmNlci5hZGRMaXN0ZW5lcignSHR0cHNMaXN0ZW5lcicsIHtcbiAgICAgIHBvcnQ6IDQ0MyxcbiAgICAgIHByb3RvY29sOiBlbGJ2Mi5BcHBsaWNhdGlvblByb3RvY29sLkhUVFBTLFxuICAgICAgY2VydGlmaWNhdGVzOiBbYXBpQ2VydGlmaWNhdGVdLFxuICAgICAgZGVmYXVsdFRhcmdldEdyb3VwczogW2ZhcmdhdGVTZXJ2aWNlLnRhcmdldEdyb3VwXSxcbiAgICB9KVxuXG4gICAgLy8gUmVkaXJlY3QgSFRUUCB0byBIVFRQUyBmb3Igc2VjdXJpdHlcbiAgICBmYXJnYXRlU2VydmljZS5saXN0ZW5lci5hZGRBY3Rpb24oJ1JlZGlyZWN0VG9IdHRwcycsIHtcbiAgICAgIGFjdGlvbjogZWxidjIuTGlzdGVuZXJBY3Rpb24ucmVkaXJlY3Qoe1xuICAgICAgICBwcm90b2NvbDogJ0hUVFBTJyxcbiAgICAgICAgcG9ydDogJzQ0MycsXG4gICAgICAgIHBlcm1hbmVudDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgIH0pXG5cbiAgICAvLyBOb3RlOiBETlMgcmVjb3JkIGZvciBhcHAucG9zdG9sLmlvIG5vdyBwb2ludHMgdG8gQ2xvdWRGcm9udCAoY3JlYXRlZCBhYm92ZSkgaW5zdGVhZCBvZiBBTEIgZGlyZWN0bHlcblxuICAgIC8vIEVuYWJsZSBBTEIgYWNjZXNzIGxvZ3NcbiAgICBmYXJnYXRlU2VydmljZS5sb2FkQmFsYW5jZXIuc2V0QXR0cmlidXRlKCdhY2Nlc3NfbG9ncy5zMy5lbmFibGVkJywgJ3RydWUnKVxuICAgIGZhcmdhdGVTZXJ2aWNlLmxvYWRCYWxhbmNlci5zZXRBdHRyaWJ1dGUoJ2FjY2Vzc19sb2dzLnMzLmJ1Y2tldCcsIGFsYkFjY2Vzc0xvZ3NCdWNrZXQuYnVja2V0TmFtZSlcblxuICAgIC8vIEhlYWx0aCBjaGVjayBjb25maWd1cmF0aW9uIHdpdGggcHJvcGVyIHRpbWVvdXRzXG4gICAgZmFyZ2F0ZVNlcnZpY2UudGFyZ2V0R3JvdXAuY29uZmlndXJlSGVhbHRoQ2hlY2soe1xuICAgICAgcGF0aDogJy9oZWFsdGgnLFxuICAgICAgaGVhbHRoeUh0dHBDb2RlczogJzIwMCcsXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLCAvLyBJbmNyZWFzZWQgZnJvbSBkZWZhdWx0IDVzXG4gICAgICBoZWFsdGh5VGhyZXNob2xkQ291bnQ6IDIsIC8vIFJlZHVjZWQgZnJvbSA1IHRvIHNwZWVkIHVwIGhlYWx0aHkgc3RhdHVzXG4gICAgICB1bmhlYWx0aHlUaHJlc2hvbGRDb3VudDogMywgLy8gSW5jcmVhc2VkIGZyb20gMiB0byBiZSBtb3JlIHRvbGVyYW50XG4gICAgfSlcbiAgICBcbiAgICAvLyBFbmFibGUgV2ViU29ja2V0IHN1cHBvcnQgb24gdGFyZ2V0IGdyb3VwXG4gICAgLy8gV2ViU29ja2V0IGNvbm5lY3Rpb25zIHJlcXVpcmUgc3RpY2tpbmVzcyBmb3IgcHJvcGVyIHNlc3Npb24gaGFuZGxpbmdcbiAgICBmYXJnYXRlU2VydmljZS50YXJnZXRHcm91cC5lbmFibGVDb29raWVTdGlja2luZXNzKGNkay5EdXJhdGlvbi5ob3VycygxKSlcblxuICAgIC8vIENvbmZpZ3VyZSBFQ1Mgc2VydmljZSBkZXBsb3ltZW50IHNldHRpbmdzXG4gICAgY29uc3QgY2ZuU2VydmljZUNvbmZpZyA9IGZhcmdhdGVTZXJ2aWNlLnNlcnZpY2Uubm9kZS5kZWZhdWx0Q2hpbGQgYXMgZWNzLkNmblNlcnZpY2VcbiAgICBjZm5TZXJ2aWNlQ29uZmlnLmRlcGxveW1lbnRDb25maWd1cmF0aW9uID0ge1xuICAgICAgbWF4aW11bVBlcmNlbnQ6IDIwMCxcbiAgICAgIG1pbmltdW1IZWFsdGh5UGVyY2VudDogMTAwLCAvLyBFbnN1cmUgemVyby1kb3dudGltZSBkZXBsb3ltZW50c1xuICAgIH1cbiAgICBcbiAgICAvLyBDUklUSUNBTDogU2V0IGhlYWx0aCBjaGVjayBncmFjZSBwZXJpb2QgdG8gYWxsb3cgY29udGFpbmVyIHRvIHN0YXJ0XG4gICAgY2ZuU2VydmljZUNvbmZpZy5oZWFsdGhDaGVja0dyYWNlUGVyaW9kU2Vjb25kcyA9IDMwMCAvLyA1IG1pbnV0ZXMgZ3JhY2UgcGVyaW9kXG5cbiAgICAvLyBSZWdpc3RlciBtYWluIGFwcCB3aXRoIHNlcnZpY2UgZGlzY292ZXJ5XG4gICAgY29uc3QgbWFpbkFwcFNlcnZpY2UgPSBzZXJ2aWNlRGlzY292ZXJ5LnJlZ2lzdGVyU2VydmljZSgnbWFpbi1hcHAnLCB7XG4gICAgICBjdXN0b21BdHRyaWJ1dGVzOiB7XG4gICAgICAgIHVybDogYGh0dHBzOi8vJHthcGlEb21haW5OYW1lfS9hcGlgLFxuICAgICAgICB0eXBlOiAnZWNzJyxcbiAgICAgICAgZW52aXJvbm1lbnQsXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICAvLyBBc3NvY2lhdGUgRUNTIHNlcnZpY2Ugd2l0aCBDbG91ZCBNYXAgc2VydmljZVxuICAgIGZhcmdhdGVTZXJ2aWNlLnNlcnZpY2UuYXNzb2NpYXRlQ2xvdWRNYXBTZXJ2aWNlKHtcbiAgICAgIHNlcnZpY2U6IG1haW5BcHBTZXJ2aWNlLFxuICAgIH0pXG5cbiAgICAvLyBBdXRvIFNjYWxpbmdcbiAgICBjb25zdCBzY2FsYWJsZVRhcmdldCA9IGZhcmdhdGVTZXJ2aWNlLnNlcnZpY2UuYXV0b1NjYWxlVGFza0NvdW50KHtcbiAgICAgIG1pbkNhcGFjaXR5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gMSA6IDEsXG4gICAgICBtYXhDYXBhY2l0eTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IDEwIDogMixcbiAgICB9KVxuXG4gICAgc2NhbGFibGVUYXJnZXQuc2NhbGVPbkNwdVV0aWxpemF0aW9uKCdDcHVTY2FsaW5nJywge1xuICAgICAgdGFyZ2V0VXRpbGl6YXRpb25QZXJjZW50OiA3MCxcbiAgICB9KVxuXG4gICAgc2NhbGFibGVUYXJnZXQuc2NhbGVPbk1lbW9yeVV0aWxpemF0aW9uKCdNZW1vcnlTY2FsaW5nJywge1xuICAgICAgdGFyZ2V0VXRpbGl6YXRpb25QZXJjZW50OiA4MCxcbiAgICB9KVxuXG4gICAgLy8gQ3JlYXRlIE9BQyBmb3IgaW1hZ2VzIGJ1Y2tldCAocmVwbGFjaW5nIGRlcHJlY2F0ZWQgT0FJKVxuICAgIGNvbnN0IGltYWdlc09BQyA9IG5ldyBjbG91ZGZyb250LlMzT3JpZ2luQWNjZXNzQ29udHJvbCh0aGlzLCAnSW1hZ2VzT0FDJywge1xuICAgICAgZGVzY3JpcHRpb246IGBPQUMgZm9yICR7ZW52aXJvbm1lbnR9IGltYWdlcyBidWNrZXRgLFxuICAgICAgc2lnbmluZzogY2xvdWRmcm9udC5TaWduaW5nLlNJR1Y0X0FMV0FZUyxcbiAgICB9KVxuXG4gICAgLy8gTm90ZTogQnVja2V0IHBvbGljeSBmb3IgT0FDIHdpbGwgYmUgYWRkZWQgYWZ0ZXIgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gY3JlYXRpb25cblxuICAgIC8vIENsb3VkRnJvbnQgRGlzdHJpYnV0aW9uIHdpdGggbXVsdGlwbGUgb3JpZ2lucyBmb3Igc2FtZS1kb21haW4gYXJjaGl0ZWN0dXJlXG4gICAgY29uc3QgZGlzdHJpYnV0aW9uUHJvcHM6IGFueSA9IHtcbiAgICAgIC8vIERlZmF1bHQgYmVoYXZpb3IgLSBzZXJ2ZXMgZnJvbnRlbmQgZnJvbSBTM1xuICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XG4gICAgICAgIG9yaWdpbjogb3JpZ2lucy5TM0J1Y2tldE9yaWdpbi53aXRoT3JpZ2luQWNjZXNzQ29udHJvbChmcm9udGVuZEJ1Y2tldCwge1xuICAgICAgICAgIG9yaWdpbkFjY2Vzc0NvbnRyb2w6IGZyb250ZW5kT0FDLFxuICAgICAgICB9KSxcbiAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfT1BUSU1JWkVELFxuICAgICAgICBjb21wcmVzczogdHJ1ZSxcbiAgICAgICAgLy8gTm90ZTogRXJyb3IgcmVzcG9uc2VzIGZvciBTUEEgcm91dGluZyBzaG91bGQgYmUgaGFuZGxlZCBoZXJlIGlmIG5lZWRlZCxcbiAgICAgICAgLy8gYnV0IENsb3VkRnJvbnQgZG9lc24ndCBzdXBwb3J0IGJlaGF2aW9yLXNwZWNpZmljIGVycm9yIHJlc3BvbnNlcy5cbiAgICAgICAgLy8gVGhlIFJlYWN0IGFwcCB3aWxsIGhhbmRsZSByb3V0aW5nIG9uIHRoZSBjbGllbnQgc2lkZS5cbiAgICAgIH0sXG4gICAgICAvLyBBZGRpdGlvbmFsIGJlaGF2aW9ycyBmb3IgQVBJIHJvdXRpbmcgYW5kIGltYWdlIHNlcnZpbmdcbiAgICAgIGFkZGl0aW9uYWxCZWhhdmlvcnM6IHtcbiAgICAgICAgJy9hcGkvKic6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLkxvYWRCYWxhbmNlclYyT3JpZ2luKGZhcmdhdGVTZXJ2aWNlLmxvYWRCYWxhbmNlciwge1xuICAgICAgICAgICAgcHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUHJvdG9jb2xQb2xpY3kuSFRUUFNfT05MWSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsIC8vIEVuYWJsZSBQT1NULCBQVVQsIERFTEVURVxuICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfRElTQUJMRUQsXG4gICAgICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkFMTF9WSUVXRVIsXG4gICAgICAgICAgY29tcHJlc3M6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICAnL2ltYWdlcy8qJzoge1xuICAgICAgICAgIG9yaWdpbjogb3JpZ2lucy5TM0J1Y2tldE9yaWdpbi53aXRoT3JpZ2luQWNjZXNzQ29udHJvbChpbWFnZXNCdWNrZXQsIHtcbiAgICAgICAgICAgIG9yaWdpbkFjY2Vzc0NvbnRyb2w6IGltYWdlc09BQyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX09QVElNSVpFRCxcbiAgICAgICAgICBjb21wcmVzczogdHJ1ZSxcbiAgICAgICAgICByZXNwb25zZUhlYWRlcnNQb2xpY3k6IG5ldyBjbG91ZGZyb250LlJlc3BvbnNlSGVhZGVyc1BvbGljeSh0aGlzLCAnSW1hZ2VzUmVzcG9uc2VIZWFkZXJzUG9saWN5Jywge1xuICAgICAgICAgICAgY29yc0JlaGF2aW9yOiB7XG4gICAgICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd09yaWdpbnM6IFsnKiddLFxuICAgICAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dIZWFkZXJzOiBbJyonXSxcbiAgICAgICAgICAgICAgYWNjZXNzQ29udHJvbEFsbG93TWV0aG9kczogWydHRVQnLCAnSEVBRCddLFxuICAgICAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dDcmVkZW50aWFsczogZmFsc2UsXG4gICAgICAgICAgICAgIGFjY2Vzc0NvbnRyb2xNYXhBZ2U6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICAgICAgb3JpZ2luT3ZlcnJpZGU6IGZhbHNlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICAvLyBVc2UgYXBwLnBvc3RvbC5pbyBhcyB0aGUgY3VzdG9tIGRvbWFpblxuICAgICAgZG9tYWluTmFtZXM6IFsnYXBwLnBvc3RvbC5pbyddLFxuICAgICAgY2VydGlmaWNhdGU6IGFwaUNlcnRpZmljYXRlLFxuICAgICAgZGVmYXVsdFJvb3RPYmplY3Q6ICdpbmRleC5odG1sJyxcbiAgICAgIG1pbmltdW1Qcm90b2NvbFZlcnNpb246IGNsb3VkZnJvbnQuU2VjdXJpdHlQb2xpY3lQcm90b2NvbC5UTFNfVjFfMl8yMDIxLFxuICAgICAgZW5hYmxlTG9nZ2luZzogdHJ1ZSxcbiAgICAgIGxvZ0J1Y2tldDogYWNjZXNzTG9nc0J1Y2tldCxcbiAgICAgIGxvZ0ZpbGVQcmVmaXg6ICdjbG91ZGZyb250LWxvZ3MvJyxcbiAgICAgIC8vIElNUE9SVEFOVDogU2VsZWN0aXZlIGVycm9yIHJlc3BvbnNlIGNvbmZpZ3VyYXRpb25cbiAgICAgIC8vIE9ubHkgaGFuZGxlIDQwMyBlcnJvcnMgKFMzIGFjY2VzcyBkZW5pZWQgZm9yIG5vbi1leGlzdGVudCBvYmplY3RzKVxuICAgICAgLy8gVGhpcyBlbmFibGVzIFNQQSByb3V0aW5nIHdoaWxlIHByZXNlcnZpbmcgQVBJIGVycm9yIHJlc3BvbnNlc1xuICAgICAgZXJyb3JSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGh0dHBTdGF0dXM6IDQwMyxcbiAgICAgICAgICByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCxcbiAgICAgICAgICByZXNwb25zZVBhZ2VQYXRoOiAnL2luZGV4Lmh0bWwnLFxuICAgICAgICAgIHR0bDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgLy8gTm90ZTogV2UgZXhwbGljaXRseSBETyBOT1QgaGFuZGxlIDQwNCwgNTAwLCBvciBvdGhlciBzdGF0dXMgY29kZXNcbiAgICAgIC8vIHRvIGVuc3VyZSBBUEkgZXJyb3JzIHBhc3MgdGhyb3VnaCB3aXRoIHRoZWlyIG9yaWdpbmFsIHJlc3BvbnNlIGJvZGllc1xuICAgIH1cblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IG5ldyBjbG91ZGZyb250LkRpc3RyaWJ1dGlvbih0aGlzLCAnRnJvbnRlbmREaXN0cmlidXRpb24nLCBkaXN0cmlidXRpb25Qcm9wcylcbiAgICBcbiAgICAvLyBBZGQgYnVja2V0IHBvbGljaWVzIGZvciBPQUMgYWZ0ZXIgZGlzdHJpYnV0aW9uIGNyZWF0aW9uXG4gICAgLy8gRnJvbnRlbmQgYnVja2V0IHBvbGljeSBmb3IgT0FDXG4gICAgZnJvbnRlbmRCdWNrZXQuYWRkVG9SZXNvdXJjZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnQWxsb3dDbG91ZEZyb250U2VydmljZVByaW5jaXBhbFJlYWRPbmx5JyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBwcmluY2lwYWxzOiBbbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdjbG91ZGZyb250LmFtYXpvbmF3cy5jb20nKV0sXG4gICAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0J10sXG4gICAgICAgIHJlc291cmNlczogW2Zyb250ZW5kQnVja2V0LmFybkZvck9iamVjdHMoJyonKV0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICdBV1M6U291cmNlQXJuJzogYGFybjphd3M6Y2xvdWRmcm9udDo6JHt0aGlzLmFjY291bnR9OmRpc3RyaWJ1dGlvbi8ke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25JZH1gLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgIClcbiAgICBcbiAgICAvLyBJbWFnZXMgYnVja2V0IHBvbGljeSBmb3IgT0FDXG4gICAgaW1hZ2VzQnVja2V0LmFkZFRvUmVzb3VyY2VQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0FsbG93Q2xvdWRGcm9udFNlcnZpY2VQcmluY2lwYWxSZWFkT25seScsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgcHJpbmNpcGFsczogW25ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnY2xvdWRmcm9udC5hbWF6b25hd3MuY29tJyldLFxuICAgICAgICBhY3Rpb25zOiBbJ3MzOkdldE9iamVjdCddLFxuICAgICAgICByZXNvdXJjZXM6IFtpbWFnZXNCdWNrZXQuYXJuRm9yT2JqZWN0cygnKicpXSxcbiAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgJ0FXUzpTb3VyY2VBcm4nOiBgYXJuOmF3czpjbG91ZGZyb250Ojoke3RoaXMuYWNjb3VudH06ZGlzdHJpYnV0aW9uLyR7ZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbklkfWAsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pXG4gICAgKVxuICAgIFxuICAgIC8vIEFkZCBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBJRCBhbmQgQUxCIGRvbWFpbiB0byBFQ1MgdGFzayBlbnZpcm9ubWVudFxuICAgIC8vIFdlIG5lZWQgdG8gdXBkYXRlIHRoZSBjb250YWluZXIgZGVmaW5pdGlvbiBhZnRlciBpdCdzIGNyZWF0ZWRcbiAgICBmYXJnYXRlU2VydmljZS50YXNrRGVmaW5pdGlvbi5kZWZhdWx0Q29udGFpbmVyPy5hZGRFbnZpcm9ubWVudChcbiAgICAgICdDTE9VREZST05UX0RJU1RSSUJVVElPTl9JRCcsXG4gICAgICBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uSWRcbiAgICApXG4gICAgXG5cbiAgICAvLyBVcGRhdGUgZXhpc3RpbmcgRE5TIHJlY29yZCBmb3IgYXBwLnBvc3RvbC5pbyB0byBwb2ludCB0byBDbG91ZEZyb250ICh1bmlmaWVkIGRvbWFpbilcbiAgICAvLyBOb3RlOiBXZSByZXVzZSB0aGUgZXhpc3RpbmcgQXBpRG9tYWluUmVjb3JkIGxvZ2ljYWwgSUQgdG8gdXBkYXRlIHRoZSBleGlzdGluZyByZWNvcmRcbiAgICBuZXcgcm91dGU1My5BUmVjb3JkKHRoaXMsICdBcGlEb21haW5SZWNvcmQnLCB7XG4gICAgICB6b25lOiBhcGlIb3N0ZWRab25lLFxuICAgICAgcmVjb3JkTmFtZTogYXBpRG9tYWluTmFtZSxcbiAgICAgIHRhcmdldDogcm91dGU1My5SZWNvcmRUYXJnZXQuZnJvbUFsaWFzKG5ldyByb3V0ZTUzVGFyZ2V0cy5DbG91ZEZyb250VGFyZ2V0KGRpc3RyaWJ1dGlvbikpLFxuICAgIH0pXG5cbiAgICAvLyBDcmVhdGUgRE5TIHJlY29yZCBmb3IgY3VzdG9tIGRvbWFpbiAob25seSBpZiB1c2luZyBSb3V0ZSA1MyBhbmQgZGlmZmVyZW50IGZyb20gQVBJIGRvbWFpbilcbiAgICBpZiAoZG9tYWluTmFtZSAmJiBob3N0ZWRab25lICYmICF1c2VFeHRlcm5hbERucyAmJiBkb21haW5OYW1lICE9PSBhcGlEb21haW5OYW1lKSB7XG4gICAgICBuZXcgcm91dGU1My5BUmVjb3JkKHRoaXMsICdEb21haW5BUmVjb3JkJywge1xuICAgICAgICB6b25lOiBob3N0ZWRab25lLFxuICAgICAgICByZWNvcmROYW1lOiBkb21haW5OYW1lLFxuICAgICAgICB0YXJnZXQ6IHJvdXRlNTMuUmVjb3JkVGFyZ2V0LmZyb21BbGlhcyhuZXcgcm91dGU1M1RhcmdldHMuQ2xvdWRGcm9udFRhcmdldChkaXN0cmlidXRpb24pKSxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIFJvdXRlNTMgcmVjb3JkIGZvciBXZWJTb2NrZXQgc3ViZG9tYWluIHBvaW50aW5nIGRpcmVjdGx5IHRvIEFMQlxuICAgIG5ldyByb3V0ZTUzLkFSZWNvcmQodGhpcywgJ1dlYlNvY2tldERuc1JlY29yZCcsIHtcbiAgICAgIHpvbmU6IGFwaUhvc3RlZFpvbmUsXG4gICAgICByZWNvcmROYW1lOiAnd3MnLFxuICAgICAgdGFyZ2V0OiByb3V0ZTUzLlJlY29yZFRhcmdldC5mcm9tQWxpYXMoXG4gICAgICAgIG5ldyByb3V0ZTUzVGFyZ2V0cy5Mb2FkQmFsYW5jZXJUYXJnZXQoZmFyZ2F0ZVNlcnZpY2UubG9hZEJhbGFuY2VyKVxuICAgICAgKSxcbiAgICAgIGNvbW1lbnQ6ICdXZWJTb2NrZXQgc3ViZG9tYWluIHBvaW50aW5nIGRpcmVjdGx5IHRvIEFMQiAoYnlwYXNzZXMgQ2xvdWRGcm9udCknLFxuICAgIH0pXG5cbiAgICAvLyBPdXRwdXQgQUxCIEROUyBmb3IgV2ViU29ja2V0IGNvbm5lY3Rpb25zXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FMQkRvbWFpbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogZmFyZ2F0ZVNlcnZpY2UubG9hZEJhbGFuY2VyLmxvYWRCYWxhbmNlckRuc05hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXIgRE5TIG5hbWUgZm9yIFdlYlNvY2tldCBjb25uZWN0aW9ucycsXG4gICAgICBleHBvcnROYW1lOiBgcG9zdG9saW8tJHtlbnZpcm9ubWVudH0tYWxiLWRuc2AsXG4gICAgfSlcbiAgICBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnV2ViU29ja2V0RG9tYWluJywge1xuICAgICAgdmFsdWU6ICd3cy5wb3N0b2wuaW8nLFxuICAgICAgZGVzY3JpcHRpb246ICdXZWJTb2NrZXQgZG9tYWluIGZvciBkaXJlY3QgQUxCIGNvbm5lY3Rpb25zJyxcbiAgICB9KVxuICAgIFxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRUNSUmVwb3NpdG9yeScsIHtcbiAgICAgIHZhbHVlOiBlY3JSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUiBSZXBvc2l0b3J5IFVSSSBmb3IgYmFja2VuZCBjb250YWluZXIgaW1hZ2VzJyxcbiAgICB9KVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xvYWRCYWxhbmNlckROUycsIHtcbiAgICAgIHZhbHVlOiBmYXJnYXRlU2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTG9hZCBCYWxhbmNlciBETlMgbmFtZScsXG4gICAgfSlcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdGcm9udGVuZERpc3RyaWJ1dGlvbkRvbWFpbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Zyb250ZW5kIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIGRvbWFpbiBuYW1lJyxcbiAgICB9KVxuXG4gICAgaWYgKGRvbWFpbk5hbWUpIHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDdXN0b21Eb21haW5OYW1lJywge1xuICAgICAgICB2YWx1ZTogZG9tYWluTmFtZSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdDdXN0b20gZG9tYWluIG5hbWUgZm9yIHRoZSBhcHBsaWNhdGlvbicsXG4gICAgICB9KVxuICAgIH1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcHBsaWNhdGlvblVSTCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2FwaURvbWFpbk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVW5pZmllZCBhcHBsaWNhdGlvbiBVUkwgKGZyb250ZW5kICsgQVBJKScsXG4gICAgfSlcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdGcm9udGVuZEJ1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogZnJvbnRlbmRCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRnJvbnRlbmQgUzMgYnVja2V0IG5hbWUnLFxuICAgIH0pXG4gICAgXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ltYWdlc0J1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogaW1hZ2VzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FJIEltYWdlcyBTMyBidWNrZXQgbmFtZScsXG4gICAgfSlcbiAgICBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2xvdWRGcm9udERpc3RyaWJ1dGlvbklkJywge1xuICAgICAgdmFsdWU6IGRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25JZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gSUQgZm9yIGNhY2hlIGludmFsaWRhdGlvbicsXG4gICAgfSlcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEZXBsb3llZEltYWdlVGFnJywge1xuICAgICAgdmFsdWU6IGltYWdlVGFnLFxuICAgICAgZGVzY3JpcHRpb246ICdEb2NrZXIgaW1hZ2UgdGFnIHVzZWQgZm9yIHRoaXMgZGVwbG95bWVudCcsXG4gICAgfSlcbiAgICBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRWNzQ2x1c3Rlck5hbWUnLCB7XG4gICAgICB2YWx1ZTogY2x1c3Rlci5jbHVzdGVyTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNTIENsdXN0ZXIgbmFtZSBmb3IgZGVwbG95bWVudHMnLFxuICAgIH0pXG4gICAgXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Vjc1NlcnZpY2VOYW1lJywge1xuICAgICAgdmFsdWU6IGZhcmdhdGVTZXJ2aWNlLnNlcnZpY2Uuc2VydmljZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUyBTZXJ2aWNlIG5hbWUgZm9yIGRlcGxveW1lbnRzJyxcbiAgICB9KVxuICAgIFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZUVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IGRhdGFiYXNlLmluc3RhbmNlRW5kcG9pbnQuaG9zdG5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JEUyBQb3N0Z3JlU1FMIGVuZHBvaW50JyxcbiAgICB9KVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlZGlzRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogcmVkaXMuYXR0clJlZGlzRW5kcG9pbnRBZGRyZXNzLFxuICAgICAgZGVzY3JpcHRpb246ICdFbGFzdGlDYWNoZSBSZWRpcyBlbmRwb2ludCcsXG4gICAgfSlcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcHBTZWNyZXRzQXJuJywge1xuICAgICAgdmFsdWU6IGFwcFNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdBcHBsaWNhdGlvbiBzZWNyZXRzIEFSTiBmb3IgbWFudWFsIGNvbmZpZ3VyYXRpb24nLFxuICAgIH0pXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpVXJsJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7YXBpRG9tYWluTmFtZX0vYXBpYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJlIEFQSSBiYXNlIFVSTCB3aXRoIGN1c3RvbSBkb21haW4nLFxuICAgIH0pXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpQ2VydGlmaWNhdGVBcm4nLCB7XG4gICAgICB2YWx1ZTogYXBpQ2VydGlmaWNhdGUuY2VydGlmaWNhdGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBTU0wgY2VydGlmaWNhdGUgQVJOJyxcbiAgICB9KVxuXG4gICAgaWYgKGNlcnRpZmljYXRlKSB7XG4gICAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3NsQ2VydGlmaWNhdGVBcm4nLCB7XG4gICAgICAgIHZhbHVlOiBjZXJ0aWZpY2F0ZS5jZXJ0aWZpY2F0ZUFybixcbiAgICAgICAgZGVzY3JpcHRpb246ICdTU0wgY2VydGlmaWNhdGUgQVJOJyxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLy8gT3V0cHV0IEROUyBjb25maWd1cmF0aW9uIGZvciBleHRlcm5hbCBETlMgcHJvdmlkZXJzXG4gICAgaWYgKGRvbWFpbk5hbWUgJiYgdXNlRXh0ZXJuYWxEbnMpIHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbG91ZEZyb250RGlzdHJpYnV0aW9uRG9tYWluJywge1xuICAgICAgICB2YWx1ZTogZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gZG9tYWluIC0gQ3JlYXRlIENOQU1FIHJlY29yZCBmb3IgeW91ciBkb21haW4gcG9pbnRpbmcgdG8gdGhpcycsXG4gICAgICB9KVxuXG4gICAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRXh0ZXJuYWxEbnNJbnN0cnVjdGlvbnMnLCB7XG4gICAgICAgIHZhbHVlOiBgQ3JlYXRlIENOQU1FIHJlY29yZDogJHtkb21haW5OYW1lfSAtPiAke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWAsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnRE5TIHJlY29yZCB0byBjcmVhdGUgd2l0aCB5b3VyIGV4dGVybmFsIEROUyBwcm92aWRlcicsXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8vIENESyBOYWcgc3VwcHJlc3Npb25zIGZvciBsZWdpdGltYXRlIHVzZSBjYXNlc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIHZwY0Zsb3dMb2dzUm9sZSxcbiAgICAgIFt7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdWUEMgRmxvdyBMb2dzIHJlcXVpcmUgd2lsZGNhcmQgcGVybWlzc2lvbnMgZm9yIGxvZyBncm91cCBhbmQgc3RyZWFtIG9wZXJhdGlvbnMnLFxuICAgICAgICBhcHBsaWVzVG86IFsnUmVzb3VyY2U6OionXSxcbiAgICAgIH1dXG4gICAgKVxuXG4gICAgLy8gU3VwcHJlc3MgUzMgZnJvbnRlbmQgYnVja2V0IE9BQyB3YXJuaW5nICBcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBmcm9udGVuZEJ1Y2tldCxcbiAgICAgIFt7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVM1JyxcbiAgICAgICAgcmVhc29uOiAnRnJvbnRlbmQgYnVja2V0IGlzIHNlY3VyZWQgd2l0aCBDbG91ZEZyb250IE9BQyAoT3JpZ2luIEFjY2VzcyBDb250cm9sKSB3aGljaCBpcyB0aGUgbW9kZXJuIHJlcGxhY2VtZW50IGZvciBPQUkuIFRoZSBidWNrZXQgcG9saWN5IGlzIGFkZGVkIGFmdGVyIGRpc3RyaWJ1dGlvbiBjcmVhdGlvbiB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmNpZXMuJ1xuICAgICAgfV1cbiAgICApXG5cbiAgICAvLyBTdXBwcmVzcyBUYXNrUm9sZSBTMyB3aWxkY2FyZCBwZXJtaXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChcbiAgICAgIHRoaXMsXG4gICAgICBgLyR7dGhpcy5zdGFja05hbWV9L1Rhc2tSb2xlL0RlZmF1bHRQb2xpY3kvUmVzb3VyY2VgLFxuICAgICAgW3tcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ0VDUyB0YXNrIHJlcXVpcmVzIFMzIG9wZXJhdGlvbnMgZm9yIGltYWdlIHN0b3JhZ2UsIENsb3VkRnJvbnQvU0VTIHdpbGRjYXJkIHBlcm1pc3Npb25zLCBTZXJ2aWNlIERpc2NvdmVyeSwgYW5kIFRva2VuIFNlcnZpY2UgQVBJIGludm9jYXRpb24nLFxuICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAnQWN0aW9uOjpzMzpBYm9ydConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkRlbGV0ZU9iamVjdConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkdldEJ1Y2tldConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkdldE9iamVjdConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkxpc3QqJyxcbiAgICAgICAgICAnUmVzb3VyY2U6OjxBSUltYWdlc0J1Y2tldDU2QkQ5OEU4LkFybj4vKicsXG4gICAgICAgICAgJ1Jlc291cmNlOjoqJywgLy8gRm9yIENsb3VkRnJvbnQgaW52YWxpZGF0aW9ucywgU0VTIG9wZXJhdGlvbnMsIGFuZCBTZXJ2aWNlIERpc2NvdmVyeVxuICAgICAgICAgIC8vIFRva2VuIFNlcnZpY2UgQVBJIEdhdGV3YXkgcGVybWlzc2lvbnMgKHdpbGRjYXJkcyByZXF1aXJlZCBhcyBBUEkgR2F0ZXdheSBJRCBjaGFuZ2VzIHdpdGggZGVwbG95bWVudHMpXG4gICAgICAgICAgJ1Jlc291cmNlOjphcm46YXdzOmV4ZWN1dGUtYXBpOnVzLWVhc3QtMTozOTMwNTQ1MTAzNTI6Ki8qL1BPU1QvdG9rZW5zJyxcbiAgICAgICAgICAnUmVzb3VyY2U6OmFybjphd3M6ZXhlY3V0ZS1hcGk6dXMtZWFzdC0xOjM5MzA1NDUxMDM1MjoqLyovREVMRVRFL3Rva2VucycsXG4gICAgICAgICAgJ1Jlc291cmNlOjphcm46YXdzOmV4ZWN1dGUtYXBpOnVzLWVhc3QtMTozOTMwNTQ1MTAzNTI6Ki8qL1BPU1QvdG9rZW5zL3JlZnJlc2gnLFxuICAgICAgICAgICdSZXNvdXJjZTo6YXJuOmF3czpleGVjdXRlLWFwaTp1cy1lYXN0LTE6MzkzMDU0NTEwMzUyOiovKi9HRVQvaGVhbHRoJyxcbiAgICAgICAgXSxcbiAgICAgIH1dXG4gICAgKVxuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgZXhlY3V0aW9uUm9sZSxcbiAgICAgIFt7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdFQ1MgVGFzayBFeGVjdXRpb24gcmVxdWlyZXMgd2lsZGNhcmQgRUNSIHBlcm1pc3Npb25zIGZvciBpbWFnZSBwdWxscyBhbmQgQ2xvdWRXYXRjaCBMb2dzIG9wZXJhdGlvbnMnLFxuICAgICAgICBhcHBsaWVzVG86IFsnUmVzb3VyY2U6OionLCAnUmVzb3VyY2U6OmFybjphd3M6bG9nczoqOio6KiddLFxuICAgICAgfV1cbiAgICApXG5cbiAgICAvLyBTdXBwcmVzcyB0aGUgcG9saWN5LWxldmVsIElBTTUgd2FybmluZyBcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBleGVjdXRpb25Sb2xlLm5vZGUuZmluZENoaWxkKCdEZWZhdWx0UG9saWN5JyksXG4gICAgICBbe1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiAnRUNTIFRhc2sgRXhlY3V0aW9uIHJlcXVpcmVzIHdpbGRjYXJkIHBlcm1pc3Npb25zIGZvciBFQ1IgYW5kIENsb3VkV2F0Y2ggTG9ncycsXG4gICAgICAgIGFwcGxpZXNUbzogWydSZXNvdXJjZTo6KiddLFxuICAgICAgfV1cbiAgICApXG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBkYlNlY3JldCxcbiAgICAgIFt7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVNNRzQnLFxuICAgICAgICByZWFzb246ICdEYXRhYmFzZSBwYXNzd29yZCByb3RhdGlvbiB3aWxsIGJlIG1hbmFnZWQgbWFudWFsbHkgZm9yIHRoaXMgYXBwbGljYXRpb24nLFxuICAgICAgfV1cbiAgICApXG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBhcHBTZWNyZXRzLFxuICAgICAgW3tcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtU01HNCcsXG4gICAgICAgIHJlYXNvbjogJ0FwcGxpY2F0aW9uIHNlY3JldHMgcm90YXRpb24gd2lsbCBiZSBtYW5hZ2VkIG1hbnVhbGx5IGZvciB0aGlzIGFwcGxpY2F0aW9uJyxcbiAgICAgIH1dXG4gICAgKVxuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgZmFyZ2F0ZVNlcnZpY2UubG9hZEJhbGFuY2VyLFxuICAgICAgW3tcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtRUMyMycsXG4gICAgICAgIHJlYXNvbjogJ0xvYWQgYmFsYW5jZXIgbmVlZHMgdG8gYWNjZXB0IGluY29taW5nIHRyYWZmaWMgZnJvbSB0aGUgaW50ZXJuZXQgb24gcG9ydCA4MCcsXG4gICAgICB9XVxuICAgIClcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIGRpc3RyaWJ1dGlvbixcbiAgICAgIFt7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjEnLFxuICAgICAgICByZWFzb246ICdHZW8gcmVzdHJpY3Rpb25zIG5vdCByZXF1aXJlZCBmb3IgdGhpcyBhcHBsaWNhdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DRlIyJyxcbiAgICAgICAgcmVhc29uOiAnV0FGIG5vdCByZXF1aXJlZCBmb3IgdGhpcyBzdGF0aWMgd2Vic2l0ZSBkaXN0cmlidXRpb24nLFxuICAgICAgfV1cbiAgICApXG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBkYXRhYmFzZSxcbiAgICAgIFt7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVJEUzMnLFxuICAgICAgICByZWFzb246ICdNdWx0aS1BWiBub3QgcmVxdWlyZWQgZm9yIGRldmVsb3BtZW50IGVudmlyb25tZW50LCBlbmFibGVkIHZpYSBjb25maWd1cmF0aW9uIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVJEUzEwJyxcbiAgICAgICAgcmVhc29uOiAnRGVsZXRpb24gcHJvdGVjdGlvbiBkaXNhYmxlZCBmb3IgZGV2ZWxvcG1lbnQgZW52aXJvbm1lbnQsIGVuYWJsZWQgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfV1cbiAgICApXG5cbiAgICAvLyBTdXBwcmVzcyBFQ1MgVGFzayBEZWZpbml0aW9uIGVudmlyb25tZW50IHZhcmlhYmxlcyB3YXJuaW5nXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIGAvJHt0aGlzLnN0YWNrTmFtZX0vUG9zdG9saW9TZXJ2aWNlL1Rhc2tEZWYvUmVzb3VyY2VgLFxuICAgICAgW3tcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtRUNTMicsXG4gICAgICAgIHJlYXNvbjogJ0Vudmlyb25tZW50IHZhcmlhYmxlcyBjb250YWluIG5vbi1zZW5zaXRpdmUgY29uZmlndXJhdGlvbi4gU2Vuc2l0aXZlIGRhdGEgc3RvcmVkIGluIFNlY3JldHMgTWFuYWdlcicsXG4gICAgICB9XVxuICAgIClcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIGFjY2Vzc0xvZ3NCdWNrZXQsXG4gICAgICBbe1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TMScsXG4gICAgICAgIHJlYXNvbjogJ1RoaXMgaXMgdGhlIGFjY2VzcyBsb2dzIGJ1Y2tldCBpdHNlbGYsIGRvZXMgbm90IG5lZWQgaXRzIG93biBhY2Nlc3MgbG9ncycsXG4gICAgICB9XVxuICAgIClcbiAgICBcbiAgICAvLyBBSSBJbWFnZXMgYnVja2V0IGhhcyBhY2Nlc3MgbG9nZ2luZyBjb25maWd1cmVkIHRvIHRoZSBhY2Nlc3NMb2dzQnVja2V0XG4gICAgLy8gTm8gc3VwcHJlc3Npb24gbmVlZGVkIGFzIGxvZ2dpbmcgaXMgZW5hYmxlZFxuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgYWxiQWNjZXNzTG9nc0J1Y2tldCxcbiAgICAgIFt7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVMxJyxcbiAgICAgICAgcmVhc29uOiAnVGhpcyBpcyB0aGUgQUxCIGFjY2VzcyBsb2dzIGJ1Y2tldCBpdHNlbGYsIGRvZXMgbm90IG5lZWQgaXRzIG93biBhY2Nlc3MgbG9ncycsXG4gICAgICB9XVxuICAgIClcblxuICAgIC8vIEZpeCByZW1haW5pbmcgc3VwcHJlc3Npb25zXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgZGlzdHJpYnV0aW9uLFxuICAgICAgW3tcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSNCcsXG4gICAgICAgIHJlYXNvbjogJ0Nsb3VkRnJvbnQgdXNlcyBkZWZhdWx0IGNlcnRpZmljYXRlIHdoaWNoIGhhcyBtaW5pbXVtIFRMUyB2ZXJzaW9uIGxpbWl0YXRpb25zJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjUnLFxuICAgICAgICByZWFzb246ICdTMyB3ZWJzaXRlIG9yaWdpbiByZXF1aXJlcyBIVFRQIHByb3RvY29sLCBzZWN1cmVkIGJ5IE9BQycsXG4gICAgICB9XVxuICAgIClcblxuICAgIC8vIFN1cHByZXNzIGxvYWQgYmFsYW5jZXIgc2VjdXJpdHkgZ3JvdXAgd2FybmluZ1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIGZhcmdhdGVTZXJ2aWNlLmxvYWRCYWxhbmNlci5ub2RlLmZpbmRDaGlsZCgnU2VjdXJpdHlHcm91cCcpLFxuICAgICAgW3tcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtRUMyMycsXG4gICAgICAgIHJlYXNvbjogJ0xvYWQgYmFsYW5jZXIgc2VjdXJpdHkgZ3JvdXAgbmVlZHMgdG8gYWNjZXB0IEhUVFAgdHJhZmZpYyBmcm9tIGludGVybmV0IG9uIHBvcnQgODAnLFxuICAgICAgfV1cbiAgICApXG5cbiAgICAvLyBOT1RFOiBMYW1iZGFARWRnZSBzdXBwcmVzc2lvbnMgcmVtb3ZlZCAtIExhbWJkYUBFZGdlIGZ1bmN0aW9uIHdhcyByZW1vdmVkIGR1ZSB0byBwcm9kdWN0aW9uIGlzc3Vlc1xuICB9XG59XG4iXX0=