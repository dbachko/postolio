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
    // Import VPC and security groups from Foundation stack
    let vpc: ec2.IVpc | undefined;
    let lambdaSecurityGroup: ec2.ISecurityGroup | undefined;
    let vpcConfig: ec2.SubnetSelection | undefined;

    try {
      // Import VPC from Foundation stack
      const vpcId = ssm.StringParameter.valueFromLookup(this, `/postolio/${environment}/vpc/id`);

      // Import Lambda security group from Foundation stack
      const lambdaSecurityGroupId = ssm.StringParameter.valueFromLookup(
        this,
        `/postolio/${environment}/security-groups/lambda`
      );

      // Check if Foundation resources are available (not dummy values)
      const hasFoundationResources =
        vpcId &&
        lambdaSecurityGroupId &&
        !vpcId.startsWith('dummy-value-for-') &&
        !lambdaSecurityGroupId.startsWith('dummy-value-for-');

      if (hasFoundationResources) {
        vpc = ec2.Vpc.fromLookup(this, 'FoundationVpc', {
          vpcId: vpcId,
        });

        lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
          this,
          'LambdaSecurityGroup',
          lambdaSecurityGroupId
        );

        vpcConfig = {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        };

        console.log(`Using VPC configuration from Foundation stack for environment ${environment}`);
      } else {
        console.log(
          `Foundation VPC not available for environment ${environment} - Lambda functions will run without VPC`
        );
      }
    } catch (error) {
      console.log(`Error accessing Foundation VPC configuration: ${error}`);
    }

    // ==================== KMS Encryption Key ====================
    // Try to import shared encryption key from Foundation stack
    let encryptionKey: kms.IKey;

    try {
      const kmsKeyArn = ssm.StringParameter.valueFromLookup(
        this,
        `/postolio/${environment}/kms/key-arn`
      );

      if (kmsKeyArn && !kmsKeyArn.startsWith('dummy-value-for-')) {
        encryptionKey = kms.Key.fromKeyArn(this, 'FoundationEncryptionKey', kmsKeyArn);
        console.log(
          `Using shared encryption key from Foundation stack for environment ${environment}`
        );
      } else {
        throw new Error('Foundation encryption key not available');
      }
    } catch (error) {
      // Fallback to creating own key if Foundation key not available
      encryptionKey = new kms.Key(this, 'SchedulingEncryptionKey', {
        alias: `alias/${prefix}-encryption`,
        description: 'KMS key for Scheduling services encryption',
        enableKeyRotation: true,
        removalPolicy:
          environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      });
      console.log(
        `Created dedicated encryption key for Scheduling stack in environment ${environment}`
      );
    }

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
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: environment === 'prod',
      },
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for status queries (status + scheduledAt)
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'scheduledAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Add GSI for scheduleId lookups
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: 'ScheduleIdIndex',
      partitionKey: {
        name: 'scheduleId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'scheduledAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // (No additional status-related GSI; standardized on StatusIndex)

    // Add GSI for brand-based queries
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: 'BrandIndex',
      partitionKey: {
        name: 'gsi1pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi1sk',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // ==================== S3 Bucket for Video Processing ====================
    // Create server access logging bucket
    const logBucket = new s3.Bucket(this, 'VideoBucketAccessLogs', {
      bucketName: `${prefix}-videos-logs`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: 'delete-old-logs',
          expiration: cdk.Duration.days(90),
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Add bucket policy to require SSL for log bucket
    logBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [logBucket.bucketArn, `${logBucket.bucketArn}/*`],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    this.videoBucket = new s3.Bucket(this, 'VideoBucket', {
      bucketName: `${prefix}-videos`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: 'access-logs/',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
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

    // Add bucket policy to require SSL
    this.videoBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [this.videoBucket.bucketArn, `${this.videoBucket.bucketArn}/*`],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    // ==================== EventBridge Custom Bus ====================
    this.eventBus = new events.EventBus(this, 'SchedulingEventBus', {
      eventBusName: `${prefix}-events`,
    });

    // ==================== SQS Queues ====================
    const deadLetterQueue = new sqs.Queue(this, 'SchedulingDLQ', {
      queueName: `${prefix}-dlq`,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Add queue policy to require SSL for DLQ
    deadLetterQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sqs:*'],
        resources: [deadLetterQueue.queueArn],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    const scheduleProcessingQueue = new sqs.Queue(this, 'ScheduleProcessingQueue', {
      queueName: `${prefix}-processing`,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // Add queue policy to require SSL for processing queue
    scheduleProcessingQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sqs:*'],
        resources: [scheduleProcessingQueue.queueArn],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    // ==================== SNS Topic for Alerts ====================
    const alertTopic = new sns.Topic(this, 'SchedulingAlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: `Scheduling Stack Alerts - ${environment}`,
    });

    // Add topic policy to require SSL
    alertTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [alertTopic.topicArn],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    if (alertEmail) {
      alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));
    }

    // ==================== Cross-Stack Parameters (from Publishing) ====================
    // These parameters are created by the Publishing stack and are used at runtime to create schedules
    let publisherLambdaArnParam: string | undefined;
    let schedulerRoleArnParam: string | undefined;
    let databaseSecretArnParam: string | undefined;
    try {
      publisherLambdaArnParam = ssm.StringParameter.valueFromLookup(
        this,
        `/postolio/${environment}/publishing/publisher-lambda-arn`
      );
      schedulerRoleArnParam = ssm.StringParameter.valueFromLookup(
        this,
        `/postolio/${environment}/publishing/scheduler-role-arn`
      );
      // Use deploy-time resolution to avoid dummy placeholder values
      databaseSecretArnParam = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/database/secret-arn`
      );
    } catch (e) {
      console.log(
        'Publishing SSM parameters not found at synth time; proceeding without env injection'
      );
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
              resources: [this.schedulesTable.tableArn, `${this.schedulesTable.tableArn}/index/*`],
            }),
            // S3 permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
              resources: [`${this.videoBucket.bucketArn}/*`],
            }),
            // EventBridge permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['events:PutEvents'],
              resources: [this.eventBus.eventBusArn],
            }),
            // EventBridge Scheduler permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'scheduler:CreateSchedule',
                'scheduler:UpdateSchedule',
                'scheduler:DeleteSchedule',
                'scheduler:GetSchedule',
                'scheduler:ListSchedules',
              ],
              resources: [
                `arn:aws:scheduler:${this.region}:${this.account}:schedule/*`,
                `arn:aws:scheduler:${this.region}:${this.account}:schedule-group/*`,
              ],
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
              resources: [scheduleProcessingQueue.queueArn, deadLetterQueue.queueArn],
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
              actions: ['ssm:GetParameter', 'ssm:GetParameters'],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/*`,
              ],
            }),
            // Secrets Manager permission to read DB credentials
            ...(databaseSecretArnParam
              ? [
                  new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['secretsmanager:GetSecretValue'],
                    resources: [databaseSecretArnParam],
                  }),
                ]
              : []),
            // Allow passing the Scheduler target role (from Publishing stack) if available
            ...(schedulerRoleArnParam
              ? [
                  new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['iam:PassRole'],
                    resources: [schedulerRoleArnParam],
                  }),
                ]
              : []),
          ],
        }),
      },
    });

    // ==================== Lambda Functions ====================

    // 1. Schedule Management Function
    const scheduleManagementFunction = new lambdaNodejs.NodejsFunction(
      this,
      'ScheduleManagementFunction',
      {
        functionName: `${prefix}-schedule-management`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        entry: path.join(__dirname, '../../../../services/schedule-management/src/index.ts'),
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        role: schedulingLambdaRole,
        vpc: vpc,
        vpcSubnets: vpcConfig,
        securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
        environment: {
          NODE_ENV: environment,
          SERVICE_NAME: 'schedule-management',
          ENVIRONMENT: environment,
          LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
          // AWS_REGION is automatically provided by Lambda runtime
          SCHEDULES_TABLE: this.schedulesTable.tableName,
          // Use standardized StatusIndex (status + scheduledAt)
          SCHEDULES_TABLE_STATUS_INDEX: 'StatusIndex',
          SCHEDULES_TABLE_SCHEDULE_INDEX: 'ScheduleIdIndex',
          SCHEDULES_TABLE_BRAND_INDEX: 'BrandIndex',
          VIDEO_BUCKET_NAME: this.videoBucket.bucketName,
          EVENT_BUS_NAME: this.eventBus.eventBusName,
          PROCESSING_QUEUE_URL: scheduleProcessingQueue.queueUrl,
          KMS_KEY_ID: encryptionKey.keyId,
          // Use default scheduler group unless overridden at runtime
          SCHEDULER_GROUP_NAME: 'default',
          ...(publisherLambdaArnParam ? { PUBLISHER_LAMBDA_ARN: publisherLambdaArnParam } : {}),
          ...(schedulerRoleArnParam ? { SCHEDULER_ROLE_ARN: schedulerRoleArnParam } : {}),
        },
        logGroup: logs.LogGroup.fromLogGroupName(
          this,
          'ScheduleManagementLogGroup',
          `/aws/lambda/${prefix}-schedule-management`
        ),
        tracing: lambda.Tracing.ACTIVE,
      }
    );

    // 2. Schedule Cleanup Function
    const scheduleCleanupFunction = new lambdaNodejs.NodejsFunction(
      this,
      'ScheduleCleanupFunction',
      {
        functionName: `${prefix}-schedule-cleanup`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        entry: path.join(__dirname, '../../../../services/schedule-cleanup/src/index.ts'),
        timeout: cdk.Duration.minutes(10),
        memorySize: 512,
        role: schedulingLambdaRole,
        vpc: vpc,
        vpcSubnets: vpcConfig,
        securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
        environment: {
          NODE_ENV: environment,
          SERVICE_NAME: 'schedule-cleanup',
          ENVIRONMENT: environment,
          LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
          // AWS_REGION is automatically provided by Lambda runtime
          SCHEDULES_TABLE: this.schedulesTable.tableName,
          SCHEDULES_TABLE_SCHEDULE_INDEX: 'ScheduleIdIndex',
          VIDEO_BUCKET_NAME: this.videoBucket.bucketName,
          KMS_KEY_ID: encryptionKey.keyId,
          SCHEDULER_GROUP_NAME: 'default',
        },
        logGroup: logs.LogGroup.fromLogGroupName(
          this,
          'ScheduleCleanupLogGroup',
          `/aws/lambda/${prefix}-schedule-cleanup`
        ),
        tracing: lambda.Tracing.ACTIVE,
      }
    );

    // 3. Status Sync Function
    const statusSyncFunction = new lambdaNodejs.NodejsFunction(this, 'StatusSyncFunction', {
      functionName: `${prefix}-status-sync`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/status-sync/src/index.ts'),
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
        // AWS_REGION is automatically provided by Lambda runtime
        SCHEDULES_TABLE: this.schedulesTable.tableName,
        SCHEDULES_TABLE_STATUS_INDEX: 'StatusIndex',
        SCHEDULES_TABLE_SCHEDULE_INDEX: 'ScheduleIdIndex',
        SCHEDULES_TABLE_BRAND_INDEX: 'BrandIndex',
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: encryptionKey.keyId,
        ...(databaseSecretArnParam ? { DB_SECRET_ARN: databaseSecretArnParam } : {}),
      },
      logGroup: logs.LogGroup.fromLogGroupName(
        this,
        'StatusSyncLogGroup',
        `/aws/lambda/${prefix}-status-sync`
      ),
      tracing: lambda.Tracing.ACTIVE,
    });

    // 4. DB Inspector (dev-only helper)
    const dbInspectorFunction = new lambdaNodejs.NodejsFunction(this, 'DBInspectorFunction', {
      functionName: `${prefix}-db-inspector`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/db-inspector/src/index.ts'),
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      role: schedulingLambdaRole,
      vpc: vpc,
      vpcSubnets: vpcConfig,
      securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'db-inspector',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
      },
      logGroup: logs.LogGroup.fromLogGroupName(
        this,
        'DBInspectorLogGroup',
        `/aws/lambda/${prefix}-db-inspector`
      ),
      tracing: lambda.Tracing.ACTIVE,
    });

    const inspectorUrl = dbInspectorFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: { allowedOrigins: ['*'] },
    });

    new cdk.CfnOutput(this, 'DBInspectorUrl', {
      value: inspectorUrl.url,
      description: 'Dev-only DB inspector URL',
      exportName: `${prefix}-db-inspector-url`,
    });

    // ==================== Event Sources ====================
    // Connect status sync to SQS queue
    statusSyncFunction.addEventSource(
      new SqsEventSource(scheduleProcessingQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    // ==================== EventBridge Rules ====================
    // Daily cleanup schedule
    const cleanupRule = new events.Rule(this, 'ScheduleCleanupRule', {
      ruleName: `${prefix}-cleanup-rule`,
      description: 'Trigger schedule cleanup daily',
      schedule: events.Schedule.cron({
        hour: '2',
        minute: '0',
      }),
      // Note: Scheduled rules use default EventBridge bus, not custom eventBus
    });

    cleanupRule.addTarget(new targets.LambdaFunction(scheduleCleanupFunction));

    // Route platform publishing events to Status Sync
    const publishingEventsRule = new events.Rule(this, 'PublishingEventsRule', {
      ruleName: `${prefix}-publishing-events-rule`,
      description: 'Forward publishing outcomes to status-sync for DB updates',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['postolio.platform'],
        detailType: ['post.published', 'post.failed', 'post.skipped'],
      },
    });
    publishingEventsRule.addTarget(new targets.LambdaFunction(statusSyncFunction));

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
      parameterName: `/postolio/${environment}/scheduling/schedule-management-url`,
      stringValue: scheduleManagementUrl.url,
      description: 'Schedule Management Function URL',
    });

    new ssm.StringParameter(this, 'SchedulesTableNameParameter', {
      parameterName: `/postolio/${environment}/scheduling/schedules-table-name`,
      stringValue: this.schedulesTable.tableName,
      description: 'Schedules DynamoDB Table Name',
    });

    new ssm.StringParameter(this, 'VideoBucketNameParameter', {
      parameterName: `/postolio/${environment}/scheduling/video-bucket-name`,
      stringValue: this.videoBucket.bucketName,
      description: 'Video Processing S3 Bucket Name',
    });

    new ssm.StringParameter(this, 'SchedulingEventBusNameParameter', {
      parameterName: `/postolio/${environment}/scheduling/event-bus-name`,
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
        {
          id: 'AwsSolutions-IAM4',
          reason: 'AWS managed policies for Lambda execution are standard and secure',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
          ],
        },
      ],
      true
    );

    // Suppress DynamoDB PITR requirement for non-prod environments
    if (environment !== 'prod') {
      NagSuppressions.addResourceSuppressions(this.schedulesTable, [
        {
          id: 'AwsSolutions-DDB3',
          reason: 'Point-in-time recovery is only enabled for production to reduce costs',
        },
      ]);
    }

    // Suppress log retention function IAM issues (created automatically by CDK)
    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Log retention function uses AWS managed policy - standard CDK behavior',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Log retention function requires wildcard permissions - standard CDK behavior',
          appliesTo: ['Resource::*'],
        },
        {
          id: 'AwsSolutions-L1',
          reason: 'Using latest stable Node.js runtime for Lambda functions',
        },
      ],
      true
    );
  }
}
