import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
export interface ContentSchedulerStackProps extends cdk.StackProps {
    environment: 'dev' | 'staging' | 'prod';
    alertEmail?: string;
    mainAppApiUrl?: string;
    serviceDiscoveryNamespaceId?: string;
}
export declare class ContentSchedulerStack extends cdk.Stack {
    readonly api: apigateway.RestApi;
    readonly schedulesTable: dynamodb.Table;
    readonly videoBucket: s3.Bucket;
    constructor(scope: Construct, id: string, props: ContentSchedulerStackProps);
}
