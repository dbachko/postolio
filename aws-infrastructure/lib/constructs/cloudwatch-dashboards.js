"use strict";
/**
 * CloudWatch Dashboards Configuration
 * Comprehensive monitoring dashboards for all microservices
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
exports.CloudWatchDashboards = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const constructs_1 = require("constructs");
class CloudWatchDashboards extends constructs_1.Construct {
    mainDashboard;
    lambdaDashboard;
    dynamodbDashboard;
    sqsDashboard;
    constructor(scope, id, props) {
        super(scope, id);
        const { environment } = props;
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
        });
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
        });
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
        });
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
                            .map(([platform, queue]) => queue.metricApproximateNumberOfMessagesVisible({
                            label: `${platform} Queue`,
                        })) : [],
                    }),
                    // Queue Processing Rate
                    new cloudwatch.GraphWidget({
                        title: 'Message Processing Rate',
                        width: 12,
                        height: 6,
                        left: props.publisherQueues ? Object.entries(props.publisherQueues)
                            .filter(([_, queue]) => queue !== undefined)
                            .map(([platform, queue]) => queue.metricNumberOfMessagesReceived({
                            label: `${platform} Received`,
                            statistic: 'Sum',
                        })) : [],
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
                            .map(([platform, queue]) => queue.metricApproximateAgeOfOldestMessage({
                            label: `${platform} Oldest Message`,
                            statistic: 'Maximum',
                        })) : [],
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
        });
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
        });
    }
}
exports.CloudWatchDashboards = CloudWatchDashboards;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC1kYXNoYm9hcmRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2xvdWR3YXRjaC1kYXNoYm9hcmRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7O0dBR0c7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILGlEQUFrQztBQUNsQyx1RUFBd0Q7QUFLeEQsMkNBQXNDO0FBNEJ0QyxNQUFhLG9CQUFxQixTQUFRLHNCQUFTO0lBQ2pDLGFBQWEsQ0FBc0I7SUFDbkMsZUFBZSxDQUFzQjtJQUNyQyxpQkFBaUIsQ0FBc0I7SUFDdkMsWUFBWSxDQUFzQjtJQUVsRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFFaEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxHQUFHLEtBQUssQ0FBQTtRQUU3QixvRUFBb0U7UUFDcEUsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUNuRSxhQUFhLEVBQUUscUJBQXFCLFdBQVcsRUFBRTtZQUNqRCxPQUFPLEVBQUU7Z0JBQ1A7b0JBQ0UsdUJBQXVCO29CQUN2QixJQUFJLFVBQVUsQ0FBQyxXQUFXLENBQUM7d0JBQ3pCLEtBQUssRUFBRSx3QkFBd0I7d0JBQy9CLEtBQUssRUFBRSxFQUFFO3dCQUNULE1BQU0sRUFBRSxDQUFDO3dCQUNULElBQUksRUFBRTs0QkFDSixJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUM7Z0NBQ3BCLFNBQVMsRUFBRSxZQUFZO2dDQUN2QixVQUFVLEVBQUUsUUFBUTtnQ0FDcEIsU0FBUyxFQUFFLEtBQUs7Z0NBQ2hCLGFBQWEsRUFBRTtvQ0FDYixZQUFZLEVBQUUsS0FBSyxDQUFDLGtCQUFrQixFQUFFLFlBQVksSUFBSSxLQUFLO2lDQUM5RDtnQ0FDRCxLQUFLLEVBQUUsc0JBQXNCO2dDQUM3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QUNILENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRjtBQXRuQkQsb0RBc25CQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ2xvdWRXYXRjaCBEYXNoYm9hcmRzIENvbmZpZ3VyYXRpb25cbiAqIENvbXByZWhlbnNpdmUgbW9uaXRvcmluZyBkYXNoYm9hcmRzIGZvciBhbGwgbWljcm9zZXJ2aWNlc1xuICovXG5cbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSdcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYidcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJ1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xuXG5leHBvcnQgaW50ZXJmYWNlIERhc2hib2FyZENvbmZpZyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmdcbiAgdG9rZW5TZXJ2aWNlTGFtYmRhPzogbGFtYmRhLkZ1bmN0aW9uXG4gIHNjaGVkdWxlclNlcnZpY2VMYW1iZGE/OiBsYW1iZGEuRnVuY3Rpb25cbiAgcHVibGlzaGVyTGFtYmRhcz86IHtcbiAgICBpbnN0YWdyYW0/OiBsYW1iZGEuRnVuY3Rpb25cbiAgICBmYWNlYm9vaz86IGxhbWJkYS5GdW5jdGlvblxuICAgIGxpbmtlZGluPzogbGFtYmRhLkZ1bmN0aW9uXG4gICAgdGlrdG9rPzogbGFtYmRhLkZ1bmN0aW9uXG4gIH1cbiAgZGxxUHJvY2Vzc29yTGFtYmRhPzogbGFtYmRhLkZ1bmN0aW9uXG4gIHRva2VuVGFibGU/OiBkeW5hbW9kYi5UYWJsZVxuICBzY2hlZHVsZVRhYmxlPzogZHluYW1vZGIuVGFibGVcbiAgc2FnYVN0YXRlVGFibGU/OiBkeW5hbW9kYi5UYWJsZVxuICBjaXJjdWl0QnJlYWtlclRhYmxlPzogZHluYW1vZGIuVGFibGVcbiAgZGxxU3RhdGVUYWJsZT86IGR5bmFtb2RiLlRhYmxlXG4gIHB1Ymxpc2hlclF1ZXVlcz86IHtcbiAgICBpbnN0YWdyYW0/OiBzcXMuUXVldWVcbiAgICBmYWNlYm9vaz86IHNxcy5RdWV1ZVxuICAgIGxpbmtlZGluPzogc3FzLlF1ZXVlXG4gICAgdGlrdG9rPzogc3FzLlF1ZXVlXG4gIH1cbiAgcHVibGlzaGVyRExRPzogc3FzLlF1ZXVlXG4gIGV2ZW50QnVzPzogZXZlbnRzLkV2ZW50QnVzXG59XG5cbmV4cG9ydCBjbGFzcyBDbG91ZFdhdGNoRGFzaGJvYXJkcyBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBtYWluRGFzaGJvYXJkOiBjbG91ZHdhdGNoLkRhc2hib2FyZFxuICBwdWJsaWMgcmVhZG9ubHkgbGFtYmRhRGFzaGJvYXJkOiBjbG91ZHdhdGNoLkRhc2hib2FyZFxuICBwdWJsaWMgcmVhZG9ubHkgZHluYW1vZGJEYXNoYm9hcmQ6IGNsb3Vkd2F0Y2guRGFzaGJvYXJkXG4gIHB1YmxpYyByZWFkb25seSBzcXNEYXNoYm9hcmQ6IGNsb3Vkd2F0Y2guRGFzaGJvYXJkXG4gIFxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRGFzaGJvYXJkQ29uZmlnKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKVxuICAgIFxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQgfSA9IHByb3BzXG4gICAgXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gTWFpbiBPdmVydmlldyBEYXNoYm9hcmQgPT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLm1haW5EYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ01haW5EYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiBgUG9zdG9saW8tT3ZlcnZpZXctJHtlbnZpcm9ubWVudH1gLFxuICAgICAgd2lkZ2V0czogW1xuICAgICAgICBbXG4gICAgICAgICAgLy8gU3lzdGVtIEhlYWx0aCBXaWRnZXRcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ1N5c3RlbSBIZWFsdGggT3ZlcnZpZXcnLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9MYW1iZGEnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdFcnJvcnMnLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICAgICAgRnVuY3Rpb25OYW1lOiBwcm9wcy50b2tlblNlcnZpY2VMYW1iZGE/LmZ1bmN0aW9uTmFtZSB8fCAnTi9BJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnVG9rZW4gU2VydmljZSBFcnJvcnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLlJFRCxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0xhbWJkYScsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ1Rocm90dGxlcycsXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0xhbWJkYSBUaHJvdHRsZXMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLk9SQU5HRSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvTGFtYmRhJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnRHVyYXRpb24nLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnQXZlcmFnZSBEdXJhdGlvbicsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuQkxVRSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIFB1Ymxpc2hpbmcgU3VjY2VzcyBSYXRlIFdpZGdldFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLlNpbmdsZVZhbHVlV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnUHVibGlzaGluZyBTdWNjZXNzIFJhdGUnLFxuICAgICAgICAgICAgd2lkdGg6IDYsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBtZXRyaWNzOiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnUG9zdG9saW8vUHVibGlzaGluZycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ1N1Y2Nlc3NSYXRlJyxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIEFjdGl2ZSBDYW1wYWlnbnMgV2lkZ2V0XG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guU2luZ2xlVmFsdWVXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdBY3RpdmUgQ2FtcGFpZ25zJyxcbiAgICAgICAgICAgIHdpZHRoOiA2LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1Bvc3RvbGlvL0NhbXBhaWducycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FjdGl2ZUNhbXBhaWducycsXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnTWF4aW11bScsXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICBcbiAgICAgICAgLy8gU2Vjb25kIFJvd1xuICAgICAgICBbXG4gICAgICAgICAgLy8gRXZlbnQgUHJvY2Vzc2luZyBXaWRnZXRcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ0V2ZW50IFByb2Nlc3NpbmcnLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9FdmVudHMnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdTdWNjZXNzZnVsUnVsZU1hdGNoZXMnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgICAgIEV2ZW50QnVzTmFtZTogcHJvcHMuZXZlbnRCdXM/LmV2ZW50QnVzTmFtZSB8fCAnZGVmYXVsdCcsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnU3VjY2Vzc2Z1bCBFdmVudHMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkdSRUVOLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRXZlbnRzJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnRmFpbGVkSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgICAgIEV2ZW50QnVzTmFtZTogcHJvcHMuZXZlbnRCdXM/LmV2ZW50QnVzTmFtZSB8fCAnZGVmYXVsdCcsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnRmFpbGVkIEV2ZW50cycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuUkVELFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gRExRIFN0YXR1cyBXaWRnZXRcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ0RlYWQgTGV0dGVyIFF1ZXVlIFN0YXR1cycsXG4gICAgICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBsZWZ0OiBwcm9wcy5wdWJsaXNoZXJETFEgPyBbXG4gICAgICAgICAgICAgIHByb3BzLnB1Ymxpc2hlckRMUS5tZXRyaWNBcHByb3hpbWF0ZU51bWJlck9mTWVzc2FnZXNWaXNpYmxlKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ01lc3NhZ2VzIGluIERMUScsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuUkVELFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgcHJvcHMucHVibGlzaGVyRExRLm1ldHJpY0FwcHJveGltYXRlQWdlT2ZPbGRlc3RNZXNzYWdlKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ09sZGVzdCBNZXNzYWdlIEFnZScsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuT1JBTkdFLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ01heGltdW0nLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0gOiBbXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgXG4gICAgICAgIC8vIFRoaXJkIFJvdyAtIFBsYXRmb3JtLXNwZWNpZmljIG1ldHJpY3NcbiAgICAgICAgW1xuICAgICAgICAgIC8vIEluc3RhZ3JhbSBQdWJsaXNoaW5nXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdJbnN0YWdyYW0gUHVibGlzaGluZycsXG4gICAgICAgICAgICB3aWR0aDogNixcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIGxlZnQ6IHByb3BzLnB1Ymxpc2hlckxhbWJkYXM/Lmluc3RhZ3JhbSA/IFtcbiAgICAgICAgICAgICAgcHJvcHMucHVibGlzaGVyTGFtYmRhcy5pbnN0YWdyYW0ubWV0cmljSW52b2NhdGlvbnMoe1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkJMVUUsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBwcm9wcy5wdWJsaXNoZXJMYW1iZGFzLmluc3RhZ3JhbS5tZXRyaWNFcnJvcnMoe1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRXJyb3JzJyxcbiAgICAgICAgICAgICAgICBjb2xvcjogY2xvdWR3YXRjaC5Db2xvci5SRUQsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSA6IFtdLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIEZhY2Vib29rIFB1Ymxpc2hpbmdcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ0ZhY2Vib29rIFB1Ymxpc2hpbmcnLFxuICAgICAgICAgICAgd2lkdGg6IDYsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBsZWZ0OiBwcm9wcy5wdWJsaXNoZXJMYW1iZGFzPy5mYWNlYm9vayA/IFtcbiAgICAgICAgICAgICAgcHJvcHMucHVibGlzaGVyTGFtYmRhcy5mYWNlYm9vay5tZXRyaWNJbnZvY2F0aW9ucyh7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdJbnZvY2F0aW9ucycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuQkxVRSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIHByb3BzLnB1Ymxpc2hlckxhbWJkYXMuZmFjZWJvb2subWV0cmljRXJyb3JzKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0Vycm9ycycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuUkVELFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0gOiBbXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBMaW5rZWRJbiBQdWJsaXNoaW5nXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdMaW5rZWRJbiBQdWJsaXNoaW5nJyxcbiAgICAgICAgICAgIHdpZHRoOiA2LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogcHJvcHMucHVibGlzaGVyTGFtYmRhcz8ubGlua2VkaW4gPyBbXG4gICAgICAgICAgICAgIHByb3BzLnB1Ymxpc2hlckxhbWJkYXMubGlua2VkaW4ubWV0cmljSW52b2NhdGlvbnMoe1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkJMVUUsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBwcm9wcy5wdWJsaXNoZXJMYW1iZGFzLmxpbmtlZGluLm1ldHJpY0Vycm9ycyh7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvcnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLlJFRCxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdIDogW10sXG4gICAgICAgICAgfSksXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gVGlrVG9rIFB1Ymxpc2hpbmdcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ1Rpa1RvayBQdWJsaXNoaW5nJyxcbiAgICAgICAgICAgIHdpZHRoOiA2LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogcHJvcHMucHVibGlzaGVyTGFtYmRhcz8udGlrdG9rID8gW1xuICAgICAgICAgICAgICBwcm9wcy5wdWJsaXNoZXJMYW1iZGFzLnRpa3Rvay5tZXRyaWNJbnZvY2F0aW9ucyh7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdJbnZvY2F0aW9ucycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuQkxVRSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIHByb3BzLnB1Ymxpc2hlckxhbWJkYXMudGlrdG9rLm1ldHJpY0Vycm9ycyh7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvcnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLlJFRCxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdIDogW10sXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICBdLFxuICAgIH0pXG4gICAgXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gTGFtYmRhIERhc2hib2FyZCA9PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMubGFtYmRhRGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdMYW1iZGFEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiBgUG9zdG9saW8tTGFtYmRhLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIHdpZGdldHM6IFtcbiAgICAgICAgW1xuICAgICAgICAgIC8vIExhbWJkYSBQZXJmb3JtYW5jZSBPdmVydmlld1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnTGFtYmRhIFBlcmZvcm1hbmNlIE92ZXJ2aWV3JyxcbiAgICAgICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvTGFtYmRhJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ29uY3VycmVudEV4ZWN1dGlvbnMnLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ01heGltdW0nLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ29uY3VycmVudCBFeGVjdXRpb25zJyxcbiAgICAgICAgICAgICAgICBjb2xvcjogY2xvdWR3YXRjaC5Db2xvci5CTFVFLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByaWdodDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9MYW1iZGEnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdEdXJhdGlvbicsXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBdmVyYWdlIER1cmF0aW9uIChtcyknLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkdSRUVOLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIFtcbiAgICAgICAgICAvLyBUb2tlbiBTZXJ2aWNlIFBlcmZvcm1hbmNlXG4gICAgICAgICAgcHJvcHMudG9rZW5TZXJ2aWNlTGFtYmRhID8gbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdUb2tlbiBTZXJ2aWNlIFBlcmZvcm1hbmNlJyxcbiAgICAgICAgICAgIHdpZHRoOiA4LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBwcm9wcy50b2tlblNlcnZpY2VMYW1iZGEubWV0cmljSW52b2NhdGlvbnMoe1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkJMVUUsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBwcm9wcy50b2tlblNlcnZpY2VMYW1iZGEubWV0cmljRXJyb3JzKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0Vycm9ycycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuUkVELFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgcHJvcHMudG9rZW5TZXJ2aWNlTGFtYmRhLm1ldHJpY1Rocm90dGxlcyh7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdUaHJvdHRsZXMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLk9SQU5HRSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICAgICAgcHJvcHMudG9rZW5TZXJ2aWNlTGFtYmRhLm1ldHJpY0R1cmF0aW9uKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0R1cmF0aW9uIChtcyknLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkdSRUVOLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSkgOiBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgICAgIG1hcmtkb3duOiAnKipUb2tlbiBTZXJ2aWNlKio6IE5vdCBjb25maWd1cmVkJyxcbiAgICAgICAgICAgIHdpZHRoOiA4LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIFNjaGVkdWxlciBTZXJ2aWNlIFBlcmZvcm1hbmNlXG4gICAgICAgICAgcHJvcHMuc2NoZWR1bGVyU2VydmljZUxhbWJkYSA/IG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnU2NoZWR1bGVyIFNlcnZpY2UgUGVyZm9ybWFuY2UnLFxuICAgICAgICAgICAgd2lkdGg6IDgsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgIHByb3BzLnNjaGVkdWxlclNlcnZpY2VMYW1iZGEubWV0cmljSW52b2NhdGlvbnMoe1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkJMVUUsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBwcm9wcy5zY2hlZHVsZXJTZXJ2aWNlTGFtYmRhLm1ldHJpY0Vycm9ycyh7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvcnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLlJFRCxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICAgICAgcHJvcHMuc2NoZWR1bGVyU2VydmljZUxhbWJkYS5tZXRyaWNEdXJhdGlvbih7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdEdXJhdGlvbiAobXMpJyxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgICAgICBjb2xvcjogY2xvdWR3YXRjaC5Db2xvci5HUkVFTixcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pIDogbmV3IGNsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgICAgICBtYXJrZG93bjogJyoqU2NoZWR1bGVyIFNlcnZpY2UqKjogTm90IGNvbmZpZ3VyZWQnLFxuICAgICAgICAgICAgd2lkdGg6IDgsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gRExRIFByb2Nlc3NvciBQZXJmb3JtYW5jZVxuICAgICAgICAgIHByb3BzLmRscVByb2Nlc3NvckxhbWJkYSA/IG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnRExRIFByb2Nlc3NvciBQZXJmb3JtYW5jZScsXG4gICAgICAgICAgICB3aWR0aDogOCxcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgcHJvcHMuZGxxUHJvY2Vzc29yTGFtYmRhLm1ldHJpY0ludm9jYXRpb25zKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0ludm9jYXRpb25zJyxcbiAgICAgICAgICAgICAgICBjb2xvcjogY2xvdWR3YXRjaC5Db2xvci5CTFVFLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgcHJvcHMuZGxxUHJvY2Vzc29yTGFtYmRhLm1ldHJpY0Vycm9ycyh7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvcnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLlJFRCxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICAgICAgcHJvcHMuZGxxUHJvY2Vzc29yTGFtYmRhLm1ldHJpY0R1cmF0aW9uKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0R1cmF0aW9uIChtcyknLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkdSRUVOLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSkgOiBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgICAgIG1hcmtkb3duOiAnKipETFEgUHJvY2Vzc29yKio6IE5vdCBjb25maWd1cmVkJyxcbiAgICAgICAgICAgIHdpZHRoOiA4LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICBbXG4gICAgICAgICAgLy8gQ29sZCBTdGFydHNcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ0xhbWJkYSBDb2xkIFN0YXJ0cycsXG4gICAgICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0xhbWJkYScsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0luaXREdXJhdGlvbicsXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdJbml0IER1cmF0aW9uIChtcyknLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLlBVUlBMRSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIE1lbW9yeSBVdGlsaXphdGlvblxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnTWVtb3J5IFV0aWxpemF0aW9uJyxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWF0aEV4cHJlc3Npb24oe1xuICAgICAgICAgICAgICAgIGV4cHJlc3Npb246ICcodXNlZC9hbGxvY2F0ZWQpKjEwMCcsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdNZW1vcnkgVXRpbGl6YXRpb24gJScsXG4gICAgICAgICAgICAgICAgdXNpbmdNZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICB1c2VkOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvTGFtYmRhJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ1VzZWRNZW1vcnlNQicsXG4gICAgICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICBhbGxvY2F0ZWQ6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9MYW1iZGEnLFxuICAgICAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQWxsb2NhdGVkTWVtb3J5TUInLFxuICAgICAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgIF0sXG4gICAgfSlcbiAgICBcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBEeW5hbW9EQiBEYXNoYm9hcmQgPT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLmR5bmFtb2RiRGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdEeW5hbW9EQkRhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6IGBQb3N0b2xpby1EeW5hbW9EQi0ke2Vudmlyb25tZW50fWAsXG4gICAgICB3aWRnZXRzOiBbXG4gICAgICAgIFtcbiAgICAgICAgICAvLyBSZWFkL1dyaXRlIENhcGFjaXR5XG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdEeW5hbW9EQiBSZWFkL1dyaXRlIEFjdGl2aXR5JyxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRHluYW1vREInLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb25zdW1lZFJlYWRDYXBhY2l0eVVuaXRzJyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgICAgICBUYWJsZU5hbWU6IHByb3BzLnRva2VuVGFibGU/LnRhYmxlTmFtZSB8fCAnTi9BJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdUb2tlbiBUYWJsZSBSZWFkcycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuQkxVRSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0R5bmFtb0RCJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ29uc3VtZWRXcml0ZUNhcGFjaXR5VW5pdHMnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgICAgIFRhYmxlTmFtZTogcHJvcHMudG9rZW5UYWJsZT8udGFibGVOYW1lIHx8ICdOL0EnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1Rva2VuIFRhYmxlIFdyaXRlcycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuR1JFRU4sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBUaHJvdHRsaW5nXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdEeW5hbW9EQiBUaHJvdHRsaW5nJyxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRHluYW1vREInLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdVc2VyRXJyb3JzJyxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnVXNlciBFcnJvcnMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLk9SQU5HRSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0R5bmFtb0RCJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnU3lzdGVtRXJyb3JzJyxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnU3lzdGVtIEVycm9ycycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuUkVELFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIFtcbiAgICAgICAgICAvLyBUYWJsZS1zcGVjaWZpYyBtZXRyaWNzXG4gICAgICAgICAgcHJvcHMuc2NoZWR1bGVUYWJsZSA/IG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnU2NoZWR1bGUgVGFibGUgT3BlcmF0aW9ucycsXG4gICAgICAgICAgICB3aWR0aDogOCxcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRHluYW1vREInLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdTdWNjZXNzZnVsUmVxdWVzdExhdGVuY3knLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgICAgIFRhYmxlTmFtZTogcHJvcHMuc2NoZWR1bGVUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgICBPcGVyYXRpb246ICdRdWVyeScsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1F1ZXJ5IExhdGVuY3knLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkJMVUUsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9EeW5hbW9EQicsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ1N1Y2Nlc3NmdWxSZXF1ZXN0TGF0ZW5jeScsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICAgICAgVGFibGVOYW1lOiBwcm9wcy5zY2hlZHVsZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICAgIE9wZXJhdGlvbjogJ1B1dEl0ZW0nLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdQdXRJdGVtIExhdGVuY3knLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkdSRUVOLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSkgOiBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgICAgIG1hcmtkb3duOiAnKipTY2hlZHVsZSBUYWJsZSoqOiBOb3QgY29uZmlndXJlZCcsXG4gICAgICAgICAgICB3aWR0aDogOCxcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBcbiAgICAgICAgICBwcm9wcy5zYWdhU3RhdGVUYWJsZSA/IG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnU2FnYSBTdGF0ZSBUYWJsZSBPcGVyYXRpb25zJyxcbiAgICAgICAgICAgIHdpZHRoOiA4LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9EeW5hbW9EQicsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0NvbnN1bWVkUmVhZENhcGFjaXR5VW5pdHMnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgICAgIFRhYmxlTmFtZTogcHJvcHMuc2FnYVN0YXRlVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1JlYWQgVW5pdHMnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkJMVUUsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9EeW5hbW9EQicsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0NvbnN1bWVkV3JpdGVDYXBhY2l0eVVuaXRzJyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgICAgICBUYWJsZU5hbWU6IHByb3BzLnNhZ2FTdGF0ZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdXcml0ZSBVbml0cycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuR1JFRU4sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSA6IG5ldyBjbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICAgICAgbWFya2Rvd246ICcqKlNhZ2EgU3RhdGUgVGFibGUqKjogTm90IGNvbmZpZ3VyZWQnLFxuICAgICAgICAgICAgd2lkdGg6IDgsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgXG4gICAgICAgICAgcHJvcHMuY2lyY3VpdEJyZWFrZXJUYWJsZSA/IG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnQ2lyY3VpdCBCcmVha2VyIFRhYmxlJyxcbiAgICAgICAgICAgIHdpZHRoOiA4LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9EeW5hbW9EQicsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0NvbnN1bWVkUmVhZENhcGFjaXR5VW5pdHMnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgICAgIFRhYmxlTmFtZTogcHJvcHMuY2lyY3VpdEJyZWFrZXJUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnUmVhZCBVbml0cycsXG4gICAgICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuQkxVRSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pIDogbmV3IGNsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgICAgICBtYXJrZG93bjogJyoqQ2lyY3VpdCBCcmVha2VyIFRhYmxlKio6IE5vdCBjb25maWd1cmVkJyxcbiAgICAgICAgICAgIHdpZHRoOiA4LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgXSxcbiAgICB9KVxuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IFNRUyBEYXNoYm9hcmQgPT09PT09PT09PT09PT09PT09PT1cbiAgICB0aGlzLnNxc0Rhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCAnU1FTRGFzaGJvYXJkJywge1xuICAgICAgZGFzaGJvYXJkTmFtZTogYFBvc3RvbGlvLVNRUy0ke2Vudmlyb25tZW50fWAsXG4gICAgICB3aWRnZXRzOiBbXG4gICAgICAgIFtcbiAgICAgICAgICAvLyBRdWV1ZSBPdmVydmlld1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnUXVldWUgTWVzc2FnZSBWb2x1bWUnLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogcHJvcHMucHVibGlzaGVyUXVldWVzID8gT2JqZWN0LmVudHJpZXMocHJvcHMucHVibGlzaGVyUXVldWVzKVxuICAgICAgICAgICAgICAuZmlsdGVyKChbXywgcXVldWVdKSA9PiBxdWV1ZSAhPT0gdW5kZWZpbmVkKVxuICAgICAgICAgICAgICAubWFwKChbcGxhdGZvcm0sIHF1ZXVlXSkgPT4gXG4gICAgICAgICAgICAgICAgcXVldWUhLm1ldHJpY0FwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc1Zpc2libGUoe1xuICAgICAgICAgICAgICAgICAgbGFiZWw6IGAke3BsYXRmb3JtfSBRdWV1ZWAsXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgKSA6IFtdLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIFF1ZXVlIFByb2Nlc3NpbmcgUmF0ZVxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnTWVzc2FnZSBQcm9jZXNzaW5nIFJhdGUnLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogcHJvcHMucHVibGlzaGVyUXVldWVzID8gT2JqZWN0LmVudHJpZXMocHJvcHMucHVibGlzaGVyUXVldWVzKVxuICAgICAgICAgICAgICAuZmlsdGVyKChbXywgcXVldWVdKSA9PiBxdWV1ZSAhPT0gdW5kZWZpbmVkKVxuICAgICAgICAgICAgICAubWFwKChbcGxhdGZvcm0sIHF1ZXVlXSkgPT4gXG4gICAgICAgICAgICAgICAgcXVldWUhLm1ldHJpY051bWJlck9mTWVzc2FnZXNSZWNlaXZlZCh7XG4gICAgICAgICAgICAgICAgICBsYWJlbDogYCR7cGxhdGZvcm19IFJlY2VpdmVkYCxcbiAgICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgKSA6IFtdLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICBbXG4gICAgICAgICAgLy8gTWVzc2FnZSBBZ2VcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ01lc3NhZ2UgQWdlIGluIFF1ZXVlcycsXG4gICAgICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBsZWZ0OiBwcm9wcy5wdWJsaXNoZXJRdWV1ZXMgPyBPYmplY3QuZW50cmllcyhwcm9wcy5wdWJsaXNoZXJRdWV1ZXMpXG4gICAgICAgICAgICAgIC5maWx0ZXIoKFtfLCBxdWV1ZV0pID0+IHF1ZXVlICE9PSB1bmRlZmluZWQpXG4gICAgICAgICAgICAgIC5tYXAoKFtwbGF0Zm9ybSwgcXVldWVdKSA9PiBcbiAgICAgICAgICAgICAgICBxdWV1ZSEubWV0cmljQXBwcm94aW1hdGVBZ2VPZk9sZGVzdE1lc3NhZ2Uoe1xuICAgICAgICAgICAgICAgICAgbGFiZWw6IGAke3BsYXRmb3JtfSBPbGRlc3QgTWVzc2FnZWAsXG4gICAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdNYXhpbXVtJyxcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICApIDogW10sXG4gICAgICAgICAgfSksXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gRExRIE1ldHJpY3NcbiAgICAgICAgICBwcm9wcy5wdWJsaXNoZXJETFEgPyBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ0RlYWQgTGV0dGVyIFF1ZXVlIEFjdGl2aXR5JyxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgcHJvcHMucHVibGlzaGVyRExRLm1ldHJpY051bWJlck9mTWVzc2FnZXNSZWNlaXZlZCh7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdNZXNzYWdlcyBSZWNlaXZlZCcsXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgICAgICBjb2xvcjogY2xvdWR3YXRjaC5Db2xvci5SRUQsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBwcm9wcy5wdWJsaXNoZXJETFEubWV0cmljTnVtYmVyT2ZNZXNzYWdlc0RlbGV0ZWQoe1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnTWVzc2FnZXMgUHJvY2Vzc2VkJyxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLkdSRUVOLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSkgOiBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgICAgIG1hcmtkb3duOiAnKipEZWFkIExldHRlciBRdWV1ZSoqOiBOb3QgY29uZmlndXJlZCcsXG4gICAgICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICBdLFxuICAgIH0pXG4gICAgXG4gICAgLy8gQWRkIGN1c3RvbSBtZXRyaWNzIG5hbWVzcGFjZVxuICAgIG5ldyBjbG91ZHdhdGNoLkNmbkRhc2hib2FyZCh0aGlzLCAnQ3VzdG9tTWV0cmljc0Rhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6IGBQb3N0b2xpby1DdXN0b20tJHtlbnZpcm9ubWVudH1gLFxuICAgICAgZGFzaGJvYXJkQm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB3aWRnZXRzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgICAgICAgICBbJ1Bvc3RvbGlvL0RMUScsICdNZXNzYWdlc1JlcHJvY2Vzc2VkJywgeyBzdGF0OiAnU3VtJyB9XSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnTWVzc2FnZXNQYXJrZWQnLCB7IHN0YXQ6ICdTdW0nIH1dLFxuICAgICAgICAgICAgICAgIFsnLicsICdBbGVydHNTZW50JywgeyBzdGF0OiAnU3VtJyB9XSxcbiAgICAgICAgICAgICAgICBbJ1Bvc3RvbGlvL1NhZ2EnLCAnU2FnYUNvbXBsZXRlZCcsIHsgc3RhdDogJ1N1bScgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ1NhZ2FGYWlsZWQnLCB7IHN0YXQ6ICdTdW0nIH1dLFxuICAgICAgICAgICAgICAgIFsnLicsICdTYWdhQ29tcGVuc2F0ZWQnLCB7IHN0YXQ6ICdTdW0nIH1dLFxuICAgICAgICAgICAgICAgIFsnUG9zdG9saW8vQ2lyY3VpdEJyZWFrZXInLCAnQ2lyY3VpdE9wZW5lZCcsIHsgc3RhdDogJ1N1bScgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ0NpcmN1aXRDbG9zZWQnLCB7IHN0YXQ6ICdTdW0nIH1dLFxuICAgICAgICAgICAgICAgIFsnUG9zdG9saW8vUHVibGlzaGluZycsICdQb3N0c1B1Ymxpc2hlZCcsIHsgc3RhdDogJ1N1bScgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ1Bvc3RzRmFpbGVkJywgeyBzdGF0OiAnU3VtJyB9XSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgICAgICAgIHN0YXQ6ICdTdW0nLFxuICAgICAgICAgICAgICByZWdpb246IGNkay5TdGFjay5vZih0aGlzKS5yZWdpb24sXG4gICAgICAgICAgICAgIHRpdGxlOiAnQ3VzdG9tIEFwcGxpY2F0aW9uIE1ldHJpY3MnLFxuICAgICAgICAgICAgICB2aWV3OiAndGltZVNlcmllcycsXG4gICAgICAgICAgICAgIHN0YWNrZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICB5QXhpczoge1xuICAgICAgICAgICAgICAgIGxlZnQ6IHsgbWluOiAwIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9KSxcbiAgICB9KVxuICB9XG59Il19