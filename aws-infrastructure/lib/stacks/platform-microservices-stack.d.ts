/**
 * Platform Microservices Stack
 * Production-ready microservices architecture for social media scheduling
 */
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
export interface PlatformMicroservicesStackProps extends cdk.StackProps {
    environment: 'dev' | 'staging' | 'prod';
    domainName?: string;
    alertEmail?: string;
}
export declare class PlatformMicroservicesStack extends cdk.Stack {
    readonly tokenServiceApi: apigateway.RestApi;
    readonly eventBus: events.EventBus;
    readonly tokenTable: dynamodb.Table;
    readonly scheduleTable: dynamodb.Table;
    constructor(scope: Construct, id: string, props: PlatformMicroservicesStackProps);
}
