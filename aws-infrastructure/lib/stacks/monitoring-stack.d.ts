/**
 * Monitoring Stack for Content Scheduler Microservice
 * Provides comprehensive observability through CloudWatch dashboards,
 * custom metrics, alarms, and X-Ray tracing
 */
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
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
export declare class MonitoringStack extends Stack {
    readonly operationalDashboard: cloudwatch.Dashboard;
    readonly businessDashboard: cloudwatch.Dashboard;
    readonly costDashboard: cloudwatch.Dashboard;
    readonly slaDashboard: cloudwatch.Dashboard;
    readonly alertTopic: sns.Topic;
    readonly kmsKey: kms.Key;
    constructor(scope: Construct, id: string, props: MonitoringStackProps);
    /**
     * Create operational dashboard for system health monitoring
     */
    private createOperationalDashboard;
    /**
     * Create business metrics dashboard
     */
    private createBusinessDashboard;
    /**
     * Create cost monitoring dashboard
     */
    private createCostDashboard;
    /**
     * Create SLA monitoring dashboard
     */
    private createSLADashboard;
    /**
     * Set up critical alarms
     */
    private setupCriticalAlarms;
}
