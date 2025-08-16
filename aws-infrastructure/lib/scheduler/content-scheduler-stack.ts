import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface ContentSchedulerStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  alertEmail?: string;
}

export class ContentSchedulerStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly schedulesTable: dynamodb.Table;
  public readonly videoBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ContentSchedulerStackProps) {
    super(scope, id, props);

    const { environment, alertEmail } = props;
    const prefix = `postolio-scheduler-${environment}`;

    // ==================== DynamoDB Tables ====================
    
    // Schedules Table
    this.schedulesTable = new dynamodb.Table(this, 'SchedulesTable', {
      tableName: `${prefix}-schedules`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.ON_DEMAND,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI for querying by brand
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by status
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scheduledAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Retry Queue Table
    const retryQueueTable = new dynamodb.Table(this, 'RetryQueueTable', {
      tableName: `${prefix}-retry-queue`,
      partitionKey: { name: 'scheduleId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'attemptNumber', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.ON_DEMAND,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Audit Log Table (GDPR Compliance)
    const auditLogTable = new dynamodb.Table(this, 'AuditLogTable', {
      tableName: `${prefix}-audit-log`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.ON_DEMAND,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== S3 Buckets ====================
    
    // Video Storage Bucket
    this.videoBucket = new s3.Bucket(this, 'VideoBucket', {
      bucketName: `${prefix}-videos`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [
        {
          id: 'delete-incomplete-multipart-uploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: 'intelligent-tiering',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(0),
            },
          ],
        },
        {
          id: 'gdpr-compliance-deletion',
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'], // Restrict in production
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
    });

    // ==================== Secrets ====================
    
    const platformCredentials = new secretsmanager.Secret(this, 'PlatformCredentials', {
      secretName: `${prefix}-platform-credentials`,
      description: 'Social media platform API credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          instagram: { clientId: '', clientSecret: '', accessToken: '' },
          tiktok: { clientKey: '', clientSecret: '', accessToken: '' },
          youtube: { apiKey: '', clientId: '', clientSecret: '' },
        }),
        generateStringKey: 'temp',
      },
    });

    // ==================== Lambda Functions ====================
    
    // Shared Lambda environment variables
    const lambdaEnvironment = {
      ENVIRONMENT: environment,
      SCHEDULES_TABLE: this.schedulesTable.tableName,
      RETRY_QUEUE_TABLE: retryQueueTable.tableName,
      AUDIT_LOG_TABLE: auditLogTable.tableName,
      VIDEO_BUCKET: this.videoBucket.bucketName,
      PLATFORM_CREDENTIALS_SECRET: platformCredentials.secretArn,
      MAIN_APP_API_URL: process.env.MAIN_APP_API_URL || 'http://localhost:3000',
    };

    // Schedule Management Lambda
    const scheduleManagementLambda = new lambda.Function(this, 'ScheduleManagementLambda', {
      functionName: `${prefix}-schedule-management`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require('aws-sdk');
        const dynamodb = new AWS.DynamoDB.DocumentClient();
        const eventbridge = new AWS.EventBridge();
        
        exports.handler = async (event) => {
          console.log('Schedule Management Request:', JSON.stringify(event));
          
          const { httpMethod, path, body } = event;
          const scheduleId = path?.split('/').pop();
          
          try {
            switch (httpMethod) {
              case 'POST':
                return await createSchedule(JSON.parse(body));
              case 'GET':
                return await getSchedule(scheduleId);
              case 'PUT':
                return await updateSchedule(scheduleId, JSON.parse(body));
              case 'DELETE':
                return await deleteSchedule(scheduleId);
              default:
                return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
            }
          } catch (error) {
            console.error('Error:', error);
            return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
          }
        };
        
        async function createSchedule(data) {
          const scheduleId = 'SCH_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          const scheduledAt = new Date(data.scheduledAt).toISOString();
          
          // Store in DynamoDB
          await dynamodb.put({
            TableName: process.env.SCHEDULES_TABLE,
            Item: {
              pk: 'SCHEDULE#' + scheduleId,
              sk: 'METADATA',
              scheduleId,
              brandId: data.brandId,
              contentId: data.contentId,
              platform: data.platform,
              scheduledAt,
              status: 'scheduled',
              contentType: data.contentType || 'image',
              videoUrl: data.videoUrl,
              caption: data.caption,
              hashtags: data.hashtags,
              gsi1pk: 'BRAND#' + data.brandId,
              gsi1sk: scheduledAt,
              ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
              createdAt: new Date().toISOString(),
            }
          }).promise();
          
          // Create EventBridge schedule
          await eventbridge.putRule({
            Name: 'schedule-' + scheduleId,
            ScheduleExpression: 'at(' + scheduledAt + ')',
            State: 'ENABLED',
            Description: 'Content publishing schedule for ' + scheduleId,
          }).promise();
          
          return {
            statusCode: 201,
            body: JSON.stringify({ scheduleId, message: 'Schedule created successfully' })
          };
        }
        
        async function getSchedule(scheduleId) {
          const result = await dynamodb.get({
            TableName: process.env.SCHEDULES_TABLE,
            Key: {
              pk: 'SCHEDULE#' + scheduleId,
              sk: 'METADATA'
            }
          }).promise();
          
          return {
            statusCode: 200,
            body: JSON.stringify(result.Item || {})
          };
        }
        
        async function updateSchedule(scheduleId, data) {
          // Implementation for update
          return { statusCode: 200, body: JSON.stringify({ message: 'Updated' }) };
        }
        
        async function deleteSchedule(scheduleId) {
          // Delete from DynamoDB
          await dynamodb.delete({
            TableName: process.env.SCHEDULES_TABLE,
            Key: {
              pk: 'SCHEDULE#' + scheduleId,
              sk: 'METADATA'
            }
          }).promise();
          
          // Delete EventBridge schedule
          await eventbridge.deleteRule({
            Name: 'schedule-' + scheduleId
          }).promise();
          
          return { statusCode: 204, body: '' };
        }
      `),
      timeout: cdk.Duration.seconds(30),
      environment: lambdaEnvironment,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Publisher Lambda (triggered by EventBridge)
    const publisherLambda = new lambda.Function(this, 'PublisherLambda', {
      functionName: `${prefix}-publisher`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require('aws-sdk');
        const dynamodb = new AWS.DynamoDB.DocumentClient();
        const secretsManager = new AWS.SecretsManager();
        
        exports.handler = async (event) => {
          console.log('Publisher triggered:', JSON.stringify(event));
          
          const { scheduleId } = event;
          
          try {
            // Get schedule details
            const schedule = await getSchedule(scheduleId);
            
            // Get platform credentials
            const credentials = await getPlatformCredentials(schedule.platform);
            
            // Publish content
            const result = await publishContent(schedule, credentials);
            
            // Update schedule status
            await updateScheduleStatus(scheduleId, 'published', result);
            
            return { statusCode: 200, body: JSON.stringify(result) };
          } catch (error) {
            console.error('Publishing failed:', error);
            await handlePublishingError(scheduleId, error);
            throw error;
          }
        };
        
        async function getSchedule(scheduleId) {
          const result = await dynamodb.get({
            TableName: process.env.SCHEDULES_TABLE,
            Key: {
              pk: 'SCHEDULE#' + scheduleId,
              sk: 'METADATA'
            }
          }).promise();
          
          if (!result.Item) {
            throw new Error('Schedule not found: ' + scheduleId);
          }
          
          return result.Item;
        }
        
        async function getPlatformCredentials(platform) {
          const secret = await secretsManager.getSecretValue({
            SecretId: process.env.PLATFORM_CREDENTIALS_SECRET
          }).promise();
          
          const credentials = JSON.parse(secret.SecretString);
          return credentials[platform];
        }
        
        async function publishContent(schedule, credentials) {
          // Platform-specific publishing logic
          switch (schedule.platform) {
            case 'instagram':
              return await publishToInstagram(schedule, credentials);
            case 'tiktok':
              return await publishToTikTok(schedule, credentials);
            default:
              throw new Error('Unsupported platform: ' + schedule.platform);
          }
        }
        
        async function publishToInstagram(schedule, credentials) {
          // Instagram Graph API implementation
          console.log('Publishing to Instagram:', schedule.contentId);
          // Actual implementation would go here
          return { postId: 'ig_' + Date.now(), permalink: 'https://instagram.com/p/test' };
        }
        
        async function publishToTikTok(schedule, credentials) {
          // TikTok API implementation
          console.log('Publishing to TikTok:', schedule.contentId);
          return { postId: 'tt_' + Date.now(), permalink: 'https://tiktok.com/@user/video/test' };
        }
        
        async function updateScheduleStatus(scheduleId, status, result) {
          await dynamodb.update({
            TableName: process.env.SCHEDULES_TABLE,
            Key: {
              pk: 'SCHEDULE#' + scheduleId,
              sk: 'METADATA'
            },
            UpdateExpression: 'SET #status = :status, publishedAt = :now, publishResult = :result',
            ExpressionAttributeNames: {
              '#status': 'status'
            },
            ExpressionAttributeValues: {
              ':status': status,
              ':now': new Date().toISOString(),
              ':result': result
            }
          }).promise();
        }
        
        async function handlePublishingError(scheduleId, error) {
          // Add to retry queue
          await dynamodb.put({
            TableName: process.env.RETRY_QUEUE_TABLE,
            Item: {
              scheduleId,
              attemptNumber: 1,
              error: error.message,
              timestamp: new Date().toISOString(),
              ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // Retry for 24 hours
            }
          }).promise();
        }
      `),
      timeout: cdk.Duration.minutes(5),
      environment: lambdaEnvironment,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Retry Handler Lambda
    const retryHandlerLambda = new lambda.Function(this, 'RetryHandlerLambda', {
      functionName: `${prefix}-retry-handler`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require('aws-sdk');
        const lambda = new AWS.Lambda();
        
        exports.handler = async (event) => {
          console.log('Retry handler triggered');
          
          // Process retry queue
          const retries = await getRetryQueue();
          
          for (const retry of retries) {
            if (shouldRetry(retry)) {
              await retryPublishing(retry);
            } else {
              await markAsFailed(retry);
            }
          }
          
          return { statusCode: 200, body: 'Retry processing complete' };
        };
        
        async function getRetryQueue() {
          // Get items from retry queue
          return [];
        }
        
        function shouldRetry(retry) {
          // Exponential backoff logic
          const maxAttempts = 5;
          return retry.attemptNumber < maxAttempts;
        }
        
        async function retryPublishing(retry) {
          // Invoke publisher lambda
          await lambda.invoke({
            FunctionName: process.env.PUBLISHER_LAMBDA_ARN,
            InvocationType: 'Event',
            Payload: JSON.stringify({ scheduleId: retry.scheduleId })
          }).promise();
        }
        
        async function markAsFailed(retry) {
          // Update status to failed
          console.log('Marking as failed:', retry.scheduleId);
        }
      `),
      timeout: cdk.Duration.minutes(1),
      environment: {
        ...lambdaEnvironment,
        PUBLISHER_LAMBDA_ARN: publisherLambda.functionArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions
    this.schedulesTable.grantReadWriteData(scheduleManagementLambda);
    this.schedulesTable.grantReadWriteData(publisherLambda);
    retryQueueTable.grantReadWriteData(publisherLambda);
    retryQueueTable.grantReadWriteData(retryHandlerLambda);
    auditLogTable.grantWriteData(scheduleManagementLambda);
    auditLogTable.grantWriteData(publisherLambda);
    this.videoBucket.grantReadWrite(publisherLambda);
    platformCredentials.grantRead(publisherLambda);
    publisherLambda.grantInvoke(retryHandlerLambda);

    // Grant EventBridge permissions to Lambda
    scheduleManagementLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutRule', 'events:DeleteRule', 'events:PutTargets', 'events:RemoveTargets'],
      resources: ['*'],
    }));

    // ==================== API Gateway ====================
    
    this.api = new apigateway.RestApi(this, 'SchedulerApi', {
      restApiName: `${prefix}-api`,
      description: 'Content Scheduler Microservice API',
      deployOptions: {
        stageName: environment,
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // API Resources
    const schedulesResource = this.api.root.addResource('schedules');
    const scheduleResource = schedulesResource.addResource('{scheduleId}');

    // API Methods
    schedulesResource.addMethod('POST', new apigateway.LambdaIntegration(scheduleManagementLambda));
    schedulesResource.addMethod('GET', new apigateway.LambdaIntegration(scheduleManagementLambda));
    scheduleResource.addMethod('GET', new apigateway.LambdaIntegration(scheduleManagementLambda));
    scheduleResource.addMethod('PUT', new apigateway.LambdaIntegration(scheduleManagementLambda));
    scheduleResource.addMethod('DELETE', new apigateway.LambdaIntegration(scheduleManagementLambda));

    // ==================== EventBridge Rules ====================
    
    // Retry processing rule (runs every 5 minutes)
    const retryRule = new events.Rule(this, 'RetryProcessingRule', {
      ruleName: `${prefix}-retry-processing`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: 'Process retry queue for failed publishing attempts',
    });
    retryRule.addTarget(new targets.LambdaFunction(retryHandlerLambda));

    // ==================== CloudWatch Alarms ====================
    
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${prefix}-alarms`,
      displayName: 'Content Scheduler Alarms',
    });

    if (alertEmail) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));
    }

    // Publishing failure alarm
    new cloudwatch.Alarm(this, 'PublishingFailureAlarm', {
      alarmName: `${prefix}-publishing-failures`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: {
          FunctionName: publisherLambda.functionName,
        },
      }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // High retry rate alarm
    new cloudwatch.Alarm(this, 'HighRetryRateAlarm', {
      alarmName: `${prefix}-high-retry-rate`,
      metric: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'RetryCount',
        statistic: 'Sum',
      }),
      threshold: 100,
      evaluationPeriods: 1,
      period: cdk.Duration.minutes(5),
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ==================== Outputs ====================
    
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'Content Scheduler API endpoint',
      exportName: `${prefix}-api-endpoint`,
    });

    new cdk.CfnOutput(this, 'SchedulesTableName', {
      value: this.schedulesTable.tableName,
      description: 'DynamoDB Schedules table name',
      exportName: `${prefix}-schedules-table`,
    });

    new cdk.CfnOutput(this, 'VideoBucketName', {
      value: this.videoBucket.bucketName,
      description: 'S3 Video bucket name',
      exportName: `${prefix}-video-bucket`,
    });
  }
}