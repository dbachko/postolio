/**
 * Asset Library Stack - Asset Management Microservice Infrastructure
 * Contains infrastructure for the assets library microservice:
 * - Separate RDS PostgreSQL database for asset metadata
 * - S3 bucket for asset storage (images/videos)
 * - ECS Fargate service for assets API
 * - Lambda functions for thumbnail generation and AI analysis
 * - CloudFront distribution for asset delivery
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import * as path from 'path';

export interface AssetLibraryStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  imageTag?: string;
  openaiApiKey?: string;
  assetsCdnDomainName?: string;
  assetsCdnHostedZoneId?: string;
  assetsCdnHostedZoneName?: string;
  assetsCdnCertificateArn?: string;
  assetsCdnUseExternalDns?: boolean;
}

export class AssetLibraryStack extends cdk.Stack {
  public readonly assetsDatabase: rds.IDatabaseInstance;
  public readonly assetsBucket: s3.IBucket;
  public readonly assetsCdn: cloudfront.IDistribution;
  public readonly databaseSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: AssetLibraryStackProps) {
    super(scope, id, props);

    const {
      environment,
      imageTag,
      openaiApiKey,
      assetsCdnDomainName,
      assetsCdnHostedZoneId,
      assetsCdnHostedZoneName,
      assetsCdnCertificateArn,
      assetsCdnUseExternalDns,
    } = props;
    const prefix = `postolio-${environment}-assets`;
    const isProduction = environment === 'prod';
    const enableCloudFrontAccessLogs = isProduction;
    const enableAlbAccessLogs = isProduction;

    // Initialized with SSM-based secret references (no cross-stack export imports)

    // Resolve VPC and KMS from SSM to avoid cross-stack imports
    // Import the full VPC configuration by lookup using the Foundation-set VPC name.
    // This avoids AZ/subnet index mismatches that can occur with fromVpcAttributes and
    // does not depend on SSM for synth-time context.
    const vpc = ec2.Vpc.fromLookup(this, 'FoundationVpc', {
      vpcName: `postolio-${environment}-vpc`,
    });

    const kmsKeyArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/kms/key-arn`
    );
    const encryptionKey = kms.Key.fromKeyArn(this, 'FoundationKmsKey', kmsKeyArn);

    const redisEndpointParam = ssm.StringParameter.fromStringParameterName(
      this,
      'AssetsRedisEndpointParam',
      `/postolio/${environment}/cache/endpoint`
    );
    const redisPortParam = ssm.StringParameter.fromStringParameterName(
      this,
      'AssetsRedisPortParam',
      `/postolio/${environment}/cache/port`
    );
    const cacheSecurityGroupIdParam = ssm.StringParameter.fromStringParameterName(
      this,
      'AssetsCacheSecurityGroupParam',
      `/postolio/${environment}/cache/security-group-id`
    );
    const cacheSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'AssetsCacheSecurityGroup',
      cacheSecurityGroupIdParam.stringValue
    );

    // Image tag resolution: prefer explicit assetsImageTag context, then props when it already
    // points at an assets image, otherwise fall back to the stack default.
    const explicitAssetsImageTag = this.node.tryGetContext('assetsImageTag') as string | undefined;
    const normalizedPropImageTag =
      imageTag && imageTag.startsWith('assets-') ? imageTag : undefined;
    const selectedImageTag =
      (explicitAssetsImageTag && explicitAssetsImageTag.trim().length > 0
        ? explicitAssetsImageTag
        : undefined) ?? normalizedPropImageTag;
    const defaultImageTag = `assets-${environment}-latest`;
    const containerImageTag =
      selectedImageTag && selectedImageTag.trim().length > 0 ? selectedImageTag : defaultImageTag;

    // Import ECR repository by NAME (no cross-stack import)
    const repository = ecr.Repository.fromRepositoryName(this, 'PostolioRepository', 'postolio');

    // ==================== Security Groups ====================
    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'AssetsDatabaseSecurityGroup', {
      vpc,
      description: 'Security group for Assets RDS database',
      allowAllOutbound: false,
    });

    // Create a dedicated Lambda Security Group for this stack to avoid
    // cross-stack coupling with Foundation's SGs.
    const assetsLambdaSecurityGroup = new ec2.SecurityGroup(this, 'AssetsLambdaSecurityGroup', {
      vpc,
      description: 'Security group for Asset Library Lambda functions',
      allowAllOutbound: true,
    });

    // Allow only this stack's Lambda functions to connect to the assets database
    this.databaseSecurityGroup.addIngressRule(
      assetsLambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Asset Library Lambdas to connect to assets database'
    );

    // ==================== Database Configuration ====================
    const dbSubnetGroup = new rds.SubnetGroup(this, 'AssetsDatabaseSubnetGroup', {
      vpc,
      description: 'Subnet group for Assets RDS database',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      subnetGroupName: `${prefix}-db-subnet-group`,
    });

    const databaseSecret = new secretsmanager.Secret(this, 'AssetsDatabaseCredentials', {
      secretName: `${prefix}/database/credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    const assetsServiceTokenSecret = new secretsmanager.Secret(this, 'AssetsServiceTokenSecret', {
      secretName: `/postolio/${environment}/assets/service-token`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'token',
        passwordLength: 40,
        excludePunctuation: true,
      },
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Use shared JWT Secret from Foundation stack (passed via props)
    // This enables unified authentication between main API and Assets API

    this.assetsDatabase = new rds.DatabaseInstance(this, 'AssetsDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      subnetGroup: dbSubnetGroup,
      securityGroups: [this.databaseSecurityGroup],
      databaseName: 'postolio_assets',
      credentials: rds.Credentials.fromSecret(databaseSecret),
      allocatedStorage: environment === 'prod' ? 100 : 20,
      storageEncrypted: true,
      storageEncryptionKey: encryptionKey,
      backupRetention: environment === 'prod' ? cdk.Duration.days(30) : cdk.Duration.days(7),
      deleteAutomatedBackups: environment !== 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      enablePerformanceInsights: environment === 'prod',
      iamAuthentication: false,
    });

    // Export database endpoint to SSM for ECS tasks and Lambda functions
    new ssm.StringParameter(this, 'AssetsDatabaseEndpoint', {
      parameterName: `/postolio/${environment}/assets/database-endpoint`,
      stringValue: this.assetsDatabase.dbInstanceEndpointAddress,
      description: 'Assets database endpoint address',
    });

    new ssm.StringParameter(this, 'AssetsDatabasePort', {
      parameterName: `/postolio/${environment}/assets/database-port`,
      stringValue: this.assetsDatabase.dbInstanceEndpointPort,
      description: 'Assets database port',
    });

    new ssm.StringParameter(this, 'AssetsDatabaseSecretArn', {
      parameterName: `/postolio/${environment}/assets/database-secret-arn`,
      stringValue: databaseSecret.secretArn,
      description: 'Assets database credentials secret ARN',
    });

    // ==================== S3 Bucket for Assets ====================
    this.assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `${prefix}-storage`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false, // No versioning to save costs
      lifecycleRules: [
        {
          // Transition to Infrequent Access after 30 days
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: environment === 'prod' ? ['https://postolio.example'] : ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
    });

    // Export bucket name to SSM
    new ssm.StringParameter(this, 'AssetsBucketName', {
      parameterName: `/postolio/${environment}/assets/bucket-name`,
      stringValue: this.assetsBucket.bucketName,
      description: 'Assets S3 bucket name',
    });

    const normalizedAssetsCdnDomain = normalizeDomainName(assetsCdnDomainName);

    let assetsCdnHostedZone: route53.IHostedZone | undefined;
    let resolvedAssetsCdnHostedZoneName: string | undefined;
    if (normalizedAssetsCdnDomain && !assetsCdnUseExternalDns) {
      const lookupDomain = (
        assetsCdnHostedZoneName || deriveHostedZoneName(normalizedAssetsCdnDomain)
      ).replace(/\.$/, '');
      resolvedAssetsCdnHostedZoneName = lookupDomain;

      if (assetsCdnHostedZoneId) {
        assetsCdnHostedZone = route53.HostedZone.fromHostedZoneAttributes(
          this,
          'AssetsCdnHostedZone',
          {
            hostedZoneId: assetsCdnHostedZoneId,
            zoneName: lookupDomain,
          }
        );
      } else {
        assetsCdnHostedZone = route53.HostedZone.fromLookup(this, 'AssetsCdnHostedZone', {
          domainName: lookupDomain,
        });
        resolvedAssetsCdnHostedZoneName = assetsCdnHostedZone.zoneName;
      }
    }

    let assetsCdnCertificate: acm.ICertificate | undefined;
    if (normalizedAssetsCdnDomain) {
      if (assetsCdnCertificateArn) {
        assetsCdnCertificate = acm.Certificate.fromCertificateArn(
          this,
          'AssetsCdnCertificateImport',
          assetsCdnCertificateArn
        );
      } else if (assetsCdnHostedZone && !assetsCdnUseExternalDns) {
        assetsCdnCertificate = new acm.Certificate(this, 'AssetsCdnCertificate', {
          domainName: normalizedAssetsCdnDomain,
          validation: acm.CertificateValidation.fromDns(assetsCdnHostedZone),
        });
      } else {
        throw new Error(
          'assetsCdnDomainName provided but no certificate configuration available. Provide assetsCdnCertificateArn or Route 53 details.'
        );
      }
    }

    // ==================== CloudFront Distribution ====================
    const assetsCdnLogsBucket = new s3.Bucket(this, 'AssetsCdnLogsBucket', {
      bucketName: `${prefix}-cdn-logs-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [
        {
          id: 'DeleteOldLogs',
          expiration: cdk.Duration.days(isProduction ? 90 : 14),
        },
      ],
      removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProduction,
    });

    const distributionProps: cloudfront.DistributionProps = {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.assetsBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      comment: `Assets CDN for ${environment} environment`,
      enableLogging: enableCloudFrontAccessLogs,
      ...(enableCloudFrontAccessLogs
        ? {
            logBucket: assetsCdnLogsBucket,
            logFilePrefix: 'cloudfront/',
          }
        : {}),
      priceClass: isProduction
        ? cloudfront.PriceClass.PRICE_CLASS_ALL
        : cloudfront.PriceClass.PRICE_CLASS_100,
      ...(normalizedAssetsCdnDomain && assetsCdnCertificate
        ? {
            domainNames: [normalizedAssetsCdnDomain],
            certificate: assetsCdnCertificate,
          }
        : {}),
    };

    this.assetsCdn = new cloudfront.Distribution(this, 'AssetsDistribution', distributionProps);

    if (normalizedAssetsCdnDomain && assetsCdnHostedZone && !assetsCdnUseExternalDns) {
      const recordName = deriveRecordName(
        normalizedAssetsCdnDomain,
        resolvedAssetsCdnHostedZoneName || assetsCdnHostedZone.zoneName
      );

      new route53.ARecord(this, 'AssetsCdnAliasRecord', {
        zone: assetsCdnHostedZone,
        recordName,
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(this.assetsCdn)),
      });

      new route53.AaaaRecord(this, 'AssetsCdnAliasRecordIpv6', {
        zone: assetsCdnHostedZone,
        recordName,
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(this.assetsCdn)),
      });
    }

    const resolvedPublicCdnDomain =
      normalizedAssetsCdnDomain || this.assetsCdn.distributionDomainName;
    const sentryDsn =
      (this.node.tryGetContext('sentryDsn') as string | undefined) ||
      process.env.SENTRY_BACKEND_DSN;

    // Export CDN domain to SSM
    new ssm.StringParameter(this, 'AssetsCdnDomain', {
      parameterName: `/postolio/${environment}/assets/cdn-domain`,
      stringValue: resolvedPublicCdnDomain,
      description: 'Assets CloudFront domain',
    });

    new ssm.StringParameter(this, 'AssetsCdnDistributionId', {
      parameterName: `/postolio/${environment}/assets/cdn-distribution-id`,
      stringValue: this.assetsCdn.distributionId,
      description: 'Assets CloudFront distribution ID',
    });

    new ssm.StringParameter(this, 'AssetsServiceTokenSecretArnParam', {
      parameterName: `/postolio/${environment}/assets/service-token-arn`,
      stringValue: assetsServiceTokenSecret.secretArn,
      description: 'Secret ARN containing the Assets API service token',
    });

    // ==================== EventBridge Event Bus ====================
    const assetEventBus = new events.EventBus(this, 'AssetEventBus', {
      eventBusName: `${prefix}-events`,
    });

    // Export EventBus name to SSM
    new ssm.StringParameter(this, 'AssetEventBusName', {
      parameterName: `/postolio/${environment}/assets/event-bus-name`,
      stringValue: assetEventBus.eventBusName,
      description: 'Asset processing EventBridge bus name',
    });

    // ==================== OpenAI API Key Secret ====================
    // Create or import OpenAI API key secret
    let openaiSecret: secretsmanager.ISecret;
    if (openaiApiKey) {
      openaiSecret = new secretsmanager.Secret(this, 'OpenAIApiKey', {
        secretName: `${prefix}/openai-api-key`,
        secretStringValue: cdk.SecretValue.unsafePlainText(openaiApiKey),
        description: 'OpenAI API key for asset AI analysis',
      });
    } else {
      // Import by secret NAME to avoid hard dependency on an SSM parameter
      // Operators should ensure this secret exists: `${prefix}/openai-api-key`
      openaiSecret = secretsmanager.Secret.fromSecretNameV2(
        this,
        'OpenAIApiKey',
        `${prefix}/openai-api-key`
      );
    }

    // ==================== IAM Role for Lambda Functions ====================
    const assetProcessingRole = new iam.Role(this, 'AssetProcessingLambdaRole', {
      roleName: `${prefix}-lambda-processing-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // Grant S3 permissions (read/write to assets bucket)
    this.assetsBucket.grantReadWrite(assetProcessingRole);

    // Grant RDS database access via Secrets Manager (password-based auth)
    databaseSecret.grantRead(assetProcessingRole);

    // Grant EventBridge permissions
    assetProcessingRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [assetEventBus.eventBusArn],
      })
    );

    // Grant Secrets Manager access for OpenAI key
    openaiSecret.grantRead(assetProcessingRole);

    // Grant KMS permissions
    encryptionKey.grantDecrypt(assetProcessingRole);

    // ==================== Lambda: Thumbnail Generator ====================
    const thumbnailGeneratorFunction = new lambdaNodejs.NodejsFunction(
      this,
      'ThumbnailGeneratorFunction',
      {
        functionName: `${prefix}-thumbnail-generator`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        entry: path.join(__dirname, '../../../../services/asset-thumbnail-generator/src/index.ts'),
        timeout: cdk.Duration.minutes(5),
        memorySize: 2048, // Sharp requires more memory for image processing
        role: assetProcessingRole,
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        securityGroups: [assetsLambdaSecurityGroup],
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          NODE_ENV: environment,
          SERVICE_NAME: 'asset-thumbnail-generator',
          ENVIRONMENT: environment,
          LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
          // Database connection
          ASSETS_DATABASE_URL: `postgresql://${databaseSecret.secretValueFromJson('username').unsafeUnwrap()}:${databaseSecret.secretValueFromJson('password').unsafeUnwrap()}@${this.assetsDatabase.dbInstanceEndpointAddress}:${this.assetsDatabase.dbInstanceEndpointPort}/postolio_assets`,
          DB_SECRET_ARN: databaseSecret.secretArn,
          // S3 configuration
          S3_BUCKET: this.assetsBucket.bucketName,
          S3_REGION: cdk.Aws.REGION,
          // EventBridge
          EVENT_BUS_NAME: assetEventBus.eventBusName,
          ...(sentryDsn && { SENTRY_BACKEND_DSN: sentryDsn }),
        },
        bundling: {
          // Sharp requires special handling for native modules
          externalModules: ['@prisma/client', 'prisma', '@aws-sdk/*'],
          nodeModules: ['sharp'],
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            afterBundling: (inputDir: string, outputDir: string) => [
              // Ensure Sharp is compiled for Lambda (linux-x64)
              `cd ${outputDir}`,
              `npm install --arch=x64 --platform=linux sharp`,
              // Ensure no prisma client artifacts remain in asset
              `bash -lc "cd ${outputDir} && rm -rf node_modules/@prisma || true"`,
            ],
          },
        },
        logGroup: new logs.LogGroup(this, 'ThumbnailGeneratorLogGroup', {
          logGroupName: `/aws/lambda/${prefix}-thumbnail-generator`,
          retention:
            environment === 'prod' ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
          removalPolicy:
            environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        }),
      }
    );

    // ==================== Lambda: AI Image Analyzer ====================
    const aiAnalyzerFunction = new lambdaNodejs.NodejsFunction(this, 'AIAnalyzerFunction', {
      functionName: `${prefix}-ai-analyzer`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/asset-ai-analyzer/src/index.ts'),
      timeout: cdk.Duration.minutes(3),
      memorySize: 1024,
      role: assetProcessingRole,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [assetsLambdaSecurityGroup],
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'asset-ai-analyzer',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        // Database connection
        ASSETS_DATABASE_URL: `postgresql://${databaseSecret.secretValueFromJson('username').unsafeUnwrap()}:${databaseSecret.secretValueFromJson('password').unsafeUnwrap()}@${this.assetsDatabase.dbInstanceEndpointAddress}:${this.assetsDatabase.dbInstanceEndpointPort}/postolio_assets`,
        DB_SECRET_ARN: databaseSecret.secretArn,
        // S3 configuration
        S3_BUCKET: this.assetsBucket.bucketName,
        S3_REGION: cdk.Aws.REGION,
        // OpenAI configuration
        OPENAI_API_KEY_SECRET: openaiSecret.secretArn,
        // EventBridge
        EVENT_BUS_NAME: assetEventBus.eventBusName,
        // CloudFront for presigned URLs
        CDN_DOMAIN: resolvedPublicCdnDomain,
        ASSETS_CDN_DOMAIN: resolvedPublicCdnDomain,
        ...(sentryDsn && { SENTRY_BACKEND_DSN: sentryDsn }),
      },
      bundling: {
        // Do not package prisma; esbuild will bundle openai
        externalModules: ['@prisma/client', 'prisma'],
      },
      logGroup: new logs.LogGroup(this, 'AIAnalyzerLogGroup', {
        logGroupName: `/aws/lambda/${prefix}-ai-analyzer`,
        retention:
          environment === 'prod' ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
        removalPolicy:
          environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
    });

    // ==================== S3 Event Notification ====================
    // Trigger thumbnail generator when assets are uploaded
    this.assetsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(thumbnailGeneratorFunction),
      {
        prefix: 'brands/', // Trigger for assets uploaded to brands/{brandId}/uploads/
        suffix: '', // Trigger for all file types (images and videos)
      }
    );

    // ==================== EventBridge Rules ====================
    // Rule 1: Trigger AI analyzer when thumbnails are complete
    const aiAnalyzerRule = new events.Rule(this, 'AIAnalyzerRule', {
      ruleName: `${prefix}-trigger-ai-analysis`,
      description: 'Trigger AI analysis when thumbnail generation completes',
      eventBus: assetEventBus,
      eventPattern: {
        source: ['asset.processing'],
        detailType: ['asset.thumbnails_complete'],
      },
    });

    aiAnalyzerRule.addTarget(new targets.LambdaFunction(aiAnalyzerFunction));

    // Rule 2: CloudWatch alarm for failed processing
    const processingFailedRule = new events.Rule(this, 'ProcessingFailedRule', {
      ruleName: `${prefix}-processing-failed`,
      description: 'Alert when asset processing fails',
      eventBus: assetEventBus,
      eventPattern: {
        source: ['asset.processing'],
        detailType: ['asset.thumbnail_failed', 'asset.ai_analysis_failed'],
      },
    });

    // Log failed processing events to CloudWatch
    const failedProcessingLogGroup = new logs.LogGroup(this, 'FailedProcessingLogGroup', {
      logGroupName: `/postolio/${environment}/assets/processing-failures`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    processingFailedRule.addTarget(new targets.CloudWatchLogGroup(failedProcessingLogGroup));

    // Export Lambda function ARNs to SSM
    new ssm.StringParameter(this, 'ThumbnailGeneratorArn', {
      parameterName: `/postolio/${environment}/assets/thumbnail-generator-arn`,
      stringValue: thumbnailGeneratorFunction.functionArn,
      description: 'Thumbnail generator Lambda ARN',
    });

    new ssm.StringParameter(this, 'AIAnalyzerArn', {
      parameterName: `/postolio/${environment}/assets/ai-analyzer-arn`,
      stringValue: aiAnalyzerFunction.functionArn,
      description: 'AI analyzer Lambda ARN',
    });

    // Resolve JWT secret via SSM-provided ARN (ensured by Foundation)
    const jwtSecretArnAssets = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/jwt-secret-arn`
    );
    const jwtSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'JwtSecretByArnAssets',
      jwtSecretArnAssets
    );

    // ==================== ECS Cluster ====================
    const ecsCluster = new ecs.Cluster(this, 'AssetsEcsCluster', {
      clusterName: `${prefix}-cluster`,
      vpc: vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED, // Enable for all environments to satisfy CDK Nag AwsSolutions-ECS4
    });

    // ==================== ECS Execution Role ====================
    const executionRole = new iam.Role(this, 'AssetsEcsExecutionRole', {
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

    // ==================== ECS Task Role ====================
    const taskRole = new iam.Role(this, 'AssetsEcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess')],
      inlinePolicies: {
        AssetsTaskPolicy: new iam.PolicyDocument({
          statements: [
            // Secrets Manager permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
              resources: [
                databaseSecret.secretArn,
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio-${environment}/*`,
              ],
            }),
            // SSM Parameter Store permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/*`,
              ],
            }),
            // KMS permissions for encryption
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
              resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
            }),
            // S3 permissions for assets bucket
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
              resources: [this.assetsBucket.bucketArn, `${this.assetsBucket.bucketArn}/*`],
            }),
            // EventBridge permissions for asset events
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['events:PutEvents'],
              resources: [assetEventBus.eventBusArn],
            }),
            // CloudFront invalidation permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['cloudfront:CreateInvalidation'],
              resources: [
                `arn:aws:cloudfront::${this.account}:distribution/${this.assetsCdn.distributionId}`,
              ],
            }),
          ],
        }),
      },
    });

    // ==================== S3 Bucket for ALB Access Logs ====================
    let albLogsBucket: s3.Bucket | undefined;
    if (enableAlbAccessLogs) {
      albLogsBucket = new s3.Bucket(this, 'AssetsAlbAccessLogsBucket', {
        bucketName: `${prefix}-alb-logs-${this.account}`,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        lifecycleRules: [
          {
            id: 'DeleteOldLogs',
            expiration: cdk.Duration.days(30),
          },
        ],
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

      NagSuppressions.addResourceSuppressions(albLogsBucket, [
        {
          id: 'AwsSolutions-S1',
          reason:
            'ALB access log bucket should not have server access logging to avoid infinite recursion',
        },
      ]);
    }

    // ==================== Application Load Balanced Fargate Service ====================
    const assetsApiService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'AssetsApiService',
      {
        serviceName: `${prefix}-api-service`,
        cluster: ecsCluster,
        cpu: environment === 'prod' ? 512 : 256,
        memoryLimitMiB: environment === 'prod' ? 1024 : 512,
        desiredCount: environment === 'prod' ? 2 : 1,
        circuitBreaker: { enable: true, rollback: true },
        taskImageOptions: {
          image: ecs.ContainerImage.fromEcrRepository(repository, containerImageTag),
          containerPort: 3002,
          taskRole: taskRole,
          executionRole: executionRole,
          environment: {
            NODE_ENV: environment,
            PORT: '3002',
            LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
            AWS_REGION: this.region,
            ASSETS_S3_BUCKET: this.assetsBucket.bucketName,
            S3_BUCKET: this.assetsBucket.bucketName,
            S3_REGION: this.region,
            CDN_DOMAIN: resolvedPublicCdnDomain,
            ASSETS_CDN_DOMAIN: resolvedPublicCdnDomain,
            EVENT_BUS_NAME: assetEventBus.eventBusName,
            // Non-sensitive DB connection details provided as plain env vars
            ASSETS_DB_HOST: this.assetsDatabase.dbInstanceEndpointAddress,
            ASSETS_DB_PORT: this.assetsDatabase.dbInstanceEndpointPort,
            DATABASE_URL: `postgresql://${databaseSecret
              .secretValueFromJson('username')
              .unsafeUnwrap()}:${databaseSecret
              .secretValueFromJson('password')
              .unsafeUnwrap()}@${this.assetsDatabase.dbInstanceEndpointAddress}:${
              this.assetsDatabase.dbInstanceEndpointPort
            }/postolio_assets`,
            ASSETS_DATABASE_URL: `postgresql://${databaseSecret
              .secretValueFromJson('username')
              .unsafeUnwrap()}:${databaseSecret
              .secretValueFromJson('password')
              .unsafeUnwrap()}@${this.assetsDatabase.dbInstanceEndpointAddress}:${
              this.assetsDatabase.dbInstanceEndpointPort
            }/postolio_assets`,
            REDIS_HOST: redisEndpointParam.stringValue,
            REDIS_PORT: redisPortParam.stringValue,
            REDIS_URL: `redis://${redisEndpointParam.stringValue}:${redisPortParam.stringValue}`,
          },
          secrets: {
            ASSETS_DB_USERNAME: ecs.Secret.fromSecretsManager(databaseSecret, 'username'),
            ASSETS_DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
            // Provide full JWT secret string; do not require JSON key shape
            JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
            ASSETS_SERVICE_TOKEN: ecs.Secret.fromSecretsManager(assetsServiceTokenSecret, 'token'),
          },
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: `${prefix}-api`,
            logRetention: logs.RetentionDays.TWO_WEEKS,
          }),
        },
        assignPublicIp: false,
        taskSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        publicLoadBalancer: false,
        openListener: false,
        listenerPort: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        platformVersion: ecs.FargatePlatformVersion.LATEST,
      }
    );

    // Restrict ALB ingress to shared ECS security group (e.g., main API tasks)
    const sharedEcsSecurityGroupParam = ssm.StringParameter.fromStringParameterAttributes(
      this,
      'SharedEcsSecurityGroupParam',
      {
        parameterName: `/postolio/${environment}/security-groups/ecs`,
      }
    );
    const sharedEcsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'SharedEcsSecurityGroup',
      sharedEcsSecurityGroupParam.stringValue,
      { mutable: false }
    );

    // Explicit ingress rule to keep ALB internal-only and scoped to ECS services
    new ec2.CfnSecurityGroupIngress(this, 'AssetsApiAlbIngressFromEcs', {
      groupId: assetsApiService.loadBalancer.connections.securityGroups[0].securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      sourceSecurityGroupId: sharedEcsSecurityGroup.securityGroupId,
      description: 'Allow internal ECS services to reach Assets API ALB',
    });

    // Enable ALB access logs in production only.
    if (albLogsBucket) {
      assetsApiService.loadBalancer.logAccessLogs(albLogsBucket, 'alb-logs');
    }

    // Allow the service Security Group to reach the Assets database
    // This avoids attaching the Foundation ECS Security Group to the service,
    // which can introduce cross-stack coupling and potential dependency cycles.
    this.assetsDatabase.connections.allowDefaultPortFrom(
      assetsApiService.service,
      'Allow Assets API service to connect to assets database'
    );

    new ec2.CfnSecurityGroupIngress(this, 'AssetsCacheAccessRule', {
      groupId: cacheSecurityGroup.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 6379,
      toPort: 6379,
      sourceSecurityGroupId: assetsApiService.service.connections.securityGroups[0].securityGroupId,
      description: 'Allow Assets API service to connect to Redis cache',
    });

    // Configure deployment settings
    const cfnService = assetsApiService.service.node.defaultChild as ecs.CfnService;
    cfnService.deploymentConfiguration = {
      minimumHealthyPercent: 100,
      maximumPercent: 200,
    };

    // Configure health check
    assetsApiService.targetGroup.configureHealthCheck({
      path: '/health',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Export ECS service endpoint
    new ssm.StringParameter(this, 'AssetsApiEndpoint', {
      parameterName: `/postolio/${environment}/assets/api-endpoint`,
      stringValue: `http://${assetsApiService.loadBalancer.loadBalancerDnsName}`,
      description: 'Assets API load balancer endpoint',
    });

    // ==================== CDK Nag Suppressions ====================
    const stackSuppressions = [
      {
        id: 'AwsSolutions-RDS10',
        reason: 'Deletion protection disabled for non-prod environments for easier cleanup',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason: 'Default port 5432 is acceptable for this use case',
      },
      {
        id: 'AwsSolutions-RDS3',
        reason:
          'Multi-AZ deployment disabled for non-prod environments to reduce costs. Production environment enables this.',
      },
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'Automatic secret rotation not required for database credentials in dev environment. Production should enable this.',
      },
      {
        id: 'AwsSolutions-S1',
        reason: 'S3 server access logging not required for assets bucket',
      },
      {
        id: 'AwsSolutions-S10',
        reason:
          'SSL enforcement handled at CloudFront level. Assets bucket is private with OAC access only.',
      },
      {
        id: 'AwsSolutions-CFR1',
        reason: 'Geo restrictions not required for asset delivery',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'WAF not required for asset delivery CDN. Assets are public read-only content.',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason:
          'Default CloudFront certificate used for dev environment. Custom domain with ACM certificate recommended for production.',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'AWS managed policies (AWSLambdaBasicExecutionRole, AWSLambdaVPCAccessExecutionRole, AmazonECSTaskExecutionRolePolicy, AmazonSSMReadOnlyAccess) are appropriate for Lambda and ECS',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Wildcard permissions required for Lambda and ECS tasks to access S3 objects with dynamic keys, database connections, and SSM parameters',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Using latest Lambda runtime (Node.js 22) as specified in package configurations',
      },
      {
        id: 'AwsSolutions-ECS2',
        reason:
          'Environment variables for non-sensitive configuration are acceptable. Secrets use ECS secrets integration.',
      },
      {
        id: 'AwsSolutions-ECS4',
        reason: 'Container Insights enabled for monitoring',
      },
      {
        id: 'AwsSolutions-ELB2',
        reason: enableAlbAccessLogs
          ? 'ALB access logs enabled in production.'
          : 'ALB access logs intentionally disabled in non-production to reduce log volume and storage costs.',
      },
      {
        id: 'AwsSolutions-EC23',
        reason:
          'Assets API ALB is internal-only; ingress restricted to shared ECS security group on port 80.',
      },
    ];

    if (!enableCloudFrontAccessLogs) {
      stackSuppressions.push({
        id: 'AwsSolutions-CFR3',
        reason:
          'CloudFront access logging is intentionally disabled in non-production to reduce log volume and storage costs.',
      });
    }

    NagSuppressions.addStackSuppressions(this, stackSuppressions);

    // ==================== Stack Outputs ====================
    new cdk.CfnOutput(this, 'AssetsDatabaseEndpointOutput', {
      value: this.assetsDatabase.dbInstanceEndpointAddress,
      description: 'Assets database endpoint',
      exportName: `${prefix}-database-endpoint`,
    });

    new cdk.CfnOutput(this, 'AssetsBucketNameOutput', {
      value: this.assetsBucket.bucketName,
      description: 'Assets S3 bucket name',
      exportName: `${prefix}-bucket-name`,
    });

    new cdk.CfnOutput(this, 'AssetsCdnDomainOutput', {
      value: resolvedPublicCdnDomain,
      description: 'Assets CloudFront domain',
      exportName: `${prefix}-cdn-domain`,
    });

    new cdk.CfnOutput(this, 'AssetEventBusNameOutput', {
      value: assetEventBus.eventBusName,
      description: 'Asset processing EventBridge bus name',
      exportName: `${prefix}-event-bus-name`,
    });

    new cdk.CfnOutput(this, 'ThumbnailGeneratorFunctionOutput', {
      value: thumbnailGeneratorFunction.functionArn,
      description: 'Thumbnail generator Lambda function ARN',
      exportName: `${prefix}-thumbnail-generator-arn`,
    });

    new cdk.CfnOutput(this, 'AIAnalyzerFunctionOutput', {
      value: aiAnalyzerFunction.functionArn,
      description: 'AI analyzer Lambda function ARN',
      exportName: `${prefix}-ai-analyzer-arn`,
    });
  }
}

function normalizeDomainName(domainName?: string): string | undefined {
  if (!domainName) {
    return undefined;
  }

  return domainName.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function deriveHostedZoneName(domainName: string): string {
  const trimmed = domainName.replace(/\.$/, '');
  const parts = trimmed.split('.');
  if (parts.length <= 2) {
    return trimmed;
  }

  return parts.slice(-2).join('.');
}

function deriveRecordName(domainName: string, zoneName: string): string | undefined {
  const normalizedDomain = domainName.replace(/\.$/, '');
  const normalizedZone = zoneName.replace(/\.$/, '');

  if (normalizedDomain === normalizedZone) {
    return undefined;
  }

  if (normalizedDomain.endsWith(`.${normalizedZone}`)) {
    const relative = normalizedDomain.slice(0, normalizedDomain.length - normalizedZone.length - 1);
    return relative.length > 0 ? relative : undefined;
  }

  return normalizedDomain;
}
