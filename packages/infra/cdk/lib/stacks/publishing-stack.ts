/**
 * Publishing Stack - Content Publishing Microservices
 * Groups publisher, retry-handler, dlq-processor, and campaign-event-dlq-processor services
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NagSuppressions } from 'cdk-nag';
import * as path from 'path';
import { ParameterNames, type Environment } from '@postolio/service-parameters';
import { OAuthConfig } from '../utils/oauth-config';

export interface PublishingStackProps extends cdk.StackProps, OAuthConfig {
  environment: 'dev' | 'staging' | 'prod';
  alertEmail?: string;
}

export class PublishingStack extends cdk.Stack {
  public readonly publishingQueue: sqs.Queue;
  public readonly retryQueue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: PublishingStackProps) {
    super(scope, id, props);

    const { environment, alertEmail } = props;
    const prefix = `postolio-${environment}-publishing`;

    // Import schedules table name from Scheduling stack via SSM Parameter Store
    const schedulesTableName = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/scheduling/schedules-table-name`
    );
    const schedulesTableArn = cdk.Stack.of(this).formatArn({
      service: 'dynamodb',
      resource: 'table',
      resourceName: schedulesTableName,
    });

    // Import Token Service ARN for Function URL IAM auth
    const tokenServiceArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/auth/token-service-arn`
    );

    // ==================== Internal DynamoDB Tables ====================
    // Retry attempts tracking table (per schedule)
    const retryTable = new dynamodb.Table(this, 'RetryQueueTable', {
      tableName: `${prefix}-retry-info`,
      partitionKey: { name: 'scheduleId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'attemptNumber', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // DLQ processing state table
    const dlqStateTable = new dynamodb.Table(this, 'DlqStateTable', {
      tableName: `${prefix}-dlq-state`,
      partitionKey: { name: 'messageId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    dlqStateTable.addGlobalSecondaryIndex({
      indexName: 'by-dlq-status',
      partitionKey: { name: 'dlqName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    });

    // ==================== VPC Configuration ====================
    // Import VPC and security groups from Foundation stack
    let vpc: ec2.IVpc | undefined;
    let lambdaSecurityGroup: ec2.ISecurityGroup | undefined;
    let vpcConfig: ec2.SubnetSelection | undefined;

    try {
      const vpcId = ssm.StringParameter.valueFromLookup(this, `/postolio/${environment}/vpc/id`);
      const lambdaSecurityGroupId = ssm.StringParameter.valueFromLookup(
        this,
        `/postolio/${environment}/security-groups/lambda`
      );
      const hasFoundation = vpcId && lambdaSecurityGroupId;
      if (hasFoundation) {
        vpc = ec2.Vpc.fromLookup(this, 'FoundationVpc', { vpcId });
        lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
          this,
          'LambdaSecurityGroup',
          lambdaSecurityGroupId
        );
        vpcConfig = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
        console.log(`Using VPC configuration from Foundation stack for environment ${environment}`);
      }
    } catch (error) {
      console.log(
        `VPC import skipped or failed; Lambdas will run without VPC for ${environment}. Error: ${error}`
      );
    }

    // ==================== KMS Encryption Key ====================
    // Try to import shared encryption key from Foundation stack
    let encryptionKey: kms.IKey;

    const kmsKeyArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/kms/key-arn`
    );
    encryptionKey = kms.Key.fromKeyArn(this, 'FoundationEncryptionKey', kmsKeyArn);
    console.log(`Using shared encryption key from Foundation stack for environment ${environment}`);

    // ==================== SQS Queues ====================
    // Main dead letter queue for all publishing failures
    this.deadLetterQueue = new sqs.Queue(this, 'PublishingDLQ', {
      queueName: `${prefix}-dlq`,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.minutes(15),
    });

    // Add SSL requirement policy to PublishingDLQ
    this.deadLetterQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sqs:*'],
        resources: [this.deadLetterQueue.queueArn],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    // Campaign-specific dead letter queue
    const campaignDLQ = new sqs.Queue(this, 'CampaignEventDLQ', {
      queueName: `${prefix}-campaign-dlq`,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.minutes(15),
    });

    // Add SSL requirement policy to CampaignEventDLQ
    campaignDLQ.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sqs:*'],
        resources: [campaignDLQ.queueArn],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    // Retry queue for failed publishing attempts
    this.retryQueue = new sqs.Queue(this, 'RetryQueue', {
      queueName: `${prefix}-retry`,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(5),
      retentionPeriod: cdk.Duration.hours(12),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // Add SSL requirement policy to RetryQueue
    this.retryQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sqs:*'],
        resources: [this.retryQueue.queueArn],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    // Main publishing queue
    this.publishingQueue = new sqs.Queue(this, 'PublishingQueue', {
      queueName: `${prefix}-main`,
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(10),
      retentionPeriod: cdk.Duration.hours(6),
      deadLetterQueue: {
        queue: this.retryQueue,
        maxReceiveCount: 2,
      },
    });

    // Add SSL requirement policy to PublishingQueue
    this.publishingQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sqs:*'],
        resources: [this.publishingQueue.queueArn],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    // ==================== EventBridge Buses ====================
    // Use Scheduling EventBus for cross-service status events (status-sync listens there)
    const schedulingEventBusName = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/scheduling/event-bus-name`
    );
    const schedulingEventBusArn = cdk.Stack.of(this).formatArn({
      service: 'events',
      resource: 'event-bus',
      resourceName: schedulingEventBusName,
    });

    // Import images bucket for generating media URLs
    const imagesBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/s3/images-bucket`
    );
    // Import CDN domain (custom domain or default distribution domain)
    const imagesCdnDomain = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/cdn/images-domain`
    );
    // Import video bucket name for presigning video URLs
    const videoBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/scheduling/video-bucket-name`
    );
    // Import Auth stack Audit Logs table name for audit logging
    const auditTableName = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/auth/audit-table-name`
    );
    const auditTableArn = auditTableName
      ? cdk.Stack.of(this).formatArn({
          service: 'dynamodb',
          resource: 'table',
          resourceName: auditTableName,
        })
      : undefined;
    // Retain local publishing bus (optional) for future use
    const publishingEventBus = new events.EventBus(this, 'PublishingEventBus', {
      eventBusName: `${prefix}-events`,
    });

    // ==================== SNS Topic for Alerts ====================
    const alertTopic = new sns.Topic(this, 'PublishingAlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: `Publishing Stack Alerts - ${environment}`,
    });

    // Add SSL requirement policy to SNS topic
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

    // ==================== Lambda Function Shared Role ====================
    const publishingLambdaRole = new iam.Role(this, 'PublishingLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        PublishingPolicy: new iam.PolicyDocument({
          statements: [
            // DynamoDB access to Schedules table
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [
                schedulesTableArn,
                `${schedulesTableArn}/index/*`,
                ...(auditTableArn ? [auditTableArn] : []),
              ],
            }),
            // DynamoDB access to Retry info table
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
              ],
              resources: [retryTable.tableArn],
            }),
            // DynamoDB access to DLQ state table (with GSI)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:BatchGetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
              ],
              resources: [dlqStateTable.tableArn, `${dlqStateTable.tableArn}/index/*`],
            }),
            // SQS permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sqs:SendMessage',
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
                'sqs:ChangeMessageVisibility',
              ],
              resources: [
                this.publishingQueue.queueArn,
                this.retryQueue.queueArn,
                this.deadLetterQueue.queueArn,
                campaignDLQ.queueArn,
              ],
            }),
            // EventBridge permissions (allow put to Scheduling bus for status events)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['events:PutEvents'],
              resources: [schedulingEventBusArn],
            }),
            // EventBridge Scheduler permissions for retry scheduling and cleanup
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
            // Allow passing the Scheduler target role when creating schedules
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
            // SSM permissions to read auth and scheduling parameters
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter', 'ssm:GetParameters'],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/*`,
              ],
            }),
            // Allow invoking Token Service Function URL if ARN is available
            ...(tokenServiceArn
              ? [
                  new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['lambda:InvokeFunction', 'lambda:InvokeFunctionUrl'],
                    resources: [tokenServiceArn],
                  }),
                ]
              : []),
            // SNS permissions for notifications
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sns:Publish'],
              resources: [alertTopic.topicArn],
            }),
            // CloudWatch custom metrics for DLQ Processor
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['cloudwatch:PutMetricData'],
              resources: ['*'],
              conditions: {
                StringEquals: { 'cloudwatch:namespace': 'Postolio/DLQ' },
              },
            }),
          ],
        }),
      },
    });

    // ==================== Lambda Functions ====================

    // 1. Publisher Function
    const publisherFunction = new lambdaNodejs.NodejsFunction(this, 'PublisherFunction', {
      functionName: `${prefix}-publisher`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/publisher/src/index.ts'),
      depsLockFilePath: path.join(__dirname, '../../../../../pnpm-lock.yaml'),
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
      role: publishingLambdaRole,
      vpc: vpc,
      vpcSubnets: vpcConfig,
      securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'publisher',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        // AWS_REGION is automatically provided by Lambda runtime
        SCHEDULES_TABLE: schedulesTableName,
        SCHEDULES_TABLE_SCHEDULE_INDEX: 'ScheduleIdIndex',
        RETRY_QUEUE_TABLE: retryTable.tableName,
        DLQ_STATE_TABLE_NAME: dlqStateTable.tableName,
        PUBLISHING_QUEUE_URL: this.publishingQueue.queueUrl,
        RETRY_QUEUE_URL: this.retryQueue.queueUrl,
        DLQ_URL: this.deadLetterQueue.queueUrl,
        EVENT_BUS_NAME: schedulingEventBusName,
        KMS_KEY_ID: encryptionKey.keyId,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
        // Buckets for generating pre-signed URLs
        S3_IMAGES_BUCKET: imagesBucketName,
        VIDEO_BUCKET: videoBucketName,
        // Public CDN domain used for image URLs (no auth)
        IMAGES_CDN_DOMAIN: imagesCdnDomain,
        ...(auditTableName ? { AUDIT_LOG_TABLE: auditTableName } : {}),
        // OAuth configuration
        FACEBOOK_APP_ID: props.facebookAppId || '',
        FACEBOOK_APP_SECRET: props.facebookAppSecret || '',
        INSTAGRAM_APP_ID: props.instagramAppId || '',
        INSTAGRAM_APP_SECRET: props.instagramAppSecret || '',
        LINKEDIN_CLIENT_ID: props.linkedinClientId || '',
        LINKEDIN_CLIENT_SECRET: props.linkedinClientSecret || '',
        TIKTOK_CLIENT_KEY: props.tiktokClientKey || '',
        TIKTOK_CLIENT_SECRET: props.tiktokClientSecret || '',
      },
      logGroup: logs.LogGroup.fromLogGroupName(
        this,
        'PublisherLogGroup',
        `/aws/lambda/${prefix}-publisher`
      ),
      tracing: lambda.Tracing.ACTIVE,
    });

    // Route schedule.due events from the Scheduling EventBus to the Publisher Lambda
    const schedulingBusImport = events.EventBus.fromEventBusName(
      this,
      'SchedulingBusImport',
      schedulingEventBusName
    );
    const scheduleDueRule = new events.Rule(this, 'ScheduleDueRule', {
      eventBus: schedulingBusImport,
      eventPattern: {
        source: ['postolio.scheduling'],
        detailType: ['schedule.due'],
      },
    });
    scheduleDueRule.addTarget(new targets.LambdaFunction(publisherFunction));

    // Role assumed by EventBridge Scheduler (used by Retry Handler) to PutEvents to Scheduling bus
    const retrySchedulerPutEventsRole = new iam.Role(this, 'RetrySchedulerPutEventsRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Role for EventBridge Scheduler (retries) to PutEvents to Scheduling bus',
    });
    retrySchedulerPutEventsRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [schedulingEventBusArn],
      })
    );

    // 2. Retry Handler Function
    const retryHandlerFunction = new lambdaNodejs.NodejsFunction(this, 'RetryHandlerFunction', {
      functionName: `${prefix}-retry-handler`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/retry-handler/src/index.ts'),
      depsLockFilePath: path.join(__dirname, '../../../../../pnpm-lock.yaml'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: publishingLambdaRole,
      vpc: vpc,
      vpcSubnets: vpcConfig,
      securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'retry-handler',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        // AWS_REGION is automatically provided by Lambda runtime
        SCHEDULES_TABLE: schedulesTableName,
        SCHEDULES_TABLE_SCHEDULE_INDEX: 'ScheduleIdIndex',
        RETRY_QUEUE_TABLE: retryTable.tableName,
        PUBLISHING_QUEUE_URL: this.publishingQueue.queueUrl,
        RETRY_QUEUE_URL: this.retryQueue.queueUrl,
        DLQ_URL: this.deadLetterQueue.queueUrl,
        EVENT_BUS_NAME: schedulingEventBusName,
        KMS_KEY_ID: encryptionKey.keyId,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
        ...(auditTableName ? { AUDIT_LOG_TABLE: auditTableName } : {}),
        // Scheduler integration for retries (via EventBridge events)
        SCHEDULER_GROUP_NAME: 'default',
        SCHEDULING_EVENT_BUS_ARN: schedulingEventBusArn,
        // Use local role in this stack to PutEvents to Scheduling bus
        // (created below as retrySchedulerPutEventsRole)
        // NOTE: We avoid SSM lookups to keep first-time deploy order clean.
        SCHEDULER_EVENTS_ROLE_ARN: '', // placeholder, set after role creation via override below
      },
      logGroup: logs.LogGroup.fromLogGroupName(
        this,
        'RetryHandlerLogGroup',
        `/aws/lambda/${prefix}-retry-handler`
      ),
      tracing: lambda.Tracing.ACTIVE,
    });
    // Inject the role ARN now that it exists
    retryHandlerFunction.addEnvironment(
      'SCHEDULER_EVENTS_ROLE_ARN',
      retrySchedulerPutEventsRole.roleArn
    );

    // 3. DLQ Processor Function
    const dlqProcessorFunction = new lambdaNodejs.NodejsFunction(this, 'DLQProcessorFunction', {
      functionName: `${prefix}-dlq-processor`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/dlq-processor/src/index.ts'),
      depsLockFilePath: path.join(__dirname, '../../../../../pnpm-lock.yaml'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: publishingLambdaRole,
      vpc: vpc,
      vpcSubnets: vpcConfig,
      securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'dlq-processor',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        // AWS_REGION is automatically provided by Lambda runtime
        SCHEDULES_TABLE: schedulesTableName,
        SCHEDULES_TABLE_SCHEDULE_INDEX: 'ScheduleIdIndex',
        DLQ_STATE_TABLE_NAME: dlqStateTable.tableName,
        DLQ_URL: this.deadLetterQueue.queueUrl,
        RETRY_QUEUE_URL: this.retryQueue.queueUrl,
        PUBLISHING_QUEUE_URL: this.publishingQueue.queueUrl,
        EVENT_BUS_NAME: schedulingEventBusName,
        KMS_KEY_ID: encryptionKey.keyId,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
        ...(auditTableName ? { AUDIT_LOG_TABLE: auditTableName } : {}),
      },
      logGroup: logs.LogGroup.fromLogGroupName(
        this,
        'DLQProcessorLogGroup',
        `/aws/lambda/${prefix}-dlq-processor`
      ),
      tracing: lambda.Tracing.ACTIVE,
    });

    // 4. Campaign Event DLQ Processor Function
    const campaignDLQProcessorFunction = new lambdaNodejs.NodejsFunction(
      this,
      'CampaignDLQProcessorFunction',
      {
        functionName: `${prefix}-campaign-dlq-processor`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        entry: path.join(
          __dirname,
          '../../../../services/campaign-event-dlq-processor/src/index.ts'
        ),
        depsLockFilePath: path.join(__dirname, '../../../../../pnpm-lock.yaml'),
        timeout: cdk.Duration.minutes(5),
        memorySize: 512,
        role: publishingLambdaRole,
        vpc: vpc,
        securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
        environment: {
          NODE_ENV: environment,
          SERVICE_NAME: 'campaign-event-dlq-processor',
          ENVIRONMENT: environment,
          LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
          // AWS_REGION is automatically provided by Lambda runtime
          SCHEDULES_TABLE: schedulesTableName,
          CAMPAIGN_DLQ_URL: campaignDLQ.queueUrl,
          EVENT_BUS_NAME: publishingEventBus.eventBusName,
          KMS_KEY_ID: encryptionKey.keyId,
          ALERT_TOPIC_ARN: alertTopic.topicArn,
        },
        logGroup: logs.LogGroup.fromLogGroupName(
          this,
          'CampaignDLQProcessorLogGroup',
          `/aws/lambda/${prefix}-campaign-dlq-processor`
        ),
        tracing: lambda.Tracing.ACTIVE,
      }
    );

    // ==================== Event Sources ====================
    // Connect publisher to main publishing queue
    publisherFunction.addEventSource(
      new SqsEventSource(this.publishingQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    // Connect retry handler to retry queue
    retryHandlerFunction.addEventSource(
      new SqsEventSource(this.retryQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(10),
      })
    );

    // Connect DLQ processor to dead letter queue
    dlqProcessorFunction.addEventSource(
      new SqsEventSource(this.deadLetterQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(30),
      })
    );

    // Connect campaign DLQ processor to campaign dead letter queue
    campaignDLQProcessorFunction.addEventSource(
      new SqsEventSource(campaignDLQ, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(30),
      })
    );

    // ==================== CloudWatch Monitoring ====================
    const functions = [
      { func: publisherFunction, name: 'publisher' },
      { func: retryHandlerFunction, name: 'retry-handler' },
      { func: dlqProcessorFunction, name: 'dlq-processor' },
      { func: campaignDLQProcessorFunction, name: 'campaign-dlq-processor' },
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

      // Duration alarm for publisher (most critical)
      if (name === 'publisher') {
        const durationMetric = func.metricDuration({
          period: cdk.Duration.minutes(5),
        });

        const durationAlarm = new cloudwatch.Alarm(this, 'PublisherDurationAlarm', {
          alarmName: `${prefix}-publisher-duration`,
          metric: durationMetric,
          threshold: 300000, // 5 minutes
          evaluationPeriods: 3,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: 'Publisher service duration too high',
        });

        durationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));
      }
    });

    // Queue depth monitoring
    const queueDepthAlarm = new cloudwatch.Alarm(this, 'PublishingQueueDepthAlarm', {
      alarmName: `${prefix}-queue-depth`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfVisibleMessages',
        dimensionsMap: {
          QueueName: this.publishingQueue.queueName,
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1000,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Publishing queue depth too high',
    });

    queueDepthAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // ==================== SSM Parameters ====================
    new ssm.StringParameter(this, 'PublishingQueueUrlParameter', {
      parameterName: `/postolio/${environment}/publishing/queue-url`,
      stringValue: this.publishingQueue.queueUrl,
      description: 'Publishing Queue URL',
    });

    new ssm.StringParameter(this, 'RetryQueueUrlParameter', {
      parameterName: `/postolio/${environment}/publishing/retry-queue-url`,
      stringValue: this.retryQueue.queueUrl,
      description: 'Retry Queue URL',
    });

    new ssm.StringParameter(this, 'PublishingDLQUrlParameter', {
      parameterName: `/postolio/${environment}/publishing/dlq-url`,
      stringValue: this.deadLetterQueue.queueUrl,
      description: 'Publishing Dead Letter Queue URL',
    });

    new ssm.StringParameter(this, 'PublishingEventBusNameParameter', {
      parameterName: `/postolio/${environment}/publishing/event-bus-name`,
      stringValue: publishingEventBus.eventBusName,
      description: 'Publishing EventBridge Bus Name',
    });

    // ==================== Stack Outputs ====================
    new cdk.CfnOutput(this, 'PublishingQueueUrl', {
      value: this.publishingQueue.queueUrl,
      description: 'Publishing Queue URL',
      exportName: `${prefix}-publishing-queue-url`,
    });

    new cdk.CfnOutput(this, 'RetryQueueUrl', {
      value: this.retryQueue.queueUrl,
      description: 'Retry Queue URL',
      exportName: `${prefix}-retry-queue-url`,
    });

    new cdk.CfnOutput(this, 'PublishingDLQUrl', {
      value: this.deadLetterQueue.queueUrl,
      description: 'Publishing Dead Letter Queue URL',
      exportName: `${prefix}-dlq-url`,
    });

    new cdk.CfnOutput(this, 'PublishingEventBusName', {
      value: publishingEventBus.eventBusName,
      description: 'Publishing EventBridge Bus Name',
      exportName: `${prefix}-event-bus-name`,
    });

    // ==================== CDK NAG Suppressions ====================
    NagSuppressions.addResourceSuppressions(
      publishingLambdaRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Lambda execution role requires broad permissions for SQS and EventBridge operations',
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

    // Suppress CampaignEventDLQ not having a DLQ (it IS a DLQ itself)
    NagSuppressions.addResourceSuppressions(campaignDLQ, [
      {
        id: 'AwsSolutions-SQS3',
        reason:
          'This queue IS a dead letter queue for campaign events - it does not need its own DLQ',
      },
    ]);

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
