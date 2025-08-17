/**
 * Monitoring Stack for Content Scheduler Microservice
 * Provides comprehensive observability through CloudWatch dashboards,
 * custom metrics, alarms, and X-Ray tracing
 */

import { Stack, StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as xray from 'aws-cdk-lib/aws-xray';

export interface MonitoringStackProps extends StackProps {
  environment: string;
  schedulerFunction: lambda.Function;
  publisherFunction: lambda.Function;
  statusUpdaterFunction: lambda.Function;
  retryProcessorFunction: lambda.Function;
  schedulerTable: dynamodb.Table;
  retryTable: dynamodb.Table;
  alertEmail?: string;
}

export class MonitoringStack extends Stack {
  public readonly operationalDashboard: cloudwatch.Dashboard;
  public readonly businessDashboard: cloudwatch.Dashboard;
  public readonly costDashboard: cloudwatch.Dashboard;
  public readonly slaDashboard: cloudwatch.Dashboard;
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { 
      environment,
      schedulerFunction,
      publisherFunction,
      statusUpdaterFunction,
      retryProcessorFunction,
      schedulerTable,
      retryTable,
      alertEmail
    } = props;

    // Create SNS topic for alerts
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      displayName: `Content Scheduler Alerts - ${environment}`,
      topicName: `content-scheduler-alerts-${environment}`,
    });

    // Add email subscription if provided
    if (alertEmail) {
      this.alertTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(alertEmail)
      );
    }

    // Create operational dashboard
    this.operationalDashboard = this.createOperationalDashboard(
      environment,
      schedulerFunction,
      publisherFunction,
      statusUpdaterFunction,
      retryProcessorFunction,
      schedulerTable,
      retryTable
    );

    // Create business metrics dashboard
    this.businessDashboard = this.createBusinessDashboard(
      environment,
      publisherFunction,
      schedulerTable
    );

    // Create cost monitoring dashboard
    this.costDashboard = this.createCostDashboard(environment);

    // Create SLA monitoring dashboard
    this.slaDashboard = this.createSLADashboard(
      environment,
      publisherFunction,
      schedulerTable
    );

    // Set up critical alarms
    this.setupCriticalAlarms(
      environment,
      schedulerFunction,
      publisherFunction,
      statusUpdaterFunction,
      retryProcessorFunction,
      schedulerTable,
      retryTable
    );

    // Enable X-Ray tracing
    this.enableXRayTracing([
      schedulerFunction,
      publisherFunction,
      statusUpdaterFunction,
      retryProcessorFunction,
    ]);
  }

  /**
   * Create operational dashboard for system health monitoring
   */
  private createOperationalDashboard(
    environment: string,
    schedulerFunction: lambda.Function,
    publisherFunction: lambda.Function,
    statusUpdaterFunction: lambda.Function,
    retryProcessorFunction: lambda.Function,
    schedulerTable: dynamodb.Table,
    retryTable: dynamodb.Table
  ): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'OperationalDashboard', {
      dashboardName: `ContentScheduler-Operational-${environment}`,
      periodOverride: cloudwatch.PeriodOverride.AUTO,
    });

    // Lambda metrics
    const lambdaMetrics = [
      schedulerFunction,
      publisherFunction,
      statusUpdaterFunction,
      retryProcessorFunction,
    ].map(fn => ({
      invocations: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Invocations',
        dimensionsMap: { FunctionName: fn.functionName },
        statistic: 'Sum',
      }),
      errors: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: fn.functionName },
        statistic: 'Sum',
      }),
      duration: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        dimensionsMap: { FunctionName: fn.functionName },
        statistic: 'Average',
      }),
      concurrentExecutions: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'ConcurrentExecutions',
        dimensionsMap: { FunctionName: fn.functionName },
        statistic: 'Maximum',
      }),
    }));

    // Add Lambda widgets
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: lambdaMetrics.map(m => m.invocations),
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: lambdaMetrics.map(m => m.errors),
        width: 12,
        height: 6,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration (ms)',
        left: lambdaMetrics.map(m => m.duration),
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Concurrent Executions',
        left: lambdaMetrics.map(m => m.concurrentExecutions),
        width: 12,
        height: 6,
      })
    );

    // DynamoDB metrics
    const dynamoMetrics = [schedulerTable, retryTable].map(table => ({
      consumedReadCapacity: new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ConsumedReadCapacityUnits',
        dimensionsMap: { TableName: table.tableName },
        statistic: 'Sum',
      }),
      consumedWriteCapacity: new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ConsumedWriteCapacityUnits',
        dimensionsMap: { TableName: table.tableName },
        statistic: 'Sum',
      }),
      throttledRequests: new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'UserErrors',
        dimensionsMap: { TableName: table.tableName },
        statistic: 'Sum',
      }),
    }));

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Read Capacity',
        left: dynamoMetrics.map(m => m.consumedReadCapacity),
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Write Capacity',
        left: dynamoMetrics.map(m => m.consumedWriteCapacity),
        width: 12,
        height: 6,
      })
    );

    return dashboard;
  }

  /**
   * Create business metrics dashboard
   */
  private createBusinessDashboard(
    environment: string,
    publisherFunction: lambda.Function,
    schedulerTable: dynamodb.Table
  ): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'BusinessDashboard', {
      dashboardName: `ContentScheduler-Business-${environment}`,
      periodOverride: cloudwatch.PeriodOverride.AUTO,
    });

    // Custom business metrics
    const publishingSuccessRate = new cloudwatch.MathExpression({
      expression: '(m1 - m2) / m1 * 100',
      usingMetrics: {
        m1: new cloudwatch.Metric({
          namespace: 'ContentScheduler',
          metricName: 'PublishingAttempts',
          statistic: 'Sum',
        }),
        m2: new cloudwatch.Metric({
          namespace: 'ContentScheduler',
          metricName: 'PublishingFailures',
          statistic: 'Sum',
        }),
      },
      label: 'Publishing Success Rate (%)',
    });

    const platformMetrics = ['instagram', 'tiktok', 'youtube'].map(platform => ({
      attempts: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'PublishingAttempts',
        dimensionsMap: { Platform: platform },
        statistic: 'Sum',
      }),
      failures: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'PublishingFailures',
        dimensionsMap: { Platform: platform },
        statistic: 'Sum',
      }),
      latency: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'PublishingLatency',
        dimensionsMap: { Platform: platform },
        statistic: 'Average',
      }),
    }));

    // Add business metrics widgets
    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Overall Success Rate',
        metrics: [publishingSuccessRate],
        width: 6,
        height: 4,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Total Posts Published',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'ContentScheduler',
            metricName: 'PostsPublished',
            statistic: 'Sum',
          }),
        ],
        width: 6,
        height: 4,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Posts Scheduled',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'ContentScheduler',
            metricName: 'PostsScheduled',
            statistic: 'Sum',
          }),
        ],
        width: 6,
        height: 4,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Retry Queue Depth',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'ContentScheduler',
            metricName: 'RetryQueueDepth',
            statistic: 'Maximum',
          }),
        ],
        width: 6,
        height: 4,
      })
    );

    // Platform-specific metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Publishing by Platform',
        left: platformMetrics.map(m => m.attempts),
        width: 12,
        height: 6,
        stacked: true,
      }),
      new cloudwatch.GraphWidget({
        title: 'Failures by Platform',
        left: platformMetrics.map(m => m.failures),
        width: 12,
        height: 6,
        stacked: true,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Publishing Latency by Platform (ms)',
        left: platformMetrics.map(m => m.latency),
        width: 24,
        height: 6,
      })
    );

    // Content type metrics
    const contentTypeMetrics = ['image', 'video', 'carousel'].map(type => 
      new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'PostsPublished',
        dimensionsMap: { ContentType: type },
        statistic: 'Sum',
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Content Types Published',
        left: contentTypeMetrics,
        width: 12,
        height: 6,
        view: cloudwatch.GraphWidgetView.PIE,
      }),
      new cloudwatch.GraphWidget({
        title: 'Publishing Trends',
        left: [
          new cloudwatch.Metric({
            namespace: 'ContentScheduler',
            metricName: 'PostsPublished',
            statistic: 'Sum',
            period: Duration.hours(1),
          }),
        ],
        width: 12,
        height: 6,
      })
    );

    return dashboard;
  }

  /**
   * Create cost monitoring dashboard
   */
  private createCostDashboard(environment: string): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'CostDashboard', {
      dashboardName: `ContentScheduler-Cost-${environment}`,
      periodOverride: cloudwatch.PeriodOverride.AUTO,
    });

    // Cost metrics
    const costMetrics = {
      lambda: new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { 
          Currency: 'USD',
          ServiceName: 'AWSLambda',
        },
        statistic: 'Maximum',
        period: Duration.hours(24),
      }),
      dynamodb: new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { 
          Currency: 'USD',
          ServiceName: 'AmazonDynamoDB',
        },
        statistic: 'Maximum',
        period: Duration.hours(24),
      }),
      secretsManager: new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { 
          Currency: 'USD',
          ServiceName: 'AWSSecretsManager',
        },
        statistic: 'Maximum',
        period: Duration.hours(24),
      }),
    };

    const costPer1000Posts = new cloudwatch.MathExpression({
      expression: '(m1 + m2 + m3) / m4 * 1000',
      usingMetrics: {
        m1: costMetrics.lambda,
        m2: costMetrics.dynamodb,
        m3: costMetrics.secretsManager,
        m4: new cloudwatch.Metric({
          namespace: 'ContentScheduler',
          metricName: 'PostsPublished',
          statistic: 'Sum',
          period: Duration.hours(24),
        }),
      },
      label: 'Cost per 1000 Posts ($)',
    });

    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Daily Lambda Cost',
        metrics: [costMetrics.lambda],
        width: 6,
        height: 4,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Daily DynamoDB Cost',
        metrics: [costMetrics.dynamodb],
        width: 6,
        height: 4,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Daily Secrets Manager Cost',
        metrics: [costMetrics.secretsManager],
        width: 6,
        height: 4,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Cost per 1000 Posts',
        metrics: [costPer1000Posts],
        width: 6,
        height: 4,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Cost Trend (Daily)',
        left: [costMetrics.lambda, costMetrics.dynamodb, costMetrics.secretsManager],
        width: 24,
        height: 6,
        stacked: true,
      })
    );

    return dashboard;
  }

  /**
   * Create SLA monitoring dashboard
   */
  private createSLADashboard(
    environment: string,
    publisherFunction: lambda.Function,
    schedulerTable: dynamodb.Table
  ): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'SLADashboard', {
      dashboardName: `ContentScheduler-SLA-${environment}`,
      periodOverride: cloudwatch.PeriodOverride.AUTO,
    });

    // SLA metrics
    const slaMetrics = {
      availability: new cloudwatch.MathExpression({
        expression: '100 - (m1 / m2 * 100)',
        usingMetrics: {
          m1: new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            dimensionsMap: { FunctionName: publisherFunction.functionName },
            statistic: 'Sum',
          }),
          m2: new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Invocations',
            dimensionsMap: { FunctionName: publisherFunction.functionName },
            statistic: 'Sum',
          }),
        },
        label: 'Service Availability (%)',
      }),
      publishingSuccess: new cloudwatch.MathExpression({
        expression: '(m1 - m2) / m1 * 100',
        usingMetrics: {
          m1: new cloudwatch.Metric({
            namespace: 'ContentScheduler',
            metricName: 'PublishingAttempts',
            statistic: 'Sum',
          }),
          m2: new cloudwatch.Metric({
            namespace: 'ContentScheduler',
            metricName: 'PublishingFailures',
            statistic: 'Sum',
          }),
        },
        label: 'Publishing Success Rate (%)',
      }),
      schedulingLatency: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'SchedulingLatency',
        statistic: 'Average',
      }),
      apiResponseTime: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'APIResponseTime',
        statistic: 'Average',
      }),
    };

    // SLA targets
    const slaTargets = {
      availability: 99.99,
      publishingSuccess: 99.99,
      schedulingLatency: 60000, // 60 seconds in ms
      apiResponseTime: 200, // 200ms
    };

    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Service Availability (Target: 99.99%)',
        metrics: [slaMetrics.availability],
        width: 6,
        height: 4,
        setPeriodToTimeRange: true,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Publishing Success Rate (Target: 99.99%)',
        metrics: [slaMetrics.publishingSuccess],
        width: 6,
        height: 4,
        setPeriodToTimeRange: true,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Avg Scheduling Latency (Target: <60s)',
        metrics: [slaMetrics.schedulingLatency],
        width: 6,
        height: 4,
        setPeriodToTimeRange: true,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Avg API Response Time (Target: <200ms)',
        metrics: [slaMetrics.apiResponseTime],
        width: 6,
        height: 4,
        setPeriodToTimeRange: true,
      })
    );

    // SLA compliance over time
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'SLA Compliance Trends',
        left: [slaMetrics.availability, slaMetrics.publishingSuccess],
        right: [slaMetrics.schedulingLatency, slaMetrics.apiResponseTime],
        width: 24,
        height: 8,
        leftYAxis: { min: 95, max: 100, label: 'Percentage (%)' },
        rightYAxis: { min: 0, label: 'Time (ms)' },
        leftAnnotations: [
          { value: slaTargets.availability, label: 'Availability Target', color: '#00ff00' },
          { value: slaTargets.publishingSuccess, label: 'Success Rate Target', color: '#0000ff' },
        ],
        rightAnnotations: [
          { value: slaTargets.schedulingLatency, label: 'Latency Target', color: '#ff0000' },
          { value: slaTargets.apiResponseTime, label: 'Response Time Target', color: '#ff00ff' },
        ],
      })
    );

    return dashboard;
  }

  /**
   * Set up critical alarms
   */
  private setupCriticalAlarms(
    environment: string,
    schedulerFunction: lambda.Function,
    publisherFunction: lambda.Function,
    statusUpdaterFunction: lambda.Function,
    retryProcessorFunction: lambda.Function,
    schedulerTable: dynamodb.Table,
    retryTable: dynamodb.Table
  ): void {
    // Publishing failures alarm
    const publishingFailuresAlarm = new cloudwatch.Alarm(this, 'PublishingFailuresAlarm', {
      alarmName: `${environment}-ContentScheduler-PublishingFailures`,
      alarmDescription: 'Alert when publishing failures exceed threshold',
      metric: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'PublishingFailures',
        statistic: 'Sum',
        period: Duration.minutes(1),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    publishingFailuresAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(this.alertTopic)
    );

    // Retry queue depth alarm
    const retryQueueAlarm = new cloudwatch.Alarm(this, 'RetryQueueDepthAlarm', {
      alarmName: `${environment}-ContentScheduler-RetryQueueDepth`,
      alarmDescription: 'Alert when retry queue is too deep',
      metric: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'RetryQueueDepth',
        statistic: 'Maximum',
        period: Duration.minutes(5),
      }),
      threshold: 100,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    retryQueueAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(this.alertTopic)
    );

    // Lambda duration alarms
    [
      { fn: schedulerFunction, name: 'Scheduler', threshold: 240000 }, // 4 minutes
      { fn: publisherFunction, name: 'Publisher', threshold: 240000 },
      { fn: statusUpdaterFunction, name: 'StatusUpdater', threshold: 60000 }, // 1 minute
      { fn: retryProcessorFunction, name: 'RetryProcessor', threshold: 240000 },
    ].forEach(({ fn, name, threshold }) => {
      const durationAlarm = new cloudwatch.Alarm(this, `${name}DurationAlarm`, {
        alarmName: `${environment}-ContentScheduler-${name}-Duration`,
        alarmDescription: `Alert when ${name} function duration exceeds threshold`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Maximum',
          period: Duration.minutes(5),
        }),
        threshold,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      durationAlarm.addAlarmAction(
        new cloudwatchActions.SnsAction(this.alertTopic)
      );
    });

    // DynamoDB throttling alarms
    [schedulerTable, retryTable].forEach(table => {
      const throttleAlarm = new cloudwatch.Alarm(this, `${table.node.id}ThrottleAlarm`, {
        alarmName: `${environment}-ContentScheduler-${table.tableName}-Throttling`,
        alarmDescription: `Alert when ${table.tableName} experiences throttling`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'UserErrors',
          dimensionsMap: { TableName: table.tableName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      throttleAlarm.addAlarmAction(
        new cloudwatchActions.SnsAction(this.alertTopic)
      );
    });

    // Cost alarm
    const costAlarm = new cloudwatch.Alarm(this, 'DailyCostAlarm', {
      alarmName: `${environment}-ContentScheduler-DailyCost`,
      alarmDescription: 'Alert when daily cost exceeds threshold',
      metric: new cloudwatch.MathExpression({
        expression: 'm1 + m2 + m3',
        usingMetrics: {
          m1: new cloudwatch.Metric({
            namespace: 'AWS/Billing',
            metricName: 'EstimatedCharges',
            dimensionsMap: { Currency: 'USD', ServiceName: 'AWSLambda' },
            statistic: 'Maximum',
            period: Duration.hours(24),
          }),
          m2: new cloudwatch.Metric({
            namespace: 'AWS/Billing',
            metricName: 'EstimatedCharges',
            dimensionsMap: { Currency: 'USD', ServiceName: 'AmazonDynamoDB' },
            statistic: 'Maximum',
            period: Duration.hours(24),
          }),
          m3: new cloudwatch.Metric({
            namespace: 'AWS/Billing',
            metricName: 'EstimatedCharges',
            dimensionsMap: { Currency: 'USD', ServiceName: 'AWSSecretsManager' },
            statistic: 'Maximum',
            period: Duration.hours(24),
          }),
        },
      }),
      threshold: 50, // $50 per day
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    costAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(this.alertTopic)
    );

    // SLA breach alarm
    const slaBreachAlarm = new cloudwatch.Alarm(this, 'SLABreachAlarm', {
      alarmName: `${environment}-ContentScheduler-SLABreach`,
      alarmDescription: 'Alert when SLA is breached (>1% failures)',
      metric: new cloudwatch.MathExpression({
        expression: '100 - ((m1 - m2) / m1 * 100)',
        usingMetrics: {
          m1: new cloudwatch.Metric({
            namespace: 'ContentScheduler',
            metricName: 'PublishingAttempts',
            statistic: 'Sum',
            period: Duration.hours(1),
          }),
          m2: new cloudwatch.Metric({
            namespace: 'ContentScheduler',
            metricName: 'PublishingFailures',
            statistic: 'Sum',
            period: Duration.hours(1),
          }),
        },
      }),
      threshold: 1, // 1% failure rate
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    slaBreachAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(this.alertTopic)
    );
  }

  /**
   * Enable X-Ray tracing for Lambda functions
   */
  private enableXRayTracing(functions: lambda.Function[]): void {
    functions.forEach(fn => {
      // X-Ray tracing is typically enabled at the function level
      // This would be done in the Lambda function definition
      // Here we just add the necessary permissions
      const xrayPolicy = new xray.CfnSamplingRule(this, `${fn.node.id}XRaySamplingRule`, {
        samplingRule: {
          ruleName: `${fn.functionName}-sampling`,
          priority: 1000,
          reservoirSize: 1,
          fixedRate: 0.1, // Sample 10% of requests
          version: 1,
          serviceName: fn.functionName,
          serviceType: 'AWS::Lambda::Function',
          host: '*',
          httpMethod: '*',
          urlPath: '*',
          resourceArn: '*',
        },
      });
    });
  }
}