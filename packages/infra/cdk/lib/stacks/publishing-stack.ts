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
      encryptionKey = new kms.Key(this, 'PublishingEncryptionKey', {
        alias: `alias/${prefix}-encryption`,
        description: 'KMS key for Publishing services encryption',
        enableKeyRotation: true,
        removalPolicy:
          environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      });
      console.log(
        `Created dedicated encryption key for Publishing stack in environment ${environment}`
      );
    }

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

    // ==================== EventBridge Custom Bus ====================
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
            // EventBridge permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['events:PutEvents'],
              resources: [publishingEventBus.eventBusArn],
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
        PUBLISHING_QUEUE_URL: this.publishingQueue.queueUrl,
        RETRY_QUEUE_URL: this.retryQueue.queueUrl,
        DLQ_URL: this.deadLetterQueue.queueUrl,
        EVENT_BUS_NAME: publishingEventBus.eventBusName,
        KMS_KEY_ID: encryptionKey.keyId,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
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
      logRetention: logs.RetentionDays.TWO_WEEKS,
      tracing: lambda.Tracing.ACTIVE,
    });

    // 2. Retry Handler Function
    const retryHandlerFunction = new lambdaNodejs.NodejsFunction(this, 'RetryHandlerFunction', {
      functionName: `${prefix}-retry-handler`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/retry-handler/src/index.ts'),
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
        PUBLISHING_QUEUE_URL: this.publishingQueue.queueUrl,
        RETRY_QUEUE_URL: this.retryQueue.queueUrl,
        DLQ_URL: this.deadLetterQueue.queueUrl,
        EVENT_BUS_NAME: publishingEventBus.eventBusName,
        KMS_KEY_ID: encryptionKey.keyId,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
      tracing: lambda.Tracing.ACTIVE,
    });

    // 3. DLQ Processor Function
    const dlqProcessorFunction = new lambdaNodejs.NodejsFunction(this, 'DLQProcessorFunction', {
      functionName: `${prefix}-dlq-processor`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/dlq-processor/src/index.ts'),
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
        DLQ_URL: this.deadLetterQueue.queueUrl,
        EVENT_BUS_NAME: publishingEventBus.eventBusName,
        KMS_KEY_ID: encryptionKey.keyId,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
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
          CAMPAIGN_DLQ_URL: campaignDLQ.queueUrl,
          EVENT_BUS_NAME: publishingEventBus.eventBusName,
          KMS_KEY_ID: encryptionKey.keyId,
          ALERT_TOPIC_ARN: alertTopic.topicArn,
        },
        logRetention: logs.RetentionDays.TWO_WEEKS,
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

    // ==================== EventBridge Rules ====================
    // Scheduled retry processing
    const retryRule = new events.Rule(this, 'RetryProcessingRule', {
      ruleName: `${prefix}-retry-rule`,
      description: 'Trigger retry processing periodically',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      // Note: Scheduled rules use default EventBridge bus, not custom eventBus
    });

    retryRule.addTarget(new targets.LambdaFunction(retryHandlerFunction));

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
