import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
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
import { Construct } from 'constructs'

export interface PostolioStackProps extends cdk.StackProps {
  environment: string
  domainName?: string
  hostedZoneId?: string
  useExternalDns?: boolean
}

export class PostolioStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PostolioStackProps) {
    super(scope, id, props)

    const { environment, domainName, hostedZoneId, useExternalDns } = props

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
    dbSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(5432), 'Allow ECS tasks to connect to PostgreSQL')

    cacheSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(6379), 'Allow ECS tasks to connect to Redis')

    // Secrets Manager for database credentials
    const dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      description: 'Postolio database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\',
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
      deletionProtection: environment === 'prod',
      backupRetention: environment === 'prod' ? cdk.Duration.days(7) : cdk.Duration.days(1),
      deleteAutomatedBackups: environment !== 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
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
    })

    // S3 Bucket for frontend assets
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `postolio-frontend-${environment}-${cdk.Aws.ACCOUNT_ID}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
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

    // CloudFront Distribution for frontend
    const distributionProps: any = {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    }

    // Add custom domain configuration if provided
    if (domainName && certificate) {
      distributionProps.domainNames = [domainName]
      distributionProps.certificate = certificate
    }

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', distributionProps)

    // Create DNS record for custom domain (only if using Route 53)
    if (domainName && hostedZone && !useExternalDns) {
      new route53.ARecord(this, 'DomainARecord', {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
      })
    }

    // Application secrets
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      description: 'Postolio application secrets',
      secretObjectValue: {
        jwtSecret: cdk.SecretValue.unsafePlainText(
          cdk.Fn.select(2, cdk.Fn.split('-', cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID))))
        ),
        openaiApiKey: cdk.SecretValue.unsafePlainText('PLACEHOLDER_OPENAI_KEY'),
        facebookAppId: cdk.SecretValue.unsafePlainText('PLACEHOLDER_FACEBOOK_APP_ID'),
        facebookAppSecret: cdk.SecretValue.unsafePlainText('PLACEHOLDER_FACEBOOK_APP_SECRET'),
      },
    })

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'PostolioCluster', {
      vpc,
      containerInsights: true,
    })

    // Task role with permissions to access secrets
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    })

    dbSecret.grantRead(taskRole)
    appSecrets.grantRead(taskRole)

    // Task execution role with explicit PassRole permissions
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    })

    // Add explicit PassRole permission for the specific task role
    executionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [taskRole.roleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'ecs-tasks.amazonaws.com'
        }
      }
    }))

    // ECS Service with Application Load Balancer
    const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'PostolioService', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: environment === 'prod' ? 2 : 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('..', {
          file: 'Dockerfile',
        }),
        containerPort: 3000,
        executionRole,
        taskRole,
        environment: {
          NODE_ENV: 'production',
          PORT: '3000',
          REDIS_URL: `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
          INSTAGRAM_REDIRECT_URI: `https://${domainName || distribution.distributionDomainName}/auth/instagram/callback`,
        },
        secrets: {
          DATABASE_URL: ecs.Secret.fromSecretsManager(dbSecret),
          JWT_SECRET: ecs.Secret.fromSecretsManager(appSecrets, 'jwtSecret'),
          OPENAI_API_KEY: ecs.Secret.fromSecretsManager(appSecrets, 'openaiApiKey'),
          FACEBOOK_APP_ID: ecs.Secret.fromSecretsManager(appSecrets, 'facebookAppId'),
          FACEBOOK_APP_SECRET: ecs.Secret.fromSecretsManager(appSecrets, 'facebookAppSecret'),
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

    // Health check configuration
    fargateService.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
    })

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

    // Outputs
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
      value: `https://${domainName || distribution.distributionDomainName}`,
      description: 'Main application URL',
    })

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'Frontend S3 bucket name',
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
  }
}
