/**
 * Scheduling Stack - Content Scheduling Microservices
 * Groups schedule-management, schedule-cleanup, and status-sync services
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NagSuppressions } from 'cdk-nag';
import * as path from 'path';
import { ParameterNames, type Environment } from '@postolio/service-parameters';

export interface SchedulingStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  alertEmail?: string;
}

export class SchedulingStack extends cdk.Stack {
  public readonly schedulesTable: dynamodb.Table;
  public readonly videoBucket: s3.Bucket;
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: SchedulingStackProps) {
    super(scope, id, props);

    const { environment, alertEmail } = props;
    const prefix = `postolio-${environment}-scheduling`;

    // ==================== VPC Configuration ====================
    // VPC configuration for database access - lookup from database secret
    let vpc: ec2.IVpc | undefined;
    let dbSecurityGroup: ec2.ISecurityGroup | undefined;
    let lambdaSecurityGroup: ec2.ISecurityGroup | undefined;

    const vpcId = 'vpc-03e5d38b2feb71ed8'; // Must be concrete for Vpc.fromLookup()
    const dbSecurityGroupId = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/database/security-group-id`
    );

    if (vpcId && dbSecurityGroupId) {
      vpc = ec2.Vpc.fromLookup(this, 'DatabaseVpc', {
        vpcId: vpcId,
      });

      dbSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        'DatabaseSecurityGroup',
        dbSecurityGroupId
      );

      lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
        vpc: vpc,
        description: 'Security group for Lambda functions accessing RDS Proxy',
        allowAllOutbound: true,
      });

      dbSecurityGroup.addIngressRule(
        lambdaSecurityGroup,
        ec2.Port.tcp(5432),
        'Allow Lambda functions to connect to RDS Proxy'
      );
    }

    // ==================== KMS Encryption Key ====================
    const encryptionKey = new kms.Key(this, 'SchedulingEncryptionKey', {
      alias: `alias/${prefix}-encryption`,
      description: 'KMS key for Scheduling services encryption',
      enableKeyRotation: true,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== DynamoDB Tables ====================
    this.schedulesTable = new dynamodb.Table(this, 'SchedulesTable', {
      tableName: `${prefix}-schedules`,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,
      pointInTimeRecovery: environment === 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for status and time-based queries
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'scheduledTime',
        type: dynamodb.AttributeType.STRING,
      },
    });

    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: 'TimeIndex',
      partitionKey: {
        name: 'datePartition',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'scheduledTime',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // ==================== S3 Bucket for Video Processing ====================
    this.videoBucket = new s3.Bucket(this, 'VideoBucket', {
      bucketName: `${prefix}-videos`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      lifecycleRules: [
        {
          id: 'temp-uploads-cleanup',
          prefix: 'temp/',
          expiration: cdk.Duration.days(1),
        },
        {
          id: 'processed-videos-cleanup',
          prefix: 'processed/',
          expiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== EventBridge Custom Bus ====================
    this.eventBus = new events.EventBus(this, 'SchedulingEventBus', {
      eventBusName: `${prefix}-events`,
    });

    // ==================== SQS Queues ====================
    const deadLetterQueue = new sqs.Queue(this, 'SchedulingDLQ', {
      queueName: `${prefix}-dlq`,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      messageRetentionPeriod: cdk.Duration.days(14),
    });

    const scheduleProcessingQueue = new sqs.Queue(this, 'ScheduleProcessingQueue', {
      queueName: `${prefix}-processing`,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // ==================== SNS Topic for Alerts ====================
    const alertTopic = new sns.Topic(this, 'SchedulingAlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: `Scheduling Stack Alerts - ${environment}`,
    });

    if (alertEmail) {
      alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));
    }

    // ==================== Lambda Function Shared Role ====================
    const schedulingLambdaRole = new iam.Role(this, 'SchedulingLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        SchedulingPolicy: new iam.PolicyDocument({
          statements: [
            // DynamoDB permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [
                this.schedulesTable.tableArn,
                `${this.schedulesTable.tableArn}/index/*`,
              ],
            }),
            // S3 permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
              ],
              resources: [`${this.videoBucket.bucketArn}/*`],
            }),
            // EventBridge permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'events:PutEvents',
              ],
              resources: [this.eventBus.eventBusArn],
            }),
            // SQS permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sqs:SendMessage',
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ],
              resources: [
                scheduleProcessingQueue.queueArn,
                deadLetterQueue.queueArn,
              ],
            }),
            // KMS permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Encrypt',
                'kms:Decrypt',
                'kms:ReEncrypt*',
                'kms:GenerateDataKey',
                'kms:DescribeKey',
              ],
              resources: [encryptionKey.keyArn],
            }),
            // SSM permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:GetParameter',
                'ssm:GetParameters',
              ],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/*`,
              ],
            }),
          ],
        }),
      },
    });

    // ==================== Lambda Functions ====================

    // 1. Schedule Management Function
    const scheduleManagementFunction = new lambdaNodejs.NodejsFunction(this, 'ScheduleManagementFunction', {
      functionName: `${prefix}-schedule-management`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lib/lambdas/schedule-management/index.ts'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      role: schedulingLambdaRole,
      vpc: vpc,
      securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'schedule-management',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        AWS_REGION: this.region,
        SCHEDULES_TABLE_NAME: this.schedulesTable.tableName,
        VIDEO_BUCKET_NAME: this.videoBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        PROCESSING_QUEUE_URL: scheduleProcessingQueue.queueUrl,
        KMS_KEY_ID: encryptionKey.keyId,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
      tracing: lambda.Tracing.ACTIVE,
    });

    // 2. Schedule Cleanup Function
    const scheduleCleanupFunction = new lambdaNodejs.NodejsFunction(this, 'ScheduleCleanupFunction', {
      functionName: `${prefix}-schedule-cleanup`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lib/lambdas/schedule-cleanup/index.ts'),
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      role: schedulingLambdaRole,
      vpc: vpc,
      securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'schedule-cleanup',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        AWS_REGION: this.region,
        SCHEDULES_TABLE_NAME: this.schedulesTable.tableName,
        VIDEO_BUCKET_NAME: this.videoBucket.bucketName,
        KMS_KEY_ID: encryptionKey.keyId,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
      tracing: lambda.Tracing.ACTIVE,
    });

    // 3. Status Sync Function
    const statusSyncFunction = new lambdaNodejs.NodejsFunction(this, 'StatusSyncFunction', {
      functionName: `${prefix}-status-sync`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lib/lambdas/status-sync/index.ts'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: schedulingLambdaRole,
      vpc: vpc,
      securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'status-sync',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        AWS_REGION: this.region,
        SCHEDULES_TABLE_NAME: this.schedulesTable.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: encryptionKey.keyId,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
      tracing: lambda.Tracing.ACTIVE,
    });

    // ==================== Event Sources ====================
    // Connect status sync to SQS queue
    statusSyncFunction.addEventSource(new SqsEventSource(scheduleProcessingQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
    }));

    // ==================== EventBridge Rules ====================
    // Daily cleanup schedule
    const cleanupRule = new events.Rule(this, 'ScheduleCleanupRule', {
      ruleName: `${prefix}-cleanup-rule`,
      description: 'Trigger schedule cleanup daily',
      schedule: events.Schedule.cron({
        hour: '2',
        minute: '0',
      }),
      eventBus: this.eventBus,
    });

    cleanupRule.addTarget(new targets.LambdaFunction(scheduleCleanupFunction));

    // ==================== Function URLs ====================
    const scheduleManagementUrl = scheduleManagementFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowCredentials: true,
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    // ==================== CloudWatch Monitoring ====================
    const functions = [
      { func: scheduleManagementFunction, name: 'schedule-management' },
      { func: scheduleCleanupFunction, name: 'schedule-cleanup' },
      { func: statusSyncFunction, name: 'status-sync' },
    ];

    functions.forEach(({ func, name }) => {
      // Error rate alarm
      const errorMetric = func.metricErrors({
        period: cdk.Duration.minutes(5),
      });

      const errorAlarm = new cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
        alarmName: `${prefix}-${name}-errors`,
        metric: errorMetric,
        threshold: 5,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${name} service error rate too high`,
      });

      errorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));
    });

    // ==================== SSM Parameters ====================
    new ssm.StringParameter(this, 'ScheduleManagementUrlParameter', {
      parameterName: ParameterNames.scheduleManagementUrl(environment as Environment),
      stringValue: scheduleManagementUrl.url,
      description: 'Schedule Management Function URL',
    });

    new ssm.StringParameter(this, 'SchedulesTableNameParameter', {
      parameterName: ParameterNames.schedulesTableName(environment as Environment),
      stringValue: this.schedulesTable.tableName,
      description: 'Schedules DynamoDB Table Name',
    });

    new ssm.StringParameter(this, 'VideoBucketNameParameter', {
      parameterName: ParameterNames.videoBucketName(environment as Environment),
      stringValue: this.videoBucket.bucketName,
      description: 'Video Processing S3 Bucket Name',
    });

    new ssm.StringParameter(this, 'SchedulingEventBusNameParameter', {
      parameterName: ParameterNames.schedulingEventBusName(environment as Environment),
      stringValue: this.eventBus.eventBusName,
      description: 'Scheduling EventBridge Bus Name',
    });

    // ==================== Stack Outputs ====================
    new cdk.CfnOutput(this, 'ScheduleManagementUrl', {
      value: scheduleManagementUrl.url,
      description: 'Schedule Management Function URL',
      exportName: `${prefix}-schedule-management-url`,
    });

    new cdk.CfnOutput(this, 'SchedulesTableName', {
      value: this.schedulesTable.tableName,
      description: 'Schedules DynamoDB Table Name',
      exportName: `${prefix}-schedules-table-name`,
    });

    new cdk.CfnOutput(this, 'VideoBucketName', {
      value: this.videoBucket.bucketName,
      description: 'Video Processing S3 Bucket Name',
      exportName: `${prefix}-video-bucket-name`,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'Scheduling EventBridge Bus Name',
      exportName: `${prefix}-event-bus-name`,
    });

    // ==================== CDK NAG Suppressions ====================
    NagSuppressions.addResourceSuppressions(
      schedulingLambdaRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Lambda execution role requires broad permissions for DynamoDB and S3 operations',
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-L1',
          reason: 'Using latest stable Node.js runtime for Lambda functions',
        },
      ],
      true
    );
  }
}