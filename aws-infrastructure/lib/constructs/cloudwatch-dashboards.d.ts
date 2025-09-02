/**
 * CloudWatch Dashboards Configuration
 * Comprehensive monitoring dashboards for all microservices
 */
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
export interface DashboardConfig {
    environment: string;
    tokenServiceLambda?: lambda.Function;
    schedulerServiceLambda?: lambda.Function;
    publisherLambdas?: {
        instagram?: lambda.Function;
        facebook?: lambda.Function;
        linkedin?: lambda.Function;
        tiktok?: lambda.Function;
    };
    dlqProcessorLambda?: lambda.Function;
    tokenTable?: dynamodb.Table;
    scheduleTable?: dynamodb.Table;
    sagaStateTable?: dynamodb.Table;
    circuitBreakerTable?: dynamodb.Table;
    dlqStateTable?: dynamodb.Table;
    publisherQueues?: {
        instagram?: sqs.Queue;
        facebook?: sqs.Queue;
        linkedin?: sqs.Queue;
        tiktok?: sqs.Queue;
    };
    publisherDLQ?: sqs.Queue;
    eventBus?: events.EventBus;
}
export declare class CloudWatchDashboards extends Construct {
    readonly mainDashboard: cloudwatch.Dashboard;
    readonly lambdaDashboard: cloudwatch.Dashboard;
    readonly dynamodbDashboard: cloudwatch.Dashboard;
    readonly sqsDashboard: cloudwatch.Dashboard;
    constructor(scope: Construct, id: string, props: DashboardConfig);
}
