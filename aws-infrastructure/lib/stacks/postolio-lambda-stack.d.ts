import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
export interface PostolioLambdaStackProps extends cdk.StackProps {
    environment: 'dev' | 'staging' | 'prod';
    databaseUrl: string;
    redisUrl?: string;
}
/**
 * Lambda Stack for Postolio EventBridge Handlers
 * This stack creates the main Lambda function that handles EventBridge scheduled events
 */
export declare class PostolioLambdaStack extends cdk.Stack {
    readonly mainLambdaFunction: lambda.Function;
    constructor(scope: Construct, id: string, props: PostolioLambdaStackProps);
}
