/**
 * CloudWatch Dashboards Configuration
 * Comprehensive monitoring dashboards for all microservices
 */

import * as cdk from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as events from 'aws-cdk-lib/aws-events'
import { Construct } from 'constructs'

export interface DashboardConfig {
  environment: string
  tokenServiceLambda?: lambda.Function
  schedulerServiceLambda?: lambda.Function
  publisherLambdas?: {
    instagram?: lambda.Function
    facebook?: lambda.Function
    linkedin?: lambda.Function
    tiktok?: lambda.Function
  }
  dlqProcessorLambda?: lambda.Function
  tokenTable?: dynamodb.Table
  scheduleTable?: dynamodb.Table
  sagaStateTable?: dynamodb.Table
  circuitBreakerTable?: dynamodb.Table
  dlqStateTable?: dynamodb.Table
  publisherQueues?: {
    instagram?: sqs.Queue
    facebook?: sqs.Queue
    linkedin?: sqs.Queue
    tiktok?: sqs.Queue
  }
  publisherDLQ?: sqs.Queue
  eventBus?: events.EventBus
}

export class CloudWatchDashboards extends Construct {
  public readonly mainDashboard: cloudwatch.Dashboard
  public readonly lambdaDashboard: cloudwatch.Dashboard
  public readonly dynamodbDashboard: cloudwatch.Dashboard
  public readonly sqsDashboard: cloudwatch.Dashboard
  
  constructor(scope: Construct, id: string, props: DashboardConfig) {
    super(scope, id)
    
    const { environment } = props
    
    // ==================== Main Overview Dashboard ====================
    this.mainDashboard = new cloudwatch.Dashboard(this, 'MainDashboard', {
      dashboardName: `Postolio-Overview-${environment}`,
      widgets: [
        [
          // System Health Widget
          new cloudwatch.GraphWidget({
            title: 'System Health Overview',
            width: 12,
            height: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/Lambda',
                metricName: 'Errors',
                statistic: 'Sum',
                dimensionsMap: {
                  FunctionName: props.tokenServiceLambda?.functionName || 'N/A',
                },
                label: 'Token Service Errors',
                color: cloudwatch.Color.RED,
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/Lambda',
                metricName: 'Throttles',
                statistic: 'Sum',
                label: 'Lambda Throttles',
                color: cloudwatch.Color.ORANGE,
              }),
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'AWS/Lambda',
                metricName: 'Duration',
                statistic: 'Average',
                label: 'Average Duration',
                color: cloudwatch.Color.BLUE,
              }),
            ],
          }),
          
          // Publishing Success Rate Widget
          new cloudwatch.SingleValueWidget({
            title: 'Publishing Success Rate',
            width: 6,
            height: 6,
            metrics: [
              new cloudwatch.Metric({
                namespace: 'Postolio/Publishing',
                metricName: 'SuccessRate',
                statistic: 'Average',
                period: cdk.Duration.hours(1),
              }),
            ],
          }),
          
          // Active Campaigns Widget
          new cloudwatch.SingleValueWidget({
            title: 'Active Campaigns',
            width: 6,
            height: 6,
            metrics: [
              new cloudwatch.Metric({
                namespace: 'Postolio/Campaigns',
                metricName: 'ActiveCampaigns',
                statistic: 'Maximum',
                period: cdk.Duration.minutes(5),
              }),
            ],
          }),
        ],
        
        // Second Row
        [
          // Event Processing Widget
          new cloudwatch.GraphWidget({
            title: 'Event Processing',
            width: 12,
            height: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/Events',
                metricName: 'SuccessfulRuleMatches',
                dimensionsMap: {
                  EventBusName: props.eventBus?.eventBusName || 'default',
                },
                statistic: 'Sum',
                label: 'Successful Events',
                color: cloudwatch.Color.GREEN,
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/Events',
                metricName: 'FailedInvocations',
                dimensionsMap: {
                  EventBusName: props.eventBus?.eventBusName || 'default',
                },
                statistic: 'Sum',
                label: 'Failed Events',
                color: cloudwatch.Color.RED,
              }),
            ],
          }),
          
          // DLQ Status Widget
          new cloudwatch.GraphWidget({
            title: 'Dead Letter Queue Status',
            width: 12,
            height: 6,
            left: props.publisherDLQ ? [
              props.publisherDLQ.metricApproximateNumberOfMessagesVisible({
                label: 'Messages in DLQ',
                color: cloudwatch.Color.RED,
              }),
              props.publisherDLQ.metricApproximateAgeOfOldestMessage({
                label: 'Oldest Message Age',
                color: cloudwatch.Color.ORANGE,
                statistic: 'Maximum',
              }),
            ] : [],
          }),
        ],
        
        // Third Row - Platform-specific metrics
        [
          // Instagram Publishing
          new cloudwatch.GraphWidget({
            title: 'Instagram Publishing',
            width: 6,
            height: 6,
            left: props.publisherLambdas?.instagram ? [
              props.publisherLambdas.instagram.metricInvocations({
                label: 'Invocations',
                color: cloudwatch.Color.BLUE,
              }),
              props.publisherLambdas.instagram.metricErrors({
                label: 'Errors',
                color: cloudwatch.Color.RED,
              }),
            ] : [],
          }),
          
          // Facebook Publishing
          new cloudwatch.GraphWidget({
            title: 'Facebook Publishing',
            width: 6,
            height: 6,
            left: props.publisherLambdas?.facebook ? [
              props.publisherLambdas.facebook.metricInvocations({
                label: 'Invocations',
                color: cloudwatch.Color.BLUE,
              }),
              props.publisherLambdas.facebook.metricErrors({
                label: 'Errors',
                color: cloudwatch.Color.RED,
              }),
            ] : [],
          }),
          
          // LinkedIn Publishing
          new cloudwatch.GraphWidget({
            title: 'LinkedIn Publishing',
            width: 6,
            height: 6,
            left: props.publisherLambdas?.linkedin ? [
              props.publisherLambdas.linkedin.metricInvocations({
                label: 'Invocations',
                color: cloudwatch.Color.BLUE,
              }),
              props.publisherLambdas.linkedin.metricErrors({
                label: 'Errors',
                color: cloudwatch.Color.RED,
              }),
            ] : [],
          }),
          
          // TikTok Publishing
          new cloudwatch.GraphWidget({
            title: 'TikTok Publishing',
            width: 6,
            height: 6,
            left: props.publisherLambdas?.tiktok ? [
              props.publisherLambdas.tiktok.metricInvocations({
                label: 'Invocations',
                color: cloudwatch.Color.BLUE,
              }),
              props.publisherLambdas.tiktok.metricErrors({
                label: 'Errors',
                color: cloudwatch.Color.RED,
              }),
            ] : [],
          }),
        ],
      ],
    })
    
    // ==================== Lambda Dashboard ====================
    this.lambdaDashboard = new cloudwatch.Dashboard(this, 'LambdaDashboard', {
      dashboardName: `Postolio-Lambda-${environment}`,
      widgets: [
        [
          // Lambda Performance Overview
          new cloudwatch.GraphWidget({
            title: 'Lambda Performance Overview',
            width: 24,
            height: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/Lambda',
                metricName: 'ConcurrentExecutions',
                statistic: 'Maximum',
                label: 'Concurrent Executions',
                color: cloudwatch.Color.BLUE,
              }),
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'AWS/Lambda',
                metricName: 'Duration',
                statistic: 'Average',
                label: 'Average Duration (ms)',
                color: cloudwatch.Color.GREEN,
              }),
            ],
          }),
        ],
        [
          // Token Service Performance
          props.tokenServiceLambda ? new cloudwatch.GraphWidget({
            title: 'Token Service Performance',
            width: 8,
            height: 6,
            left: [
              props.tokenServiceLambda.metricInvocations({
                label: 'Invocations',
                color: cloudwatch.Color.BLUE,
              }),
              props.tokenServiceLambda.metricErrors({
                label: 'Errors',
                color: cloudwatch.Color.RED,
              }),
              props.tokenServiceLambda.metricThrottles({
                label: 'Throttles',
                color: cloudwatch.Color.ORANGE,
              }),
            ],
            right: [
              props.tokenServiceLambda.metricDuration({
                label: 'Duration (ms)',
                statistic: 'Average',
                color: cloudwatch.Color.GREEN,
              }),
            ],
          }) : new cloudwatch.TextWidget({
            markdown: '**Token Service**: Not configured',
            width: 8,
            height: 6,
          }),
          
          // Scheduler Service Performance
          props.schedulerServiceLambda ? new cloudwatch.GraphWidget({
            title: 'Scheduler Service Performance',
            width: 8,
            height: 6,
            left: [
              props.schedulerServiceLambda.metricInvocations({
                label: 'Invocations',
                color: cloudwatch.Color.BLUE,
              }),
              props.schedulerServiceLambda.metricErrors({
                label: 'Errors',
                color: cloudwatch.Color.RED,
              }),
            ],
            right: [
              props.schedulerServiceLambda.metricDuration({
                label: 'Duration (ms)',
                statistic: 'Average',
                color: cloudwatch.Color.GREEN,
              }),
            ],
          }) : new cloudwatch.TextWidget({
            markdown: '**Scheduler Service**: Not configured',
            width: 8,
            height: 6,
          }),
          
          // DLQ Processor Performance
          props.dlqProcessorLambda ? new cloudwatch.GraphWidget({
            title: 'DLQ Processor Performance',
            width: 8,
            height: 6,
            left: [
              props.dlqProcessorLambda.metricInvocations({
                label: 'Invocations',
                color: cloudwatch.Color.BLUE,
              }),
              props.dlqProcessorLambda.metricErrors({
                label: 'Errors',
                color: cloudwatch.Color.RED,
              }),
            ],
            right: [
              props.dlqProcessorLambda.metricDuration({
                label: 'Duration (ms)',
                statistic: 'Average',
                color: cloudwatch.Color.GREEN,
              }),
            ],
          }) : new cloudwatch.TextWidget({
            markdown: '**DLQ Processor**: Not configured',
            width: 8,
            height: 6,
          }),
        ],
        [
          // Cold Starts
          new cloudwatch.GraphWidget({
            title: 'Lambda Cold Starts',
            width: 12,
            height: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/Lambda',
                metricName: 'InitDuration',
                statistic: 'Average',
                label: 'Init Duration (ms)',
                color: cloudwatch.Color.PURPLE,
              }),
            ],
          }),
          
          // Memory Utilization
          new cloudwatch.GraphWidget({
            title: 'Memory Utilization',
            width: 12,
            height: 6,
            left: [
              new cloudwatch.MathExpression({
                expression: '(used/allocated)*100',
                label: 'Memory Utilization %',
                usingMetrics: {
                  used: new cloudwatch.Metric({
                    namespace: 'AWS/Lambda',
                    metricName: 'UsedMemoryMB',
                    statistic: 'Average',
                  }),
                  allocated: new cloudwatch.Metric({
                    namespace: 'AWS/Lambda',
                    metricName: 'AllocatedMemoryMB',
                    statistic: 'Average',
                  }),
                },
              }),
            ],
          }),
        ],
      ],
    })
    
    // ==================== DynamoDB Dashboard ====================
    this.dynamodbDashboard = new cloudwatch.Dashboard(this, 'DynamoDBDashboard', {
      dashboardName: `Postolio-DynamoDB-${environment}`,
      widgets: [
        [
          // Read/Write Capacity
          new cloudwatch.GraphWidget({
            title: 'DynamoDB Read/Write Activity',
            width: 12,
            height: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/DynamoDB',
                metricName: 'ConsumedReadCapacityUnits',
                dimensionsMap: {
                  TableName: props.tokenTable?.tableName || 'N/A',
                },
                statistic: 'Sum',
                label: 'Token Table Reads',
                color: cloudwatch.Color.BLUE,
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/DynamoDB',
                metricName: 'ConsumedWriteCapacityUnits',
                dimensionsMap: {
                  TableName: props.tokenTable?.tableName || 'N/A',
                },
                statistic: 'Sum',
                label: 'Token Table Writes',
                color: cloudwatch.Color.GREEN,
              }),
            ],
          }),
          
          // Throttling
          new cloudwatch.GraphWidget({
            title: 'DynamoDB Throttling',
            width: 12,
            height: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/DynamoDB',
                metricName: 'UserErrors',
                statistic: 'Sum',
                label: 'User Errors',
                color: cloudwatch.Color.ORANGE,
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/DynamoDB',
                metricName: 'SystemErrors',
                statistic: 'Sum',
                label: 'System Errors',
                color: cloudwatch.Color.RED,
              }),
            ],
          }),
        ],
        [
          // Table-specific metrics
          props.scheduleTable ? new cloudwatch.GraphWidget({
            title: 'Schedule Table Operations',
            width: 8,
            height: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/DynamoDB',
                metricName: 'SuccessfulRequestLatency',
                dimensionsMap: {
                  TableName: props.scheduleTable.tableName,
                  Operation: 'Query',
                },
                statistic: 'Average',
                label: 'Query Latency',
                color: cloudwatch.Color.BLUE,
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/DynamoDB',
                metricName: 'SuccessfulRequestLatency',
                dimensionsMap: {
                  TableName: props.scheduleTable.tableName,
                  Operation: 'PutItem',
                },
                statistic: 'Average',
                label: 'PutItem Latency',
                color: cloudwatch.Color.GREEN,
              }),
            ],
          }) : new cloudwatch.TextWidget({
            markdown: '**Schedule Table**: Not configured',
            width: 8,
            height: 6,
          }),
          
          props.sagaStateTable ? new cloudwatch.GraphWidget({
            title: 'Saga State Table Operations',
            width: 8,
            height: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/DynamoDB',
                metricName: 'ConsumedReadCapacityUnits',
                dimensionsMap: {
                  TableName: props.sagaStateTable.tableName,
                },
                statistic: 'Sum',
                label: 'Read Units',
                color: cloudwatch.Color.BLUE,
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/DynamoDB',
                metricName: 'ConsumedWriteCapacityUnits',
                dimensionsMap: {
                  TableName: props.sagaStateTable.tableName,
                },
                statistic: 'Sum',
                label: 'Write Units',
                color: cloudwatch.Color.GREEN,
              }),
            ],
          }) : new cloudwatch.TextWidget({
            markdown: '**Saga State Table**: Not configured',
            width: 8,
            height: 6,
          }),
          
          props.circuitBreakerTable ? new cloudwatch.GraphWidget({
            title: 'Circuit Breaker Table',
            width: 8,
            height: 6,
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/DynamoDB',
                metricName: 'ConsumedReadCapacityUnits',
                dimensionsMap: {
                  TableName: props.circuitBreakerTable.tableName,
                },
                statistic: 'Sum',
                label: 'Read Units',
                color: cloudwatch.Color.BLUE,
              }),
            ],
          }) : new cloudwatch.TextWidget({
            markdown: '**Circuit Breaker Table**: Not configured',
            width: 8,
            height: 6,
          }),
        ],
      ],
    })
    
    // ==================== SQS Dashboard ====================
    this.sqsDashboard = new cloudwatch.Dashboard(this, 'SQSDashboard', {
      dashboardName: `Postolio-SQS-${environment}`,
      widgets: [
        [
          // Queue Overview
          new cloudwatch.GraphWidget({
            title: 'Queue Message Volume',
            width: 12,
            height: 6,
            left: props.publisherQueues ? Object.entries(props.publisherQueues)
              .filter(([_, queue]) => queue !== undefined)
              .map(([platform, queue]) => 
                queue!.metricApproximateNumberOfMessagesVisible({
                  label: `${platform} Queue`,
                })
              ) : [],
          }),
          
          // Queue Processing Rate
          new cloudwatch.GraphWidget({
            title: 'Message Processing Rate',
            width: 12,
            height: 6,
            left: props.publisherQueues ? Object.entries(props.publisherQueues)
              .filter(([_, queue]) => queue !== undefined)
              .map(([platform, queue]) => 
                queue!.metricNumberOfMessagesReceived({
                  label: `${platform} Received`,
                  statistic: 'Sum',
                })
              ) : [],
          }),
        ],
        [
          // Message Age
          new cloudwatch.GraphWidget({
            title: 'Message Age in Queues',
            width: 12,
            height: 6,
            left: props.publisherQueues ? Object.entries(props.publisherQueues)
              .filter(([_, queue]) => queue !== undefined)
              .map(([platform, queue]) => 
                queue!.metricApproximateAgeOfOldestMessage({
                  label: `${platform} Oldest Message`,
                  statistic: 'Maximum',
                })
              ) : [],
          }),
          
          // DLQ Metrics
          props.publisherDLQ ? new cloudwatch.GraphWidget({
            title: 'Dead Letter Queue Activity',
            width: 12,
            height: 6,
            left: [
              props.publisherDLQ.metricNumberOfMessagesReceived({
                label: 'Messages Received',
                statistic: 'Sum',
                color: cloudwatch.Color.RED,
              }),
              props.publisherDLQ.metricNumberOfMessagesDeleted({
                label: 'Messages Processed',
                statistic: 'Sum',
                color: cloudwatch.Color.GREEN,
              }),
            ],
          }) : new cloudwatch.TextWidget({
            markdown: '**Dead Letter Queue**: Not configured',
            width: 12,
            height: 6,
          }),
        ],
      ],
    })
    
    // Add custom metrics namespace
    new cloudwatch.CfnDashboard(this, 'CustomMetricsDashboard', {
      dashboardName: `Postolio-Custom-${environment}`,
      dashboardBody: JSON.stringify({
        widgets: [
          {
            type: 'metric',
            properties: {
              metrics: [
                ['Postolio/DLQ', 'MessagesReprocessed', { stat: 'Sum' }],
                ['.', 'MessagesParked', { stat: 'Sum' }],
                ['.', 'AlertsSent', { stat: 'Sum' }],
                ['Postolio/Saga', 'SagaCompleted', { stat: 'Sum' }],
                ['.', 'SagaFailed', { stat: 'Sum' }],
                ['.', 'SagaCompensated', { stat: 'Sum' }],
                ['Postolio/CircuitBreaker', 'CircuitOpened', { stat: 'Sum' }],
                ['.', 'CircuitClosed', { stat: 'Sum' }],
                ['Postolio/Publishing', 'PostsPublished', { stat: 'Sum' }],
                ['.', 'PostsFailed', { stat: 'Sum' }],
              ],
              period: 300,
              stat: 'Sum',
              region: cdk.Stack.of(this).region,
              title: 'Custom Application Metrics',
              view: 'timeSeries',
              stacked: false,
              yAxis: {
                left: { min: 0 },
              },
            },
          },
        ],
      }),
    })
  }
}