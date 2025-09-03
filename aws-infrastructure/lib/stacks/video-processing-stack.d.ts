import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
export interface VideoProcessingStackProps extends StackProps {
    environment: string;
    schedulesTable: dynamodb.Table;
    powertoolsLayer: lambda.LayerVersion;
    mainAppApiUrl: string;
    internalApiSecret: string;
}
export declare class VideoProcessingStack extends Stack {
    readonly videoBucket: s3.Bucket;
    readonly processedVideoBucket: s3.Bucket;
    readonly videoUploadFunction: NodejsFunction;
    readonly videoProcessorFunction: NodejsFunction;
    readonly videoValidatorFunction: NodejsFunction;
    readonly videoDistribution: cloudfront.Distribution;
    private getAllowedOrigins;
    constructor(scope: Construct, id: string, props: VideoProcessingStackProps);
}
