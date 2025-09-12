"use strict";
/**
 * Monitoring Stack for Content Scheduler Microservice
 * Provides comprehensive observability through CloudWatch dashboards,
 * custom metrics, alarms, and X-Ray tracing
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const snsSubscriptions = __importStar(require("aws-cdk-lib/aws-sns-subscriptions"));
const cloudwatchActions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
const kms = __importStar(require("aws-cdk-lib/aws-kms"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
class MonitoringStack extends aws_cdk_lib_1.Stack {
    operationalDashboard;
    businessDashboard;
    costDashboard;
    slaDashboard;
    alertTopic;
    kmsKey;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment, schedulerFunction, publisherFunction, statusUpdaterFunction, retryProcessorFunction, schedulerTable, retryTable, alertEmail } = props;
        // Create KMS key for encryption
        this.kmsKey = new kms.Key(this, 'MonitoringKey', {
            enableKeyRotation: true,
            description: `KMS key for Content Scheduler monitoring - ${environment}`,
            removalPolicy: environment === 'prod' ? aws_cdk_lib_1.RemovalPolicy.RETAIN : aws_cdk_lib_1.RemovalPolicy.DESTROY, // Explicit for prod
            alias: `alias/content-scheduler-monitoring-${environment}`,
        });
        // Grant CloudWatch access to use the key
        this.kmsKey.grantEncryptDecrypt(new iam.ServicePrincipal('cloudwatch.amazonaws.com'));
        this.kmsKey.grantEncryptDecrypt(new iam.ServicePrincipal('sns.amazonaws.com'));
        // Create SNS topic for alerts with encryption
        this.alertTopic = new sns.Topic(this, 'AlertTopic', {
            displayName: `Content Scheduler Alerts - ${environment}`,
            topicName: `content-scheduler-alerts-${environment}`,
            masterKey: this.kmsKey,
            fifo: false,
            contentBasedDeduplication: false,
        });
        // Add email subscription if provided
        if (alertEmail) {
            this.alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));
        }
        // Create operational dashboard
        this.operationalDashboard = this.createOperationalDashboard(environment, schedulerFunction, publisherFunction, statusUpdaterFunction, retryProcessorFunction, schedulerTable, retryTable);
        // Create business metrics dashboard
        this.businessDashboard = this.createBusinessDashboard(environment, publisherFunction, schedulerTable);
        // Create cost monitoring dashboard
        this.costDashboard = this.createCostDashboard(environment);
        // Create SLA monitoring dashboard
        this.slaDashboard = this.createSLADashboard(environment, publisherFunction, schedulerTable);
        // Set up critical alarms
        this.setupCriticalAlarms(environment, schedulerFunction, publisherFunction, statusUpdaterFunction, retryProcessorFunction, schedulerTable, retryTable);
        // Note: X-Ray tracing should be enabled at Lambda function creation with:
        // tracing: lambda.Tracing.ACTIVE
        // This is handled in the Lambda function definitions
    }
    /**
     * Create operational dashboard for system health monitoring
     */
    createOperationalDashboard(environment, schedulerFunction, publisherFunction, statusUpdaterFunction, retryProcessorFunction, schedulerTable, retryTable) {
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
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Lambda Invocations',
            left: lambdaMetrics.map(m => m.invocations),
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Lambda Errors',
            left: lambdaMetrics.map(m => m.errors),
            width: 12,
            height: 6,
        }));
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Lambda Duration (ms)',
            left: lambdaMetrics.map(m => m.duration),
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'Lambda Concurrent Executions',
            left: lambdaMetrics.map(m => m.concurrentExecutions),
            width: 12,
            height: 6,
        }));
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
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'DynamoDB Read Capacity',
            left: dynamoMetrics.map(m => m.consumedReadCapacity),
            width: 12,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'DynamoDB Write Capacity',
            left: dynamoMetrics.map(m => m.consumedWriteCapacity),
            width: 12,
            height: 6,
        }));
        return dashboard;
    }
    /**
     * Create business metrics dashboard
     */
    createBusinessDashboard(environment, _publisherFunction, _schedulerTable) {
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
        dashboard.addWidgets(new cloudwatch.SingleValueWidget({
            title: 'Overall Success Rate',
            metrics: [publishingSuccessRate],
            width: 6,
            height: 4,
        }), new cloudwatch.SingleValueWidget({
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
        }), new cloudwatch.SingleValueWidget({
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
        }), new cloudwatch.SingleValueWidget({
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
        }));
        // Platform-specific metrics
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Publishing by Platform',
            left: platformMetrics.map(m => m.attempts),
            width: 12,
            height: 6,
            stacked: true,
        }), new cloudwatch.GraphWidget({
            title: 'Failures by Platform',
            left: platformMetrics.map(m => m.failures),
            width: 12,
            height: 6,
            stacked: true,
        }));
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Publishing Latency by Platform (ms)',
            left: platformMetrics.map(m => m.latency),
            width: 24,
            height: 6,
        }));
        // Content type metrics
        const contentTypeMetrics = ['image', 'video', 'carousel'].map(type => new cloudwatch.Metric({
            namespace: 'ContentScheduler',
            metricName: 'PostsPublished',
            dimensionsMap: { ContentType: type },
            statistic: 'Sum',
        }));
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Content Types Published',
            left: contentTypeMetrics,
            width: 12,
            height: 6,
            view: cloudwatch.GraphWidgetView.PIE,
        }), new cloudwatch.GraphWidget({
            title: 'Publishing Trends',
            left: [
                new cloudwatch.Metric({
                    namespace: 'ContentScheduler',
                    metricName: 'PostsPublished',
                    statistic: 'Sum',
                    period: aws_cdk_lib_1.Duration.hours(1),
                }),
            ],
            width: 12,
            height: 6,
        }));
        return dashboard;
    }
    /**
     * Create cost monitoring dashboard
     */
    createCostDashboard(environment) {
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
                period: aws_cdk_lib_1.Duration.hours(24),
            }),
            dynamodb: new cloudwatch.Metric({
                namespace: 'AWS/Billing',
                metricName: 'EstimatedCharges',
                dimensionsMap: {
                    Currency: 'USD',
                    ServiceName: 'AmazonDynamoDB',
                },
                statistic: 'Maximum',
                period: aws_cdk_lib_1.Duration.hours(24),
            }),
            secretsManager: new cloudwatch.Metric({
                namespace: 'AWS/Billing',
                metricName: 'EstimatedCharges',
                dimensionsMap: {
                    Currency: 'USD',
                    ServiceName: 'AWSSecretsManager',
                },
                statistic: 'Maximum',
                period: aws_cdk_lib_1.Duration.hours(24),
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
                    period: aws_cdk_lib_1.Duration.hours(24),
                }),
            },
            label: 'Cost per 1000 Posts ($)',
        });
        dashboard.addWidgets(new cloudwatch.SingleValueWidget({
            title: 'Daily Lambda Cost',
            metrics: [costMetrics.lambda],
            width: 6,
            height: 4,
        }), new cloudwatch.SingleValueWidget({
            title: 'Daily DynamoDB Cost',
            metrics: [costMetrics.dynamodb],
            width: 6,
            height: 4,
        }), new cloudwatch.SingleValueWidget({
            title: 'Daily Secrets Manager Cost',
            metrics: [costMetrics.secretsManager],
            width: 6,
            height: 4,
        }), new cloudwatch.SingleValueWidget({
            title: 'Cost per 1000 Posts',
            metrics: [costPer1000Posts],
            width: 6,
            height: 4,
        }));
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Cost Trend (Daily)',
            left: [costMetrics.lambda, costMetrics.dynamodb, costMetrics.secretsManager],
            width: 24,
            height: 6,
            stacked: true,
        }));
        return dashboard;
    }
    /**
     * Create SLA monitoring dashboard
     */
    createSLADashboard(environment, publisherFunction, _schedulerTable) {
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
        dashboard.addWidgets(new cloudwatch.SingleValueWidget({
            title: 'Service Availability (Target: 99.99%)',
            metrics: [slaMetrics.availability],
            width: 6,
            height: 4,
            setPeriodToTimeRange: true,
        }), new cloudwatch.SingleValueWidget({
            title: 'Publishing Success Rate (Target: 99.99%)',
            metrics: [slaMetrics.publishingSuccess],
            width: 6,
            height: 4,
            setPeriodToTimeRange: true,
        }), new cloudwatch.SingleValueWidget({
            title: 'Avg Scheduling Latency (Target: <60s)',
            metrics: [slaMetrics.schedulingLatency],
            width: 6,
            height: 4,
            setPeriodToTimeRange: true,
        }), new cloudwatch.SingleValueWidget({
            title: 'Avg API Response Time (Target: <200ms)',
            metrics: [slaMetrics.apiResponseTime],
            width: 6,
            height: 4,
            setPeriodToTimeRange: true,
        }));
        // SLA compliance over time
        dashboard.addWidgets(new cloudwatch.GraphWidget({
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
        }));
        return dashboard;
    }
    /**
     * Set up critical alarms
     */
    setupCriticalAlarms(environment, schedulerFunction, publisherFunction, statusUpdaterFunction, retryProcessorFunction, schedulerTable, retryTable) {
        // Publishing failures alarm
        const publishingFailuresAlarm = new cloudwatch.Alarm(this, 'PublishingFailuresAlarm', {
            alarmName: `${environment}-ContentScheduler-PublishingFailures`,
            alarmDescription: 'Alert when publishing failures exceed threshold',
            metric: new cloudwatch.Metric({
                namespace: 'ContentScheduler',
                metricName: 'PublishingFailures',
                statistic: 'Sum',
                period: aws_cdk_lib_1.Duration.minutes(1),
            }),
            threshold: 5,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        publishingFailuresAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
        // Retry queue depth alarm
        const retryQueueAlarm = new cloudwatch.Alarm(this, 'RetryQueueDepthAlarm', {
            alarmName: `${environment}-ContentScheduler-RetryQueueDepth`,
            alarmDescription: 'Alert when retry queue is too deep',
            metric: new cloudwatch.Metric({
                namespace: 'ContentScheduler',
                metricName: 'RetryQueueDepth',
                statistic: 'Maximum',
                period: aws_cdk_lib_1.Duration.minutes(5),
            }),
            threshold: 100,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        retryQueueAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
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
                    period: aws_cdk_lib_1.Duration.minutes(5),
                }),
                threshold,
                evaluationPeriods: 1,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            durationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
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
                    period: aws_cdk_lib_1.Duration.minutes(1),
                }),
                threshold: 1,
                evaluationPeriods: 1,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            throttleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
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
                        period: aws_cdk_lib_1.Duration.hours(24),
                    }),
                    m2: new cloudwatch.Metric({
                        namespace: 'AWS/Billing',
                        metricName: 'EstimatedCharges',
                        dimensionsMap: { Currency: 'USD', ServiceName: 'AmazonDynamoDB' },
                        statistic: 'Maximum',
                        period: aws_cdk_lib_1.Duration.hours(24),
                    }),
                    m3: new cloudwatch.Metric({
                        namespace: 'AWS/Billing',
                        metricName: 'EstimatedCharges',
                        dimensionsMap: { Currency: 'USD', ServiceName: 'AWSSecretsManager' },
                        statistic: 'Maximum',
                        period: aws_cdk_lib_1.Duration.hours(24),
                    }),
                },
            }),
            threshold: 50, // $50 per day
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        costAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
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
                        period: aws_cdk_lib_1.Duration.hours(1),
                    }),
                    m2: new cloudwatch.Metric({
                        namespace: 'ContentScheduler',
                        metricName: 'PublishingFailures',
                        statistic: 'Sum',
                        period: aws_cdk_lib_1.Duration.hours(1),
                    }),
                },
            }),
            threshold: 1, // 1% failure rate
            evaluationPeriods: 2,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        slaBreachAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
    }
}
exports.MonitoringStack = MonitoringStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uaXRvcmluZy1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1vbml0b3Jpbmctc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILDZDQUF5RTtBQUV6RSx1RUFBeUQ7QUFDekQseURBQTJDO0FBQzNDLG9GQUFzRTtBQUN0RSxzRkFBd0U7QUFHeEUseURBQTJDO0FBQzNDLHlEQUEyQztBQWEzQyxNQUFhLGVBQWdCLFNBQVEsbUJBQUs7SUFDeEIsb0JBQW9CLENBQXVCO0lBQzNDLGlCQUFpQixDQUF1QjtJQUN4QyxhQUFhLENBQXVCO0lBQ3BDLFlBQVksQ0FBdUI7SUFDbkMsVUFBVSxDQUFZO0lBQ3RCLE1BQU0sQ0FBVTtJQUVoQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTJCO1FBQ25FLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFDSixXQUFXLEVBQ1gsaUJBQWlCLEVBQ2pCLGlCQUFpQixFQUNqQixxQkFBcUIsRUFDckIsc0JBQXNCLEVBQ3RCLGNBQWMsRUFDZCxVQUFVLEVBQ1YsVUFBVSxFQUNYLEdBQUcsS0FBSyxDQUFDO1FBRVYsZ0NBQWdDO1FBQ2hDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDL0MsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixXQUFXLEVBQUUsOENBQThDLFdBQVcsRUFBRTtZQUN4RSxhQUFhLEVBQUUsV0FBVyxLQUFLLE1BQU0sQ0FBQyxDQUFDLENBQUMsMkJBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLDJCQUFhLENBQUMsT0FBTyxFQUFFLG9CQUFvQjtZQUMxRyxLQUFLLEVBQUUsc0NBQXNDLFdBQVcsRUFBRTtTQUMzRCxDQUFDLENBQUM7UUFFSCx5Q0FB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QUUsb0JBQW9CO3dCQUNoQyxTQUFTLEVBQUUsS0FBSzt3QkFDaEIsTUFBTSxFQUFFLHNCQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztxQkFDMUIsQ0FBQztvQkFDRixFQUFFLEVBQUUsSUFBSSxVQUFVLENBQUMsTUFBTSxDQUFDO3dCQUN4QixTQUFTLEVBQUUsa0JBQWtCO3dCQUM3QixVQUFVLEVBQUUsb0JBQW9CO3dCQUNoQyxTQUFTLEVBQUUsS0FBSzt3QkFDaEIsTUFBTSxFQUFFLHNCQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztxQkFDMUIsQ0FBQztpQkFDSDthQUNGLENBQUM7WUFDRixTQUFTLEVBQUUsQ0FBQyxFQUFFLGtCQUFrQjtZQUNoQyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3BCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO1NBQzVELENBQUMsQ0FBQztRQUNILGNBQWMsQ0FBQyxjQUFjLENBQzNCLElBQUksaUJBQWlCLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FDakQsQ0FBQztJQUNKLENBQUM7Q0FLRjtBQTd2QkQsMENBNnZCQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTW9uaXRvcmluZyBTdGFjayBmb3IgQ29udGVudCBTY2hlZHVsZXIgTWljcm9zZXJ2aWNlXG4gKiBQcm92aWRlcyBjb21wcmVoZW5zaXZlIG9ic2VydmFiaWxpdHkgdGhyb3VnaCBDbG91ZFdhdGNoIGRhc2hib2FyZHMsXG4gKiBjdXN0b20gbWV0cmljcywgYWxhcm1zLCBhbmQgWC1SYXkgdHJhY2luZ1xuICovXG5cbmltcG9ydCB7IFN0YWNrLCBTdGFja1Byb3BzLCBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyBzbnNTdWJzY3JpcHRpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoQWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTW9uaXRvcmluZ1N0YWNrUHJvcHMgZXh0ZW5kcyBTdGFja1Byb3BzIHtcbiAgZW52aXJvbm1lbnQ6IHN0cmluZztcbiAgc2NoZWR1bGVyRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGlzaGVyRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgc3RhdHVzVXBkYXRlckZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gIHJldHJ5UHJvY2Vzc29yRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgc2NoZWR1bGVyVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICByZXRyeVRhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgYWxlcnRFbWFpbD86IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIE1vbml0b3JpbmdTdGFjayBleHRlbmRzIFN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IG9wZXJhdGlvbmFsRGFzaGJvYXJkOiBjbG91ZHdhdGNoLkRhc2hib2FyZDtcbiAgcHVibGljIHJlYWRvbmx5IGJ1c2luZXNzRGFzaGJvYXJkOiBjbG91ZHdhdGNoLkRhc2hib2FyZDtcbiAgcHVibGljIHJlYWRvbmx5IGNvc3REYXNoYm9hcmQ6IGNsb3Vkd2F0Y2guRGFzaGJvYXJkO1xuICBwdWJsaWMgcmVhZG9ubHkgc2xhRGFzaGJvYXJkOiBjbG91ZHdhdGNoLkRhc2hib2FyZDtcbiAgcHVibGljIHJlYWRvbmx5IGFsZXJ0VG9waWM6IHNucy5Ub3BpYztcbiAgcHVibGljIHJlYWRvbmx5IGttc0tleToga21zLktleTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTW9uaXRvcmluZ1N0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgXG4gICAgICBlbnZpcm9ubWVudCxcbiAgICAgIHNjaGVkdWxlckZ1bmN0aW9uLFxuICAgICAgcHVibGlzaGVyRnVuY3Rpb24sXG4gICAgICBzdGF0dXNVcGRhdGVyRnVuY3Rpb24sXG4gICAgICByZXRyeVByb2Nlc3NvckZ1bmN0aW9uLFxuICAgICAgc2NoZWR1bGVyVGFibGUsXG4gICAgICByZXRyeVRhYmxlLFxuICAgICAgYWxlcnRFbWFpbFxuICAgIH0gPSBwcm9wcztcblxuICAgIC8vIENyZWF0ZSBLTVMga2V5IGZvciBlbmNyeXB0aW9uXG4gICAgdGhpcy5rbXNLZXkgPSBuZXcga21zLktleSh0aGlzLCAnTW9uaXRvcmluZ0tleScsIHtcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgICAgZGVzY3JpcHRpb246IGBLTVMga2V5IGZvciBDb250ZW50IFNjaGVkdWxlciBtb25pdG9yaW5nIC0gJHtlbnZpcm9ubWVudH1gLFxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IFJlbW92YWxQb2xpY3kuUkVUQUlOIDogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBFeHBsaWNpdCBmb3IgcHJvZFxuICAgICAgYWxpYXM6IGBhbGlhcy9jb250ZW50LXNjaGVkdWxlci1tb25pdG9yaW5nLSR7ZW52aXJvbm1lbnR9YCxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IENsb3VkV2F0Y2ggYWNjZXNzIHRvIHVzZSB0aGUga2V5XG4gICAgdGhpcy5rbXNLZXkuZ3JhbnRFbmNyeXB0RGVjcnlwdChuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Nsb3Vkd2F0Y2guYW1hem9uYXdzLmNvbScpKTtcbiAgICB0aGlzLmttc0tleS5ncmFudEVuY3J5cHREZWNyeXB0KG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnc25zLmFtYXpvbmF3cy5jb20nKSk7XG5cbiAgICAvLyBDcmVhdGUgU05TIHRvcGljIGZvciBhbGVydHMgd2l0aCBlbmNyeXB0aW9uXG4gICAgdGhpcy5hbGVydFRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnQWxlcnRUb3BpYycsIHtcbiAgICAgIGRpc3BsYXlOYW1lOiBgQ29udGVudCBTY2hlZHVsZXIgQWxlcnRzIC0gJHtlbnZpcm9ubWVudH1gLFxuICAgICAgdG9waWNOYW1lOiBgY29udGVudC1zY2hlZHVsZXItYWxlcnRzLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIG1hc3RlcktleTogdGhpcy5rbXNLZXksXG4gICAgICBmaWZvOiBmYWxzZSxcbiAgICAgIGNvbnRlbnRCYXNlZERlZHVwbGljYXRpb246IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGVtYWlsIHN1YnNjcmlwdGlvbiBpZiBwcm92aWRlZFxuICAgIGlmIChhbGVydEVtYWlsKSB7XG4gICAgICB0aGlzLmFsZXJ0VG9waWMuYWRkU3Vic2NyaXB0aW9uKFxuICAgICAgICBuZXcgc25zU3Vic2NyaXB0aW9ucy5FbWFpbFN1YnNjcmlwdGlvbihhbGVydEVtYWlsKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgb3BlcmF0aW9uYWwgZGFzaGJvYXJkXG4gICAgdGhpcy5vcGVyYXRpb25hbERhc2hib2FyZCA9IHRoaXMuY3JlYXRlT3BlcmF0aW9uYWxEYXNoYm9hcmQoXG4gICAgICBlbnZpcm9ubWVudCxcbiAgICAgIHNjaGVkdWxlckZ1bmN0aW9uLFxuICAgICAgcHVibGlzaGVyRnVuY3Rpb24sXG4gICAgICBzdGF0dXNVcGRhdGVyRnVuY3Rpb24sXG4gICAgICByZXRyeVByb2Nlc3NvckZ1bmN0aW9uLFxuICAgICAgc2NoZWR1bGVyVGFibGUsXG4gICAgICByZXRyeVRhYmxlXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBidXNpbmVzcyBtZXRyaWNzIGRhc2hib2FyZFxuICAgIHRoaXMuYnVzaW5lc3NEYXNoYm9hcmQgPSB0aGlzLmNyZWF0ZUJ1c2luZXNzRGFzaGJvYXJkKFxuICAgICAgZW52aXJvbm1lbnQsXG4gICAgICBwdWJsaXNoZXJGdW5jdGlvbixcbiAgICAgIHNjaGVkdWxlclRhYmxlXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBjb3N0IG1vbml0b3JpbmcgZGFzaGJvYXJkXG4gICAgdGhpcy5jb3N0RGFzaGJvYXJkID0gdGhpcy5jcmVhdGVDb3N0RGFzaGJvYXJkKGVudmlyb25tZW50KTtcblxuICAgIC8vIENyZWF0ZSBTTEEgbW9uaXRvcmluZyBkYXNoYm9hcmRcbiAgICB0aGlzLnNsYURhc2hib2FyZCA9IHRoaXMuY3JlYXRlU0xBRGFzaGJvYXJkKFxuICAgICAgZW52aXJvbm1lbnQsXG4gICAgICBwdWJsaXNoZXJGdW5jdGlvbixcbiAgICAgIHNjaGVkdWxlclRhYmxlXG4gICAgKTtcblxuICAgIC8vIFNldCB1cCBjcml0aWNhbCBhbGFybXNcbiAgICB0aGlzLnNldHVwQ3JpdGljYWxBbGFybXMoXG4gICAgICBlbnZpcm9ubWVudCxcbiAgICAgIHNjaGVkdWxlckZ1bmN0aW9uLFxuICAgICAgcHVibGlzaGVyRnVuY3Rpb24sXG4gICAgICBzdGF0dXNVcGRhdGVyRnVuY3Rpb24sXG4gICAgICByZXRyeVByb2Nlc3NvckZ1bmN0aW9uLFxuICAgICAgc2NoZWR1bGVyVGFibGUsXG4gICAgICByZXRyeVRhYmxlXG4gICAgKTtcblxuICAgIC8vIE5vdGU6IFgtUmF5IHRyYWNpbmcgc2hvdWxkIGJlIGVuYWJsZWQgYXQgTGFtYmRhIGZ1bmN0aW9uIGNyZWF0aW9uIHdpdGg6XG4gICAgLy8gdHJhY2luZzogbGFtYmRhLlRyYWNpbmcuQUNUSVZFXG4gICAgLy8gVGhpcyBpcyBoYW5kbGVkIGluIHRoZSBMYW1iZGEgZnVuY3Rpb24gZGVmaW5pdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgb3BlcmF0aW9uYWwgZGFzaGJvYXJkIGZvciBzeXN0ZW0gaGVhbHRoIG1vbml0b3JpbmdcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlT3BlcmF0aW9uYWxEYXNoYm9hcmQoXG4gICAgZW52aXJvbm1lbnQ6IHN0cmluZyxcbiAgICBzY2hlZHVsZXJGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uLFxuICAgIHB1Ymxpc2hlckZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb24sXG4gICAgc3RhdHVzVXBkYXRlckZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb24sXG4gICAgcmV0cnlQcm9jZXNzb3JGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uLFxuICAgIHNjaGVkdWxlclRhYmxlOiBkeW5hbW9kYi5UYWJsZSxcbiAgICByZXRyeVRhYmxlOiBkeW5hbW9kYi5UYWJsZVxuICApOiBjbG91ZHdhdGNoLkRhc2hib2FyZCB7XG4gICAgY29uc3QgZGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdPcGVyYXRpb25hbERhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6IGBDb250ZW50U2NoZWR1bGVyLU9wZXJhdGlvbmFsLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIHBlcmlvZE92ZXJyaWRlOiBjbG91ZHdhdGNoLlBlcmlvZE92ZXJyaWRlLkFVVE8sXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgbWV0cmljc1xuICAgIGNvbnN0IGxhbWJkYU1ldHJpY3MgPSBbXG4gICAgICBzY2hlZHVsZXJGdW5jdGlvbixcbiAgICAgIHB1Ymxpc2hlckZ1bmN0aW9uLFxuICAgICAgc3RhdHVzVXBkYXRlckZ1bmN0aW9uLFxuICAgICAgcmV0cnlQcm9jZXNzb3JGdW5jdGlvbixcbiAgICBdLm1hcChmbiA9PiAoe1xuICAgICAgaW52b2NhdGlvbnM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0FXUy9MYW1iZGEnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnSW52b2NhdGlvbnMnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEZ1bmN0aW9uTmFtZTogZm4uZnVuY3Rpb25OYW1lIH0sXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICB9KSxcbiAgICAgIGVycm9yczogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0xhbWJkYScsXG4gICAgICAgIG1ldHJpY05hbWU6ICdFcnJvcnMnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEZ1bmN0aW9uTmFtZTogZm4uZnVuY3Rpb25OYW1lIH0sXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICB9KSxcbiAgICAgIGR1cmF0aW9uOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvTGFtYmRhJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0R1cmF0aW9uJyxcbiAgICAgICAgZGltZW5zaW9uc01hcDogeyBGdW5jdGlvbk5hbWU6IGZuLmZ1bmN0aW9uTmFtZSB9LFxuICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgIH0pLFxuICAgICAgY29uY3VycmVudEV4ZWN1dGlvbnM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0FXUy9MYW1iZGEnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQ29uY3VycmVudEV4ZWN1dGlvbnMnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEZ1bmN0aW9uTmFtZTogZm4uZnVuY3Rpb25OYW1lIH0sXG4gICAgICAgIHN0YXRpc3RpYzogJ01heGltdW0nLFxuICAgICAgfSksXG4gICAgfSkpO1xuXG4gICAgLy8gQWRkIExhbWJkYSB3aWRnZXRzXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnTGFtYmRhIEludm9jYXRpb25zJyxcbiAgICAgICAgbGVmdDogbGFtYmRhTWV0cmljcy5tYXAobSA9PiBtLmludm9jYXRpb25zKSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdMYW1iZGEgRXJyb3JzJyxcbiAgICAgICAgbGVmdDogbGFtYmRhTWV0cmljcy5tYXAobSA9PiBtLmVycm9ycyksXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnTGFtYmRhIER1cmF0aW9uIChtcyknLFxuICAgICAgICBsZWZ0OiBsYW1iZGFNZXRyaWNzLm1hcChtID0+IG0uZHVyYXRpb24pLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0xhbWJkYSBDb25jdXJyZW50IEV4ZWN1dGlvbnMnLFxuICAgICAgICBsZWZ0OiBsYW1iZGFNZXRyaWNzLm1hcChtID0+IG0uY29uY3VycmVudEV4ZWN1dGlvbnMpLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIER5bmFtb0RCIG1ldHJpY3NcbiAgICBjb25zdCBkeW5hbW9NZXRyaWNzID0gW3NjaGVkdWxlclRhYmxlLCByZXRyeVRhYmxlXS5tYXAodGFibGUgPT4gKHtcbiAgICAgIGNvbnN1bWVkUmVhZENhcGFjaXR5OiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRHluYW1vREInLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQ29uc3VtZWRSZWFkQ2FwYWNpdHlVbml0cycsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgVGFibGVOYW1lOiB0YWJsZS50YWJsZU5hbWUgfSxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgIH0pLFxuICAgICAgY29uc3VtZWRXcml0ZUNhcGFjaXR5OiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRHluYW1vREInLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQ29uc3VtZWRXcml0ZUNhcGFjaXR5VW5pdHMnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFRhYmxlTmFtZTogdGFibGUudGFibGVOYW1lIH0sXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICB9KSxcbiAgICAgIHRocm90dGxlZFJlcXVlc3RzOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRHluYW1vREInLFxuICAgICAgICBtZXRyaWNOYW1lOiAnVXNlckVycm9ycycsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgVGFibGVOYW1lOiB0YWJsZS50YWJsZU5hbWUgfSxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgIH0pLFxuICAgIH0pKTtcblxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0R5bmFtb0RCIFJlYWQgQ2FwYWNpdHknLFxuICAgICAgICBsZWZ0OiBkeW5hbW9NZXRyaWNzLm1hcChtID0+IG0uY29uc3VtZWRSZWFkQ2FwYWNpdHkpLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0R5bmFtb0RCIFdyaXRlIENhcGFjaXR5JyxcbiAgICAgICAgbGVmdDogZHluYW1vTWV0cmljcy5tYXAobSA9PiBtLmNvbnN1bWVkV3JpdGVDYXBhY2l0eSksXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgcmV0dXJuIGRhc2hib2FyZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYnVzaW5lc3MgbWV0cmljcyBkYXNoYm9hcmRcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlQnVzaW5lc3NEYXNoYm9hcmQoXG4gICAgZW52aXJvbm1lbnQ6IHN0cmluZyxcbiAgICBfcHVibGlzaGVyRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbixcbiAgICBfc2NoZWR1bGVyVGFibGU6IGR5bmFtb2RiLlRhYmxlXG4gICk6IGNsb3Vkd2F0Y2guRGFzaGJvYXJkIHtcbiAgICBjb25zdCBkYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ0J1c2luZXNzRGFzaGJvYXJkJywge1xuICAgICAgZGFzaGJvYXJkTmFtZTogYENvbnRlbnRTY2hlZHVsZXItQnVzaW5lc3MtJHtlbnZpcm9ubWVudH1gLFxuICAgICAgcGVyaW9kT3ZlcnJpZGU6IGNsb3Vkd2F0Y2guUGVyaW9kT3ZlcnJpZGUuQVVUTyxcbiAgICB9KTtcblxuICAgIC8vIEN1c3RvbSBidXNpbmVzcyBtZXRyaWNzXG4gICAgY29uc3QgcHVibGlzaGluZ1N1Y2Nlc3NSYXRlID0gbmV3IGNsb3Vkd2F0Y2guTWF0aEV4cHJlc3Npb24oe1xuICAgICAgZXhwcmVzc2lvbjogJyhtMSAtIG0yKSAvIG0xICogMTAwJyxcbiAgICAgIHVzaW5nTWV0cmljczoge1xuICAgICAgICBtMTogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgICBtZXRyaWNOYW1lOiAnUHVibGlzaGluZ0F0dGVtcHRzJyxcbiAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICB9KSxcbiAgICAgICAgbTI6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgbmFtZXNwYWNlOiAnQ29udGVudFNjaGVkdWxlcicsXG4gICAgICAgICAgbWV0cmljTmFtZTogJ1B1Ymxpc2hpbmdGYWlsdXJlcycsXG4gICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgICAgbGFiZWw6ICdQdWJsaXNoaW5nIFN1Y2Nlc3MgUmF0ZSAoJSknLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcGxhdGZvcm1NZXRyaWNzID0gWydpbnN0YWdyYW0nLCAndGlrdG9rJywgJ3lvdXR1YmUnXS5tYXAocGxhdGZvcm0gPT4gKHtcbiAgICAgIGF0dGVtcHRzOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ1B1Ymxpc2hpbmdBdHRlbXB0cycsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgUGxhdGZvcm06IHBsYXRmb3JtIH0sXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICB9KSxcbiAgICAgIGZhaWx1cmVzOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ1B1Ymxpc2hpbmdGYWlsdXJlcycsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgUGxhdGZvcm06IHBsYXRmb3JtIH0sXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICB9KSxcbiAgICAgIGxhdGVuY3k6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0NvbnRlbnRTY2hlZHVsZXInLFxuICAgICAgICBtZXRyaWNOYW1lOiAnUHVibGlzaGluZ0xhdGVuY3knLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFBsYXRmb3JtOiBwbGF0Zm9ybSB9LFxuICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgIH0pLFxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBidXNpbmVzcyBtZXRyaWNzIHdpZGdldHNcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlNpbmdsZVZhbHVlV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdPdmVyYWxsIFN1Y2Nlc3MgUmF0ZScsXG4gICAgICAgIG1ldHJpY3M6IFtwdWJsaXNoaW5nU3VjY2Vzc1JhdGVdLFxuICAgICAgICB3aWR0aDogNixcbiAgICAgICAgaGVpZ2h0OiA0LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5TaW5nbGVWYWx1ZVdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnVG90YWwgUG9zdHMgUHVibGlzaGVkJyxcbiAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQb3N0c1B1Ymxpc2hlZCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogNixcbiAgICAgICAgaGVpZ2h0OiA0LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5TaW5nbGVWYWx1ZVdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnUG9zdHMgU2NoZWR1bGVkJyxcbiAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQb3N0c1NjaGVkdWxlZCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogNixcbiAgICAgICAgaGVpZ2h0OiA0LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5TaW5nbGVWYWx1ZVdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnUmV0cnkgUXVldWUgRGVwdGgnLFxuICAgICAgICBtZXRyaWNzOiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0NvbnRlbnRTY2hlZHVsZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1JldHJ5UXVldWVEZXB0aCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdNYXhpbXVtJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDYsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFBsYXRmb3JtLXNwZWNpZmljIG1ldHJpY3NcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdQdWJsaXNoaW5nIGJ5IFBsYXRmb3JtJyxcbiAgICAgICAgbGVmdDogcGxhdGZvcm1NZXRyaWNzLm1hcChtID0+IG0uYXR0ZW1wdHMpLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgICAgc3RhY2tlZDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0ZhaWx1cmVzIGJ5IFBsYXRmb3JtJyxcbiAgICAgICAgbGVmdDogcGxhdGZvcm1NZXRyaWNzLm1hcChtID0+IG0uZmFpbHVyZXMpLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgICAgc3RhY2tlZDogdHJ1ZSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1B1Ymxpc2hpbmcgTGF0ZW5jeSBieSBQbGF0Zm9ybSAobXMpJyxcbiAgICAgICAgbGVmdDogcGxhdGZvcm1NZXRyaWNzLm1hcChtID0+IG0ubGF0ZW5jeSksXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gQ29udGVudCB0eXBlIG1ldHJpY3NcbiAgICBjb25zdCBjb250ZW50VHlwZU1ldHJpY3MgPSBbJ2ltYWdlJywgJ3ZpZGVvJywgJ2Nhcm91c2VsJ10ubWFwKHR5cGUgPT4gXG4gICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ1Bvc3RzUHVibGlzaGVkJyxcbiAgICAgICAgZGltZW5zaW9uc01hcDogeyBDb250ZW50VHlwZTogdHlwZSB9LFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnQ29udGVudCBUeXBlcyBQdWJsaXNoZWQnLFxuICAgICAgICBsZWZ0OiBjb250ZW50VHlwZU1ldHJpY3MsXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICB2aWV3OiBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0Vmlldy5QSUUsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdQdWJsaXNoaW5nIFRyZW5kcycsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQ29udGVudFNjaGVkdWxlcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUG9zdHNQdWJsaXNoZWQnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgcmV0dXJuIGRhc2hib2FyZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgY29zdCBtb25pdG9yaW5nIGRhc2hib2FyZFxuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVDb3N0RGFzaGJvYXJkKGVudmlyb25tZW50OiBzdHJpbmcpOiBjbG91ZHdhdGNoLkRhc2hib2FyZCB7XG4gICAgY29uc3QgZGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdDb3N0RGFzaGJvYXJkJywge1xuICAgICAgZGFzaGJvYXJkTmFtZTogYENvbnRlbnRTY2hlZHVsZXItQ29zdC0ke2Vudmlyb25tZW50fWAsXG4gICAgICBwZXJpb2RPdmVycmlkZTogY2xvdWR3YXRjaC5QZXJpb2RPdmVycmlkZS5BVVRPLFxuICAgIH0pO1xuXG4gICAgLy8gQ29zdCBtZXRyaWNzXG4gICAgY29uc3QgY29zdE1ldHJpY3MgPSB7XG4gICAgICBsYW1iZGE6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0FXUy9CaWxsaW5nJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0VzdGltYXRlZENoYXJnZXMnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFxuICAgICAgICAgIEN1cnJlbmN5OiAnVVNEJyxcbiAgICAgICAgICBTZXJ2aWNlTmFtZTogJ0FXU0xhbWJkYScsXG4gICAgICAgIH0sXG4gICAgICAgIHN0YXRpc3RpYzogJ01heGltdW0nLFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLmhvdXJzKDI0KSxcbiAgICAgIH0pLFxuICAgICAgZHluYW1vZGI6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0FXUy9CaWxsaW5nJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0VzdGltYXRlZENoYXJnZXMnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFxuICAgICAgICAgIEN1cnJlbmN5OiAnVVNEJyxcbiAgICAgICAgICBTZXJ2aWNlTmFtZTogJ0FtYXpvbkR5bmFtb0RCJyxcbiAgICAgICAgfSxcbiAgICAgICAgc3RhdGlzdGljOiAnTWF4aW11bScsXG4gICAgICAgIHBlcmlvZDogRHVyYXRpb24uaG91cnMoMjQpLFxuICAgICAgfSksXG4gICAgICBzZWNyZXRzTWFuYWdlcjogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0JpbGxpbmcnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnRXN0aW1hdGVkQ2hhcmdlcycsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgXG4gICAgICAgICAgQ3VycmVuY3k6ICdVU0QnLFxuICAgICAgICAgIFNlcnZpY2VOYW1lOiAnQVdTU2VjcmV0c01hbmFnZXInLFxuICAgICAgICB9LFxuICAgICAgICBzdGF0aXN0aWM6ICdNYXhpbXVtJyxcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5ob3VycygyNCksXG4gICAgICB9KSxcbiAgICB9O1xuXG4gICAgY29uc3QgY29zdFBlcjEwMDBQb3N0cyA9IG5ldyBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uKHtcbiAgICAgIGV4cHJlc3Npb246ICcobTEgKyBtMiArIG0zKSAvIG00ICogMTAwMCcsXG4gICAgICB1c2luZ01ldHJpY3M6IHtcbiAgICAgICAgbTE6IGNvc3RNZXRyaWNzLmxhbWJkYSxcbiAgICAgICAgbTI6IGNvc3RNZXRyaWNzLmR5bmFtb2RiLFxuICAgICAgICBtMzogY29zdE1ldHJpY3Muc2VjcmV0c01hbmFnZXIsXG4gICAgICAgIG00OiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgIG5hbWVzcGFjZTogJ0NvbnRlbnRTY2hlZHVsZXInLFxuICAgICAgICAgIG1ldHJpY05hbWU6ICdQb3N0c1B1Ymxpc2hlZCcsXG4gICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLmhvdXJzKDI0KSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgICAgbGFiZWw6ICdDb3N0IHBlciAxMDAwIFBvc3RzICgkKScsXG4gICAgfSk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlNpbmdsZVZhbHVlV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdEYWlseSBMYW1iZGEgQ29zdCcsXG4gICAgICAgIG1ldHJpY3M6IFtjb3N0TWV0cmljcy5sYW1iZGFdLFxuICAgICAgICB3aWR0aDogNixcbiAgICAgICAgaGVpZ2h0OiA0LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5TaW5nbGVWYWx1ZVdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnRGFpbHkgRHluYW1vREIgQ29zdCcsXG4gICAgICAgIG1ldHJpY3M6IFtjb3N0TWV0cmljcy5keW5hbW9kYl0sXG4gICAgICAgIHdpZHRoOiA2LFxuICAgICAgICBoZWlnaHQ6IDQsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlNpbmdsZVZhbHVlV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdEYWlseSBTZWNyZXRzIE1hbmFnZXIgQ29zdCcsXG4gICAgICAgIG1ldHJpY3M6IFtjb3N0TWV0cmljcy5zZWNyZXRzTWFuYWdlcl0sXG4gICAgICAgIHdpZHRoOiA2LFxuICAgICAgICBoZWlnaHQ6IDQsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlNpbmdsZVZhbHVlV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdDb3N0IHBlciAxMDAwIFBvc3RzJyxcbiAgICAgICAgbWV0cmljczogW2Nvc3RQZXIxMDAwUG9zdHNdLFxuICAgICAgICB3aWR0aDogNixcbiAgICAgICAgaGVpZ2h0OiA0LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnQ29zdCBUcmVuZCAoRGFpbHkpJyxcbiAgICAgICAgbGVmdDogW2Nvc3RNZXRyaWNzLmxhbWJkYSwgY29zdE1ldHJpY3MuZHluYW1vZGIsIGNvc3RNZXRyaWNzLnNlY3JldHNNYW5hZ2VyXSxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgIHN0YWNrZWQ6IHRydWUsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICByZXR1cm4gZGFzaGJvYXJkO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBTTEEgbW9uaXRvcmluZyBkYXNoYm9hcmRcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlU0xBRGFzaGJvYXJkKFxuICAgIGVudmlyb25tZW50OiBzdHJpbmcsXG4gICAgcHVibGlzaGVyRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbixcbiAgICBfc2NoZWR1bGVyVGFibGU6IGR5bmFtb2RiLlRhYmxlXG4gICk6IGNsb3Vkd2F0Y2guRGFzaGJvYXJkIHtcbiAgICBjb25zdCBkYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ1NMQURhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6IGBDb250ZW50U2NoZWR1bGVyLVNMQS0ke2Vudmlyb25tZW50fWAsXG4gICAgICBwZXJpb2RPdmVycmlkZTogY2xvdWR3YXRjaC5QZXJpb2RPdmVycmlkZS5BVVRPLFxuICAgIH0pO1xuXG4gICAgLy8gU0xBIG1ldHJpY3NcbiAgICBjb25zdCBzbGFNZXRyaWNzID0ge1xuICAgICAgYXZhaWxhYmlsaXR5OiBuZXcgY2xvdWR3YXRjaC5NYXRoRXhwcmVzc2lvbih7XG4gICAgICAgIGV4cHJlc3Npb246ICcxMDAgLSAobTEgLyBtMiAqIDEwMCknLFxuICAgICAgICB1c2luZ01ldHJpY3M6IHtcbiAgICAgICAgICBtMTogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9MYW1iZGEnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0Vycm9ycycsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEZ1bmN0aW9uTmFtZTogcHVibGlzaGVyRnVuY3Rpb24uZnVuY3Rpb25OYW1lIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG0yOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0xhbWJkYScsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBGdW5jdGlvbk5hbWU6IHB1Ymxpc2hlckZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSxcbiAgICAgICAgbGFiZWw6ICdTZXJ2aWNlIEF2YWlsYWJpbGl0eSAoJSknLFxuICAgICAgfSksXG4gICAgICBwdWJsaXNoaW5nU3VjY2VzczogbmV3IGNsb3Vkd2F0Y2guTWF0aEV4cHJlc3Npb24oe1xuICAgICAgICBleHByZXNzaW9uOiAnKG0xIC0gbTIpIC8gbTEgKiAxMDAnLFxuICAgICAgICB1c2luZ01ldHJpY3M6IHtcbiAgICAgICAgICBtMTogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0NvbnRlbnRTY2hlZHVsZXInLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1B1Ymxpc2hpbmdBdHRlbXB0cycsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG0yOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQ29udGVudFNjaGVkdWxlcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUHVibGlzaGluZ0ZhaWx1cmVzJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICAgIGxhYmVsOiAnUHVibGlzaGluZyBTdWNjZXNzIFJhdGUgKCUpJyxcbiAgICAgIH0pLFxuICAgICAgc2NoZWR1bGluZ0xhdGVuY3k6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0NvbnRlbnRTY2hlZHVsZXInLFxuICAgICAgICBtZXRyaWNOYW1lOiAnU2NoZWR1bGluZ0xhdGVuY3knLFxuICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgIH0pLFxuICAgICAgYXBpUmVzcG9uc2VUaW1lOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0FQSVJlc3BvbnNlVGltZScsXG4gICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgfSksXG4gICAgfTtcblxuICAgIC8vIFNMQSB0YXJnZXRzXG4gICAgY29uc3Qgc2xhVGFyZ2V0cyA9IHtcbiAgICAgIGF2YWlsYWJpbGl0eTogOTkuOTksXG4gICAgICBwdWJsaXNoaW5nU3VjY2VzczogOTkuOTksXG4gICAgICBzY2hlZHVsaW5nTGF0ZW5jeTogNjAwMDAsIC8vIDYwIHNlY29uZHMgaW4gbXNcbiAgICAgIGFwaVJlc3BvbnNlVGltZTogMjAwLCAvLyAyMDBtc1xuICAgIH07XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlNpbmdsZVZhbHVlV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdTZXJ2aWNlIEF2YWlsYWJpbGl0eSAoVGFyZ2V0OiA5OS45OSUpJyxcbiAgICAgICAgbWV0cmljczogW3NsYU1ldHJpY3MuYXZhaWxhYmlsaXR5XSxcbiAgICAgICAgd2lkdGg6IDYsXG4gICAgICAgIGhlaWdodDogNCxcbiAgICAgICAgc2V0UGVyaW9kVG9UaW1lUmFuZ2U6IHRydWUsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLlNpbmdsZVZhbHVlV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdQdWJsaXNoaW5nIFN1Y2Nlc3MgUmF0ZSAoVGFyZ2V0OiA5OS45OSUpJyxcbiAgICAgICAgbWV0cmljczogW3NsYU1ldHJpY3MucHVibGlzaGluZ1N1Y2Nlc3NdLFxuICAgICAgICB3aWR0aDogNixcbiAgICAgICAgaGVpZ2h0OiA0LFxuICAgICAgICBzZXRQZXJpb2RUb1RpbWVSYW5nZTogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guU2luZ2xlVmFsdWVXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0F2ZyBTY2hlZHVsaW5nIExhdGVuY3kgKFRhcmdldDogPDYwcyknLFxuICAgICAgICBtZXRyaWNzOiBbc2xhTWV0cmljcy5zY2hlZHVsaW5nTGF0ZW5jeV0sXG4gICAgICAgIHdpZHRoOiA2LFxuICAgICAgICBoZWlnaHQ6IDQsXG4gICAgICAgIHNldFBlcmlvZFRvVGltZVJhbmdlOiB0cnVlLFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5TaW5nbGVWYWx1ZVdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnQXZnIEFQSSBSZXNwb25zZSBUaW1lIChUYXJnZXQ6IDwyMDBtcyknLFxuICAgICAgICBtZXRyaWNzOiBbc2xhTWV0cmljcy5hcGlSZXNwb25zZVRpbWVdLFxuICAgICAgICB3aWR0aDogNixcbiAgICAgICAgaGVpZ2h0OiA0LFxuICAgICAgICBzZXRQZXJpb2RUb1RpbWVSYW5nZTogdHJ1ZSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFNMQSBjb21wbGlhbmNlIG92ZXIgdGltZVxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1NMQSBDb21wbGlhbmNlIFRyZW5kcycsXG4gICAgICAgIGxlZnQ6IFtzbGFNZXRyaWNzLmF2YWlsYWJpbGl0eSwgc2xhTWV0cmljcy5wdWJsaXNoaW5nU3VjY2Vzc10sXG4gICAgICAgIHJpZ2h0OiBbc2xhTWV0cmljcy5zY2hlZHVsaW5nTGF0ZW5jeSwgc2xhTWV0cmljcy5hcGlSZXNwb25zZVRpbWVdLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogOCxcbiAgICAgICAgbGVmdFlBeGlzOiB7IG1pbjogOTUsIG1heDogMTAwLCBsYWJlbDogJ1BlcmNlbnRhZ2UgKCUpJyB9LFxuICAgICAgICByaWdodFlBeGlzOiB7IG1pbjogMCwgbGFiZWw6ICdUaW1lIChtcyknIH0sXG4gICAgICAgIGxlZnRBbm5vdGF0aW9uczogW1xuICAgICAgICAgIHsgdmFsdWU6IHNsYVRhcmdldHMuYXZhaWxhYmlsaXR5LCBsYWJlbDogJ0F2YWlsYWJpbGl0eSBUYXJnZXQnLCBjb2xvcjogJyMwMGZmMDAnIH0sXG4gICAgICAgICAgeyB2YWx1ZTogc2xhVGFyZ2V0cy5wdWJsaXNoaW5nU3VjY2VzcywgbGFiZWw6ICdTdWNjZXNzIFJhdGUgVGFyZ2V0JywgY29sb3I6ICcjMDAwMGZmJyB9LFxuICAgICAgICBdLFxuICAgICAgICByaWdodEFubm90YXRpb25zOiBbXG4gICAgICAgICAgeyB2YWx1ZTogc2xhVGFyZ2V0cy5zY2hlZHVsaW5nTGF0ZW5jeSwgbGFiZWw6ICdMYXRlbmN5IFRhcmdldCcsIGNvbG9yOiAnI2ZmMDAwMCcgfSxcbiAgICAgICAgICB7IHZhbHVlOiBzbGFUYXJnZXRzLmFwaVJlc3BvbnNlVGltZSwgbGFiZWw6ICdSZXNwb25zZSBUaW1lIFRhcmdldCcsIGNvbG9yOiAnI2ZmMDBmZicgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIHJldHVybiBkYXNoYm9hcmQ7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHVwIGNyaXRpY2FsIGFsYXJtc1xuICAgKi9cbiAgcHJpdmF0ZSBzZXR1cENyaXRpY2FsQWxhcm1zKFxuICAgIGVudmlyb25tZW50OiBzdHJpbmcsXG4gICAgc2NoZWR1bGVyRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbixcbiAgICBwdWJsaXNoZXJGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uLFxuICAgIHN0YXR1c1VwZGF0ZXJGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uLFxuICAgIHJldHJ5UHJvY2Vzc29yRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbixcbiAgICBzY2hlZHVsZXJUYWJsZTogZHluYW1vZGIuVGFibGUsXG4gICAgcmV0cnlUYWJsZTogZHluYW1vZGIuVGFibGVcbiAgKTogdm9pZCB7XG4gICAgLy8gUHVibGlzaGluZyBmYWlsdXJlcyBhbGFybVxuICAgIGNvbnN0IHB1Ymxpc2hpbmdGYWlsdXJlc0FsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1B1Ymxpc2hpbmdGYWlsdXJlc0FsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiBgJHtlbnZpcm9ubWVudH0tQ29udGVudFNjaGVkdWxlci1QdWJsaXNoaW5nRmFpbHVyZXNgLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsZXJ0IHdoZW4gcHVibGlzaGluZyBmYWlsdXJlcyBleGNlZWQgdGhyZXNob2xkJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnQ29udGVudFNjaGVkdWxlcicsXG4gICAgICAgIG1ldHJpY05hbWU6ICdQdWJsaXNoaW5nRmFpbHVyZXMnLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG4gICAgcHVibGlzaGluZ0ZhaWx1cmVzQWxhcm0uYWRkQWxhcm1BY3Rpb24oXG4gICAgICBuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKHRoaXMuYWxlcnRUb3BpYylcbiAgICApO1xuXG4gICAgLy8gUmV0cnkgcXVldWUgZGVwdGggYWxhcm1cbiAgICBjb25zdCByZXRyeVF1ZXVlQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnUmV0cnlRdWV1ZURlcHRoQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IGAke2Vudmlyb25tZW50fS1Db250ZW50U2NoZWR1bGVyLVJldHJ5UXVldWVEZXB0aGAsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxlcnQgd2hlbiByZXRyeSBxdWV1ZSBpcyB0b28gZGVlcCcsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0NvbnRlbnRTY2hlZHVsZXInLFxuICAgICAgICBtZXRyaWNOYW1lOiAnUmV0cnlRdWV1ZURlcHRoJyxcbiAgICAgICAgc3RhdGlzdGljOiAnTWF4aW11bScsXG4gICAgICAgIHBlcmlvZDogRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxMDAsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuICAgIHJldHJ5UXVldWVBbGFybS5hZGRBbGFybUFjdGlvbihcbiAgICAgIG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24odGhpcy5hbGVydFRvcGljKVxuICAgICk7XG5cbiAgICAvLyBMYW1iZGEgZHVyYXRpb24gYWxhcm1zXG4gICAgW1xuICAgICAgeyBmbjogc2NoZWR1bGVyRnVuY3Rpb24sIG5hbWU6ICdTY2hlZHVsZXInLCB0aHJlc2hvbGQ6IDI0MDAwMCB9LCAvLyA0IG1pbnV0ZXNcbiAgICAgIHsgZm46IHB1Ymxpc2hlckZ1bmN0aW9uLCBuYW1lOiAnUHVibGlzaGVyJywgdGhyZXNob2xkOiAyNDAwMDAgfSxcbiAgICAgIHsgZm46IHN0YXR1c1VwZGF0ZXJGdW5jdGlvbiwgbmFtZTogJ1N0YXR1c1VwZGF0ZXInLCB0aHJlc2hvbGQ6IDYwMDAwIH0sIC8vIDEgbWludXRlXG4gICAgICB7IGZuOiByZXRyeVByb2Nlc3NvckZ1bmN0aW9uLCBuYW1lOiAnUmV0cnlQcm9jZXNzb3InLCB0aHJlc2hvbGQ6IDI0MDAwMCB9LFxuICAgIF0uZm9yRWFjaCgoeyBmbiwgbmFtZSwgdGhyZXNob2xkIH0pID0+IHtcbiAgICAgIGNvbnN0IGR1cmF0aW9uQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCBgJHtuYW1lfUR1cmF0aW9uQWxhcm1gLCB7XG4gICAgICAgIGFsYXJtTmFtZTogYCR7ZW52aXJvbm1lbnR9LUNvbnRlbnRTY2hlZHVsZXItJHtuYW1lfS1EdXJhdGlvbmAsXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246IGBBbGVydCB3aGVuICR7bmFtZX0gZnVuY3Rpb24gZHVyYXRpb24gZXhjZWVkcyB0aHJlc2hvbGRgLFxuICAgICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0xhbWJkYScsXG4gICAgICAgICAgbWV0cmljTmFtZTogJ0R1cmF0aW9uJyxcbiAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEZ1bmN0aW9uTmFtZTogZm4uZnVuY3Rpb25OYW1lIH0sXG4gICAgICAgICAgc3RhdGlzdGljOiAnTWF4aW11bScsXG4gICAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICB9KSxcbiAgICAgICAgdGhyZXNob2xkLFxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgICB9KTtcbiAgICAgIGR1cmF0aW9uQWxhcm0uYWRkQWxhcm1BY3Rpb24oXG4gICAgICAgIG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24odGhpcy5hbGVydFRvcGljKVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIC8vIER5bmFtb0RCIHRocm90dGxpbmcgYWxhcm1zXG4gICAgW3NjaGVkdWxlclRhYmxlLCByZXRyeVRhYmxlXS5mb3JFYWNoKHRhYmxlID0+IHtcbiAgICAgIGNvbnN0IHRocm90dGxlQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCBgJHt0YWJsZS5ub2RlLmlkfVRocm90dGxlQWxhcm1gLCB7XG4gICAgICAgIGFsYXJtTmFtZTogYCR7ZW52aXJvbm1lbnR9LUNvbnRlbnRTY2hlZHVsZXItJHt0YWJsZS50YWJsZU5hbWV9LVRocm90dGxpbmdgLFxuICAgICAgICBhbGFybURlc2NyaXB0aW9uOiBgQWxlcnQgd2hlbiAke3RhYmxlLnRhYmxlTmFtZX0gZXhwZXJpZW5jZXMgdGhyb3R0bGluZ2AsXG4gICAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRHluYW1vREInLFxuICAgICAgICAgIG1ldHJpY05hbWU6ICdVc2VyRXJyb3JzJyxcbiAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFRhYmxlTmFtZTogdGFibGUudGFibGVOYW1lIH0sXG4gICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgIH0pLFxuICAgICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgIH0pO1xuICAgICAgdGhyb3R0bGVBbGFybS5hZGRBbGFybUFjdGlvbihcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgLy8gQ29zdCBhbGFybVxuICAgIGNvbnN0IGNvc3RBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdEYWlseUNvc3RBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYCR7ZW52aXJvbm1lbnR9LUNvbnRlbnRTY2hlZHVsZXItRGFpbHlDb3N0YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGVydCB3aGVuIGRhaWx5IGNvc3QgZXhjZWVkcyB0aHJlc2hvbGQnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NYXRoRXhwcmVzc2lvbih7XG4gICAgICAgIGV4cHJlc3Npb246ICdtMSArIG0yICsgbTMnLFxuICAgICAgICB1c2luZ01ldHJpY3M6IHtcbiAgICAgICAgICBtMTogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9CaWxsaW5nJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdFc3RpbWF0ZWRDaGFyZ2VzJyxcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgQ3VycmVuY3k6ICdVU0QnLCBTZXJ2aWNlTmFtZTogJ0FXU0xhbWJkYScgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ01heGltdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5ob3VycygyNCksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbTI6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQmlsbGluZycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnRXN0aW1hdGVkQ2hhcmdlcycsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEN1cnJlbmN5OiAnVVNEJywgU2VydmljZU5hbWU6ICdBbWF6b25EeW5hbW9EQicgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ01heGltdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5ob3VycygyNCksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbTM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQmlsbGluZycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnRXN0aW1hdGVkQ2hhcmdlcycsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEN1cnJlbmN5OiAnVVNEJywgU2VydmljZU5hbWU6ICdBV1NTZWNyZXRzTWFuYWdlcicgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ01heGltdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5ob3VycygyNCksXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNTAsIC8vICQ1MCBwZXIgZGF5XG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuICAgIGNvc3RBbGFybS5hZGRBbGFybUFjdGlvbihcbiAgICAgIG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24odGhpcy5hbGVydFRvcGljKVxuICAgICk7XG5cbiAgICAvLyBTTEEgYnJlYWNoIGFsYXJtXG4gICAgY29uc3Qgc2xhQnJlYWNoQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnU0xBQnJlYWNoQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IGAke2Vudmlyb25tZW50fS1Db250ZW50U2NoZWR1bGVyLVNMQUJyZWFjaGAsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxlcnQgd2hlbiBTTEEgaXMgYnJlYWNoZWQgKD4xJSBmYWlsdXJlcyknLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NYXRoRXhwcmVzc2lvbih7XG4gICAgICAgIGV4cHJlc3Npb246ICcxMDAgLSAoKG0xIC0gbTIpIC8gbTEgKiAxMDApJyxcbiAgICAgICAgdXNpbmdNZXRyaWNzOiB7XG4gICAgICAgICAgbTE6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQdWJsaXNoaW5nQXR0ZW1wdHMnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbTI6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQdWJsaXNoaW5nRmFpbHVyZXMnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMSwgLy8gMSUgZmFpbHVyZSByYXRlXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuICAgIHNsYUJyZWFjaEFsYXJtLmFkZEFsYXJtQWN0aW9uKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpXG4gICAgKTtcbiAgfVxuXG4gIC8vIFgtUmF5IHRyYWNpbmcgc2hvdWxkIGJlIGVuYWJsZWQgYXQgTGFtYmRhIGZ1bmN0aW9uIGNyZWF0aW9uIHdpdGg6XG4gIC8vIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRVxuICAvLyBUaGlzIGlzIGhhbmRsZWQgaW4gdGhlIExhbWJkYSBmdW5jdGlvbiBkZWZpbml0aW9uc1xufSJdfQ==