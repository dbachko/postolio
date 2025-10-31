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
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import * as path from 'path';

export interface AssetLibraryStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  ecsSecurityGroup: ec2.ISecurityGroup;
  encryptionKey: kms.IKey;
  openaiApiKey?: string;
}

export class AssetLibraryStack extends cdk.Stack {
  public readonly assetsDatabase: rds.IDatabaseInstance;
  public readonly assetsBucket: s3.IBucket;
  public readonly assetsCdn: cloudfront.IDistribution;
  public readonly databaseSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: AssetLibraryStackProps) {
    super(scope, id, props);

    const { environment, vpc, lambdaSecurityGroup, ecsSecurityGroup, encryptionKey, openaiApiKey } =
      props;
    const prefix = `postolio-${environment}-assets`;

    // ==================== Security Groups ====================
    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'AssetsDatabaseSecurityGroup', {
      vpc,
      description: 'Security group for Assets RDS database',
      allowAllOutbound: false,
    });

    // Allow Lambda and ECS to connect to assets database
    this.databaseSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda functions to connect to assets database'
    );

    this.databaseSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS tasks to connect to assets database'
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

    // ==================== CloudFront Distribution ====================
    this.assetsCdn = new cloudfront.Distribution(this, 'AssetsDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.assetsBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      comment: `Assets CDN for ${environment} environment`,
      enableLogging: true,
      priceClass:
        environment === 'prod'
          ? cloudfront.PriceClass.PRICE_CLASS_ALL
          : cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // Export CDN domain to SSM
    new ssm.StringParameter(this, 'AssetsCdnDomain', {
      parameterName: `/postolio/${environment}/assets/cdn-domain`,
      stringValue: this.assetsCdn.distributionDomainName,
      description: 'Assets CloudFront domain',
    });

    new ssm.StringParameter(this, 'AssetsCdnDistributionId', {
      parameterName: `/postolio/${environment}/assets/cdn-distribution-id`,
      stringValue: this.assetsCdn.distributionId,
      description: 'Assets CloudFront distribution ID',
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
      // Import existing secret from main stack
      const openaiSecretArn = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/openai-secret-arn`
      );
      openaiSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'OpenAIApiKey',
        openaiSecretArn
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
        depsLockFilePath: path.join(__dirname, '../../../../../pnpm-lock.yaml'),
        timeout: cdk.Duration.minutes(5),
        memorySize: 2048, // Sharp requires more memory for image processing
        role: assetProcessingRole,
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        securityGroups: [lambdaSecurityGroup],
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
        },
        bundling: {
          // Sharp requires special handling for native modules
          nodeModules: ['sharp', '@prisma/client'],
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            afterBundling: (inputDir: string, outputDir: string) => [
              // Ensure Sharp is compiled for Lambda (linux-x64)
              `cd ${outputDir}`,
              `npm install --arch=x64 --platform=linux sharp`,
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
      depsLockFilePath: path.join(__dirname, '../../../../../pnpm-lock.yaml'),
      timeout: cdk.Duration.minutes(3),
      memorySize: 1024,
      role: assetProcessingRole,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
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
        CDN_DOMAIN: this.assetsCdn.distributionDomainName,
      },
      bundling: {
        nodeModules: ['@prisma/client', 'openai'],
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
        prefix: 'assets/', // Only trigger for assets in the assets/ folder
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

    // ==================== CDK Nag Suppressions ====================
    NagSuppressions.addStackSuppressions(this, [
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
          'AWS managed policies (AWSLambdaBasicExecutionRole, AWSLambdaVPCAccessExecutionRole) are appropriate for Lambda functions',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Wildcard permissions required for Lambda to access S3 objects with dynamic keys and database connections',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Using latest Lambda runtime (Node.js 22) as specified in package configurations',
      },
    ]);

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
      value: this.assetsCdn.distributionDomainName,
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
