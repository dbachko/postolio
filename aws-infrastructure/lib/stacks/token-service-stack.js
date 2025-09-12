"use strict";
/**
 * Token Service CDK Stack
 * Deploys DynamoDB, KMS, Lambda, and API Gateway for OAuth token management
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
exports.TokenServiceStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const kms = __importStar(require("aws-cdk-lib/aws-kms"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const cwactions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const subscriptions = __importStar(require("aws-cdk-lib/aws-sns-subscriptions"));
const path = __importStar(require("path"));
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const service_discovery_infrastructure_1 = require("../utils/service-discovery-infrastructure");
const cdk_nag_1 = require("cdk-nag");
class TokenServiceStack extends cdk.Stack {
    apiUrl;
    tableName;
    kmsKeyId;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment, alertEmail, serviceDiscoveryNamespaceId } = props;
        // Use shared Service Discovery namespace
        const serviceDiscovery = new service_discovery_infrastructure_1.ServiceDiscoveryManager(this, 'ServiceDiscovery', {
            environment,
            existingNamespaceId: serviceDiscoveryNamespaceId || cdk.Fn.importValue(`ServiceDiscovery-${environment}-NamespaceId`),
        });
        // Create KMS key for token encryption
        const encryptionKey = new kms.Key(this, 'TokenEncryptionKey', {
            description: `Token Service encryption key - ${environment}`,
            enableKeyRotation: true,
            alias: `alias/token-service-${environment}`,
        });
        // Create DynamoDB table for tokens
        const tokensTable = new dynamodb.Table(this, 'TokensTable', {
            tableName: `token-service-${environment}`,
            partitionKey: {
                name: 'pk',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'sk',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            timeToLiveAttribute: 'ttl',
            pointInTimeRecovery: environment === 'prod',
            removalPolicy: environment === 'prod'
                ? cdk.RemovalPolicy.RETAIN
                : cdk.RemovalPolicy.DESTROY,
        });
        // Add GSI for querying by expiry
        tokensTable.addGlobalSecondaryIndex({
            indexName: 'by-expiry',
            partitionKey: {
                name: 'platform',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'expiresAt',
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Create Lambda function
        const tokenServiceLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'TokenServiceFunction', {
            functionName: `token-service-${environment}`,
            entry: path.join(__dirname, '../lambda/token-service/index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: environment === 'prod' ? 1024 : 512,
            timeout: cdk.Duration.seconds(30),
            environment: {
                TOKENS_TABLE: tokensTable.tableName,
                KMS_KEY_ID: encryptionKey.keyId,
                NODE_ENV: environment,
                // Public OAuth IDs from props (passed via GitHub environment variables)
                FACEBOOK_APP_ID: props.facebookAppId || process.env.FACEBOOK_APP_ID || '',
                INSTAGRAM_APP_ID: props.instagramAppId || process.env.INSTAGRAM_APP_ID || '',
                LINKEDIN_CLIENT_ID: props.linkedinClientId || process.env.LINKEDIN_CLIENT_ID || '',
                TIKTOK_CLIENT_KEY: props.tiktokClientKey || process.env.TIKTOK_CLIENT_KEY || '',
                // OAuth secrets will be retrieved from Secrets Manager at runtime
                // Not passed as environment variables for security
                ...(0, service_discovery_infrastructure_1.getServiceDiscoveryEnvVars)(serviceDiscovery.getClientConfig()),
            },
            logRetention: logs.RetentionDays.ONE_MONTH,
            tracing: lambda.Tracing.ACTIVE,
        });
        // Grant permissions
        tokensTable.grantReadWriteData(tokenServiceLambda);
        encryptionKey.grantEncryptDecrypt(tokenServiceLambda);
        // Create API Gateway
        const api = new apigateway.RestApi(this, 'TokenServiceApi', {
            restApiName: `token-service-${environment}`,
            description: 'Token Service API for OAuth token management',
            deployOptions: {
                stageName: environment,
                tracingEnabled: true,
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: environment !== 'prod',
                metricsEnabled: true,
                throttlingBurstLimit: 100,
                throttlingRateLimit: 50,
            },
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });
        // Lambda integration
        const integration = new apigateway.LambdaIntegration(tokenServiceLambda, {
            requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
        });
        // API routes with IAM authentication
        const tokens = api.root.addResource('tokens');
        // Legacy endpoints (for backward compatibility)
        tokens.addMethod('POST', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Store or get token (deprecated)
        tokens.addMethod('DELETE', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Delete token (deprecated)
        const refresh = tokens.addResource('refresh');
        refresh.addMethod('POST', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Refresh token (deprecated)
        // New RESTful endpoints
        // Support for /tokens/batch
        const batch = tokens.addResource('batch');
        batch.addMethod('POST', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Batch get tokens
        // Support for /tokens/{userId}
        const userId = tokens.addResource('{userId}');
        userId.addMethod('GET', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // List all user tokens
        // Support for /tokens/{userId}/{platform}
        const platform = userId.addResource('{platform}');
        platform.addMethod('GET', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // List platform tokens
        // Support for /tokens/{userId}/{platform}/{brandId}
        const brandId = platform.addResource('{brandId}');
        brandId.addMethod('GET', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Get token
        brandId.addMethod('PUT', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Store/update token
        brandId.addMethod('DELETE', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Delete token
        // Support for /tokens/{userId}/{platform}/{brandId}/validate
        const validate = brandId.addResource('validate');
        validate.addMethod('POST', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Validate token
        // Support for /tokens/{userId}/{platform}/{brandId}/refresh
        const refreshNew = brandId.addResource('refresh');
        refreshNew.addMethod('POST', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Refresh token (new endpoint)
        // Support for /tokens/{userId}/{platform}/{brandId}/rotate
        const rotate = brandId.addResource('rotate');
        rotate.addMethod('POST', integration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        }); // Rotate token
        const health = api.root.addResource('health');
        health.addMethod('GET', integration); // Health check - no auth required
        const metrics = api.root.addResource('metrics');
        metrics.addMethod('GET', integration); // Metrics - no auth required
        // Register Token Service with Cloud Map
        (0, service_discovery_infrastructure_1.registerLambdaService)(serviceDiscovery, 'token-service', api.url, environment);
        // CloudWatch Alarms
        const errorAlarm = new cloudwatch.Alarm(this, 'TokenServiceErrors', {
            alarmName: `token-service-errors-${environment}`,
            metric: tokenServiceLambda.metricErrors(),
            threshold: 5,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        const throttleAlarm = new cloudwatch.Alarm(this, 'TokenServiceThrottles', {
            alarmName: `token-service-throttles-${environment}`,
            metric: tokenServiceLambda.metricThrottles(),
            threshold: 10,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        // SNS Topic for alarms (if email provided)
        if (alertEmail) {
            const alarmTopic = new sns.Topic(this, 'TokenServiceAlarms', {
                topicName: `token-service-alarms-${environment}`,
                displayName: 'Token Service Alarms',
            });
            alarmTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));
            errorAlarm.addAlarmAction(new cwactions.SnsAction(alarmTopic));
            throttleAlarm.addAlarmAction(new cwactions.SnsAction(alarmTopic));
        }
        // Outputs
        this.apiUrl = api.url;
        this.tableName = tokensTable.tableName;
        this.kmsKeyId = encryptionKey.keyId;
        new cdk.CfnOutput(this, 'TokenServiceApiUrl', {
            value: this.apiUrl,
            description: 'Token Service API URL',
            // No export needed - services use Cloud Map for discovery
        });
        new cdk.CfnOutput(this, 'TokenServiceTableName', {
            value: this.tableName,
            description: 'DynamoDB table name',
            exportName: `${this.stackName}-TableName`,
        });
        // Tags
        cdk.Tags.of(this).add('Service', 'TokenService');
        cdk.Tags.of(this).add('Environment', environment);
        cdk.Tags.of(this).add('ManagedBy', 'CDK');
        // Apply CDK Nag suppressions
        this.applyCdkNagSuppressions(tokensTable, tokenServiceLambda, api);
    }
    applyCdkNagSuppressions(tokensTable, tokenServiceLambda, api) {
        // DynamoDB suppressions
        cdk_nag_1.NagSuppressions.addResourceSuppressions(tokensTable, [
            {
                id: 'AwsSolutions-DDB3',
                reason: 'Point-in-time recovery is enabled for production only to optimize costs in dev/staging environments',
            },
        ]);
        // Lambda suppressions
        cdk_nag_1.NagSuppressions.addResourceSuppressions(tokenServiceLambda, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWSLambdaBasicExecutionRole is required for Lambda CloudWatch logging',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions are required for DynamoDB index operations and KMS key operations',
                appliesTo: [
                    'Resource::*',
                    'Resource::<TokensTable6C9B5BC6.Arn>/index/*',
                    'Action::kms:GenerateDataKey*',
                    'Action::kms:ReEncrypt*',
                ],
            },
            {
                id: 'AwsSolutions-L1',
                reason: 'Using Node.js 20.x which is the current LTS version and actively maintained',
            },
        ], true // Apply to all children
        );
        // API Gateway suppressions
        cdk_nag_1.NagSuppressions.addResourceSuppressions(api, [
            {
                id: 'AwsSolutions-APIG2',
                reason: 'Request validation handled at Lambda level for flexibility',
            },
            {
                id: 'AwsSolutions-APIG1',
                reason: 'Access logging configured via deployOptions with CloudWatch integration',
            },
            {
                id: 'AwsSolutions-APIG3',
                reason: 'WAF not required for internal service-to-service communication in VPC',
            },
            {
                id: 'AwsSolutions-APIG4',
                reason: 'Service uses API key authentication for service-to-service communication',
            },
            {
                id: 'AwsSolutions-COG4',
                reason: 'Cognito not applicable for internal service-to-service API',
            },
        ], true // Apply to all children
        );
        // LogRetention Lambda suppressions (auto-generated by CDK)
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a/ServiceRole/Resource`, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'LogRetention Lambda auto-generated by CDK with managed policy',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a/ServiceRole/DefaultPolicy/Resource`, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'LogRetention Lambda requires wildcard for CloudWatch Logs operations',
                appliesTo: ['Resource::*'],
            },
        ]);
    }
}
exports.TokenServiceStack = TokenServiceStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9rZW4tc2VydmljZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInRva2VuLXNlcnZpY2Utc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7R0FHRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsaURBQW1DO0FBRW5DLG1FQUFxRDtBQUNyRCx5REFBMkM7QUFDM0MsK0RBQWlEO0FBQ2pELHVFQUF5RDtBQUN6RCwyREFBNkM7QUFFN0MsdUVBQXlEO0FBQ3pELDhFQUFnRTtBQUNoRSx5REFBMkM7QUFDM0MsaUZBQW1FO0FBQ25FLDJDQUE2QjtBQUM3QixxRUFBK0Q7QUFDL0QsZ0dBQXVJO0FBQ3ZJLHFDQUEwQztBQVMxQyxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzlCLE1BQU0sQ0FBUztJQUNmLFNBQVMsQ0FBUztJQUNsQixRQUFRLENBQVM7SUFFakMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE2QjtRQUNyRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSwyQkFBMkIsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUV2RSx5Q0FBeUM7UUFDekMsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLDBEQUF1QixDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUM3RSxXQUFXO1lBQ1gsbUJBQW1CLEVBQUUsMkJBQTJCLElBQUksR0FBRyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsb0JBQW9CLFdBQVcsY0FBYyxDQUFDO1NBQ3RILENBQUMsQ0FBQztRQUVILHNDQUFzQztRQUN0QyxNQUFNLGFBQWEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzVELFdBQVcsRUFBRSxrQ0FBa0MsV0FBVyxFQUFFO1lBQzVELGlCQUFpQixFQUFF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RGVwbG95cyBEeW5hbW9EQiwgS01TLCBMYW1iZGEsIGFuZCBBUEkgR2F0ZXdheSBmb3IgT0F1dGggdG9rZW4gbWFuYWdlbWVudFxuICovXG5cbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBjd2FjdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gtYWN0aW9ucyc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyBzdWJzY3JpcHRpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgeyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciwgcmVnaXN0ZXJMYW1iZGFTZXJ2aWNlLCBnZXRTZXJ2aWNlRGlzY292ZXJ5RW52VmFycyB9IGZyb20gJy4uL3V0aWxzL3NlcnZpY2UtZGlzY292ZXJ5LWluZnJhc3RydWN0dXJlJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHsgT0F1dGhDb25maWcgfSBmcm9tICcuLi91dGlscy9vYXV0aC1jb25maWcnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFRva2VuU2VydmljZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcywgT0F1dGhDb25maWcge1xuICBlbnZpcm9ubWVudDogJ2RldicgfCAnc3RhZ2luZycgfCAncHJvZCc7XG4gIGFsZXJ0RW1haWw/OiBzdHJpbmc7XG4gIHNlcnZpY2VEaXNjb3ZlcnlOYW1lc3BhY2VJZD86IHN0cmluZzsgLy8gVXNlIHNoYXJlZCBuYW1lc3BhY2Vcbn1cblxuZXhwb3J0IGNsYXNzIFRva2VuU2VydmljZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGFwaVVybDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgdGFibGVOYW1lOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBrbXNLZXlJZDogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBUb2tlblNlcnZpY2VTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudmlyb25tZW50LCBhbGVydEVtYWlsLCBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlSWQgfSA9IHByb3BzO1xuXG4gICAgLy8gVXNlIHNoYXJlZCBTZXJ2aWNlIERpc2NvdmVyeSBuYW1lc3BhY2VcbiAgICBjb25zdCBzZXJ2aWNlRGlzY292ZXJ5ID0gbmV3IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyKHRoaXMsICdTZXJ2aWNlRGlzY292ZXJ5Jywge1xuICAgICAgZW52aXJvbm1lbnQsXG4gICAgICBleGlzdGluZ05hbWVzcGFjZUlkOiBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlSWQgfHwgY2RrLkZuLmltcG9ydFZhbHVlKGBTZXJ2aWNlRGlzY292ZXJ5LSR7ZW52aXJvbm1lbnR9LU5hbWVzcGFjZUlkYCksXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgS01TIGtleSBmb3IgdG9rZW4gZW5jcnlwdGlvblxuICAgIGNvbnN0IGVuY3J5cHRpb25LZXkgPSBuZXcga21zLktleSh0aGlzLCAnVG9rZW5FbmNyeXB0aW9uS2V5Jywge1xuICAgICAgZGVzY3JpcHRpb246IGBUb2tlbiBTZXJ2aWNlIGVuY3J5cHRpb24ga2V5IC0gJHtlbnZpcm9ubWVudH1gLFxuICAgICAgZW5hYmxlS2V5Um90YXRpb246IHRydWUsXG4gICAgICBhbGlhczogYGFsaWFzL3Rva2VuLXNlcnZpY2UtJHtlbnZpcm9ubWVudH1gLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIER5bmFtb0RCIHRhYmxlIGZvciB0b2tlbnNcbiAgICBjb25zdCB0b2tlbnNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVG9rZW5zVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGB0b2tlbi1zZXJ2aWNlLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAncGsnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBzb3J0S2V5OiB7XG4gICAgICAgIG5hbWU6ICdzaycsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IGVudmlyb25tZW50ID09PSAncHJvZCcsXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnIFxuICAgICAgICA/IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTiBcbiAgICAgICAgOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEdTSSBmb3IgcXVlcnlpbmcgYnkgZXhwaXJ5XG4gICAgdG9rZW5zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnYnktZXhwaXJ5JyxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAncGxhdGZvcm0nLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBzb3J0S2V5OiB7XG4gICAgICAgIG5hbWU6ICdleHBpcmVzQXQnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvblxuICAgIGNvbnN0IHRva2VuU2VydmljZUxhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnVG9rZW5TZXJ2aWNlRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGB0b2tlbi1zZXJ2aWNlLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhL3Rva2VuLXNlcnZpY2UvaW5kZXgudHMnKSxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgbWVtb3J5U2l6ZTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IDEwMjQgOiA1MTIsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBUT0tFTlNfVEFCTEU6IHRva2Vuc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgS01TX0tFWV9JRDogZW5jcnlwdGlvbktleS5rZXlJZCxcbiAgICAgICAgTk9ERV9FTlY6IGVudmlyb25tZW50LFxuICAgICAgICAvLyBQdWJsaWMgT0F1dGggSURzIGZyb20gcHJvcHMgKHBhc3NlZCB2aWEgR2l0SHViIGVudmlyb25tZW50IHZhcmlhYmxlcylcbiAgICAgICAgRkFDRUJPT0tfQVBQX0lEOiBwcm9wcy5mYWNlYm9va0FwcElkIHx8IHByb2Nlc3MuZW52LkZBQ0VCT09LX0FQUF9JRCB8fCAnJyxcbiAgICAgICAgSU5TVEFHUkFNX0FQUF9JRDogcHJvcHMuaW5zdGFncmFtQXBwSWQgfHwgcHJvY2Vzcy5lbnYuSU5TVEFHUkFNX0FQUF9JRCB8fCAnJyxcbiAgICAgICAgTElOS0VESU5fQ0xJRU5UX0lEOiBwcm9wcy5saW5rZWRpbkNsaWVudElkIHx8IHByb2Nlc3MuZW52LkxJTktFRElOX0NMSUVOVF9JRCB8fCAnJyxcbiAgICAgICAgVElLVE9LX0NMSUVOVF9LRVk6IHByb3BzLnRpa3Rva0NsaWVudEtleSB8fCBwcm9jZXNzLmVudi5USUtUT0tfQ0xJRU5UX0tFWSB8fCAnJyxcbiAgICAgICAgLy8gT0F1dGggc2VjcmV0cyB3aWxsIGJlIHJldHJpZXZlZCBmcm9tIFNlY3JldHMgTWFuYWdlciBhdCBydW50aW1lXG4gICAgICAgIC8vIE5vdCBwYXNzZWQgYXMgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciBzZWN1cml0eVxuICAgICAgICAuLi5nZXRTZXJ2aWNlRGlzY292ZXJ5RW52VmFycyhzZXJ2aWNlRGlzY292ZXJ5LmdldENsaWVudENvbmZpZygpKSxcbiAgICAgIH0sXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9uc1xuICAgIHRva2Vuc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh0b2tlblNlcnZpY2VMYW1iZGEpO1xuICAgIGVuY3J5cHRpb25LZXkuZ3JhbnRFbmNyeXB0RGVjcnlwdCh0b2tlblNlcnZpY2VMYW1iZGEpO1xuXG4gICAgLy8gQ3JlYXRlIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnVG9rZW5TZXJ2aWNlQXBpJywge1xuICAgICAgcmVzdEFwaU5hbWU6IGB0b2tlbi1zZXJ2aWNlLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVG9rZW4gU2VydmljZSBBUEkgZm9yIE9BdXRoIHRva2VuIG1hbmFnZW1lbnQnLFxuICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICBzdGFnZU5hbWU6IGVudmlyb25tZW50LFxuICAgICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbG9nZ2luZ0xldmVsOiBhcGlnYXRld2F5Lk1ldGhvZExvZ2dpbmdMZXZlbC5JTkZPLFxuICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiBlbnZpcm9ubWVudCAhPT0gJ3Byb2QnLFxuICAgICAgICBtZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgdGhyb3R0bGluZ0J1cnN0TGltaXQ6IDEwMCxcbiAgICAgICAgdGhyb3R0bGluZ1JhdGVMaW1pdDogNTAsXG4gICAgICB9LFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbJ0NvbnRlbnQtVHlwZScsICdBdXRob3JpemF0aW9uJ10sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gTGFtYmRhIGludGVncmF0aW9uXG4gICAgY29uc3QgaW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbih0b2tlblNlcnZpY2VMYW1iZGEsIHtcbiAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHsgJ2FwcGxpY2F0aW9uL2pzb24nOiAneyBcInN0YXR1c0NvZGVcIjogXCIyMDBcIiB9JyB9LFxuICAgIH0pO1xuXG4gICAgLy8gQVBJIHJvdXRlcyB3aXRoIElBTSBhdXRoZW50aWNhdGlvblxuICAgIGNvbnN0IHRva2VucyA9IGFwaS5yb290LmFkZFJlc291cmNlKCd0b2tlbnMnKTtcbiAgICBcbiAgICAvLyBMZWdhY3kgZW5kcG9pbnRzIChmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eSlcbiAgICB0b2tlbnMuYWRkTWV0aG9kKCdQT1NUJywgaW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSxcbiAgICB9KTsgLy8gU3RvcmUgb3IgZ2V0IHRva2VuIChkZXByZWNhdGVkKVxuICAgIHRva2Vucy5hZGRNZXRob2QoJ0RFTEVURScsIGludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0sXG4gICAgfSk7IC8vIERlbGV0ZSB0b2tlbiAoZGVwcmVjYXRlZClcblxuICAgIGNvbnN0IHJlZnJlc2ggPSB0b2tlbnMuYWRkUmVzb3VyY2UoJ3JlZnJlc2gnKTtcbiAgICByZWZyZXNoLmFkZE1ldGhvZCgnUE9TVCcsIGludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0sXG4gICAgfSk7IC8vIFJlZnJlc2ggdG9rZW4gKGRlcHJlY2F0ZWQpXG4gICAgXG4gICAgLy8gTmV3IFJFU1RmdWwgZW5kcG9pbnRzXG4gICAgLy8gU3VwcG9ydCBmb3IgL3Rva2Vucy9iYXRjaFxuICAgIGNvbnN0IGJhdGNoID0gdG9rZW5zLmFkZFJlc291cmNlKCdiYXRjaCcpO1xuICAgIGJhdGNoLmFkZE1ldGhvZCgnUE9TVCcsIGludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0sXG4gICAgfSk7IC8vIEJhdGNoIGdldCB0b2tlbnNcbiAgICBcbiAgICAvLyBTdXBwb3J0IGZvciAvdG9rZW5zL3t1c2VySWR9XG4gICAgY29uc3QgdXNlcklkID0gdG9rZW5zLmFkZFJlc291cmNlKCd7dXNlcklkfScpO1xuICAgIHVzZXJJZC5hZGRNZXRob2QoJ0dFVCcsIGludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0sXG4gICAgfSk7IC8vIExpc3QgYWxsIHVzZXIgdG9rZW5zXG4gICAgXG4gICAgLy8gU3VwcG9ydCBmb3IgL3Rva2Vucy97dXNlcklkfS97cGxhdGZvcm19XG4gICAgY29uc3QgcGxhdGZvcm0gPSB1c2VySWQuYWRkUmVzb3VyY2UoJ3twbGF0Zm9ybX0nKTtcbiAgICBwbGF0Zm9ybS5hZGRNZXRob2QoJ0dFVCcsIGludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0sXG4gICAgfSk7IC8vIExpc3QgcGxhdGZvcm0gdG9rZW5zXG4gICAgXG4gICAgLy8gU3VwcG9ydCBmb3IgL3Rva2Vucy97dXNlcklkfS97cGxhdGZvcm19L3ticmFuZElkfVxuICAgIGNvbnN0IGJyYW5kSWQgPSBwbGF0Zm9ybS5hZGRSZXNvdXJjZSgne2JyYW5kSWR9Jyk7XG4gICAgYnJhbmRJZC5hZGRNZXRob2QoJ0dFVCcsIGludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0sXG4gICAgfSk7IC8vIEdldCB0b2tlblxuICAgIGJyYW5kSWQuYWRkTWV0aG9kKCdQVVQnLCBpbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNLFxuICAgIH0pOyAvLyBTdG9yZS91cGRhdGUgdG9rZW5cbiAgICBicmFuZElkLmFkZE1ldGhvZCgnREVMRVRFJywgaW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSxcbiAgICB9KTsgLy8gRGVsZXRlIHRva2VuXG4gICAgXG4gICAgLy8gU3VwcG9ydCBmb3IgL3Rva2Vucy97dXNlcklkfS97cGxhdGZvcm19L3ticmFuZElkfS92YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRlID0gYnJhbmRJZC5hZGRSZXNvdXJjZSgndmFsaWRhdGUnKTtcbiAgICB2YWxpZGF0ZS5hZGRNZXRob2QoJ1BPU1QnLCBpbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNLFxuICAgIH0pOyAvLyBWYWxpZGF0ZSB0b2tlblxuICAgIFxuICAgIC8vIFN1cHBvcnQgZm9yIC90b2tlbnMve3VzZXJJZH0ve3BsYXRmb3JtfS97YnJhbmRJZH0vcmVmcmVzaFxuICAgIGNvbnN0IHJlZnJlc2hOZXcgPSBicmFuZElkLmFkZFJlc291cmNlKCdyZWZyZXNoJyk7XG4gICAgcmVmcmVzaE5ldy5hZGRNZXRob2QoJ1BPU1QnLCBpbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNLFxuICAgIH0pOyAvLyBSZWZyZXNoIHRva2VuIChuZXcgZW5kcG9pbnQpXG4gICAgXG4gICAgLy8gU3VwcG9ydCBmb3IgL3Rva2Vucy97dXNlcklkfS97cGxhdGZvcm19L3ticmFuZElkfS9yb3RhdGVcbiAgICBjb25zdCByb3RhdGUgPSBicmFuZElkLmFkZFJlc291cmNlKCdyb3RhdGUnKTtcbiAgICByb3RhdGUuYWRkTWV0aG9kKCdQT1NUJywgaW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSxcbiAgICB9KTsgLy8gUm90YXRlIHRva2VuXG5cbiAgICBjb25zdCBoZWFsdGggPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnaGVhbHRoJyk7XG4gICAgaGVhbHRoLmFkZE1ldGhvZCgnR0VUJywgaW50ZWdyYXRpb24pOyAvLyBIZWFsdGggY2hlY2sgLSBubyBhdXRoIHJlcXVpcmVkXG4gICAgXG4gICAgY29uc3QgbWV0cmljcyA9IGFwaS5yb290LmFkZFJlc291cmNlKCdtZXRyaWNzJyk7XG4gICAgbWV0cmljcy5hZGRNZXRob2QoJ0dFVCcsIGludGVncmF0aW9uKTsgLy8gTWV0cmljcyAtIG5vIGF1dGggcmVxdWlyZWRcblxuICAgIC8vIFJlZ2lzdGVyIFRva2VuIFNlcnZpY2Ugd2l0aCBDbG91ZCBNYXBcbiAgICByZWdpc3RlckxhbWJkYVNlcnZpY2UoXG4gICAgICBzZXJ2aWNlRGlzY292ZXJ5LFxuICAgICAgJ3Rva2VuLXNlcnZpY2UnLFxuICAgICAgYXBpLnVybCxcbiAgICAgIGVudmlyb25tZW50XG4gICAgKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggQWxhcm1zXG4gICAgY29uc3QgZXJyb3JBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdUb2tlblNlcnZpY2VFcnJvcnMnLCB7XG4gICAgICBhbGFybU5hbWU6IGB0b2tlbi1zZXJ2aWNlLWVycm9ycy0ke2Vudmlyb25tZW50fWAsXG4gICAgICBtZXRyaWM6IHRva2VuU2VydmljZUxhbWJkYS5tZXRyaWNFcnJvcnMoKSxcbiAgICAgIHRocmVzaG9sZDogNSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG5cbiAgICBjb25zdCB0aHJvdHRsZUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1Rva2VuU2VydmljZVRocm90dGxlcycsIHtcbiAgICAgIGFsYXJtTmFtZTogYHRva2VuLXNlcnZpY2UtdGhyb3R0bGVzLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIG1ldHJpYzogdG9rZW5TZXJ2aWNlTGFtYmRhLm1ldHJpY1Rocm90dGxlcygpLFxuICAgICAgdGhyZXNob2xkOiAxMCxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG5cbiAgICAvLyBTTlMgVG9waWMgZm9yIGFsYXJtcyAoaWYgZW1haWwgcHJvdmlkZWQpXG4gICAgaWYgKGFsZXJ0RW1haWwpIHtcbiAgICAgIGNvbnN0IGFsYXJtVG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdUb2tlblNlcnZpY2VBbGFybXMnLCB7XG4gICAgICAgIHRvcGljTmFtZTogYHRva2VuLXNlcnZpY2UtYWxhcm1zLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgICAgZGlzcGxheU5hbWU6ICdUb2tlbiBTZXJ2aWNlIEFsYXJtcycsXG4gICAgICB9KTtcblxuICAgICAgYWxhcm1Ub3BpYy5hZGRTdWJzY3JpcHRpb24obmV3IHN1YnNjcmlwdGlvbnMuRW1haWxTdWJzY3JpcHRpb24oYWxlcnRFbWFpbCkpO1xuXG4gICAgICBlcnJvckFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjd2FjdGlvbnMuU25zQWN0aW9uKGFsYXJtVG9waWMpKTtcbiAgICAgIHRocm90dGxlQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGN3YWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpO1xuICAgIH1cblxuICAgIC8vIE91dHB1dHNcbiAgICB0aGlzLmFwaVVybCA9IGFwaS51cmw7XG4gICAgdGhpcy50YWJsZU5hbWUgPSB0b2tlbnNUYWJsZS50YWJsZU5hbWU7XG4gICAgdGhpcy5rbXNLZXlJZCA9IGVuY3J5cHRpb25LZXkua2V5SWQ7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVG9rZW5TZXJ2aWNlQXBpVXJsJywge1xuICAgICAgdmFsdWU6IHRoaXMuYXBpVXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdUb2tlbiBTZXJ2aWNlIEFQSSBVUkwnLFxuICAgICAgLy8gTm8gZXhwb3J0IG5lZWRlZCAtIHNlcnZpY2VzIHVzZSBDbG91ZCBNYXAgZm9yIGRpc2NvdmVyeVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1Rva2VuU2VydmljZVRhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnRhYmxlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgdGFibGUgbmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tVGFibGVOYW1lYCxcbiAgICB9KTtcblxuICAgIC8vIFRhZ3NcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ1NlcnZpY2UnLCAnVG9rZW5TZXJ2aWNlJyk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50KTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcblxuICAgIC8vIEFwcGx5IENESyBOYWcgc3VwcHJlc3Npb25zXG4gICAgdGhpcy5hcHBseUNka05hZ1N1cHByZXNzaW9ucyh0b2tlbnNUYWJsZSwgdG9rZW5TZXJ2aWNlTGFtYmRhLCBhcGkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseUNka05hZ1N1cHByZXNzaW9ucyhcbiAgICB0b2tlbnNUYWJsZTogZHluYW1vZGIuVGFibGUsXG4gICAgdG9rZW5TZXJ2aWNlTGFtYmRhOiBOb2RlanNGdW5jdGlvbixcbiAgICBhcGk6IGFwaWdhdGV3YXkuUmVzdEFwaVxuICApOiB2b2lkIHtcbiAgICAvLyBEeW5hbW9EQiBzdXBwcmVzc2lvbnNcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnModG9rZW5zVGFibGUsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtRERCMycsXG4gICAgICAgIHJlYXNvbjogJ1BvaW50LWluLXRpbWUgcmVjb3ZlcnkgaXMgZW5hYmxlZCBmb3IgcHJvZHVjdGlvbiBvbmx5IHRvIG9wdGltaXplIGNvc3RzIGluIGRldi9zdGFnaW5nIGVudmlyb25tZW50cycsXG4gICAgICB9LFxuICAgIF0pO1xuXG4gICAgLy8gTGFtYmRhIHN1cHByZXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIHRva2VuU2VydmljZUxhbWJkYSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICAgIHJlYXNvbjogJ0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSBpcyByZXF1aXJlZCBmb3IgTGFtYmRhIENsb3VkV2F0Y2ggbG9nZ2luZycsXG4gICAgICAgICAgYXBwbGllc1RvOiBbJ1BvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgIHJlYXNvbjogJ1dpbGRjYXJkIHBlcm1pc3Npb25zIGFyZSByZXF1aXJlZCBmb3IgRHluYW1vREIgaW5kZXggb3BlcmF0aW9ucyBhbmQgS01TIGtleSBvcGVyYXRpb25zJyxcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgICdSZXNvdXJjZTo6KicsXG4gICAgICAgICAgICAnUmVzb3VyY2U6OjxUb2tlbnNUYWJsZTZDOUI1QkM2LkFybj4vaW5kZXgvKicsXG4gICAgICAgICAgICAnQWN0aW9uOjprbXM6R2VuZXJhdGVEYXRhS2V5KicsXG4gICAgICAgICAgICAnQWN0aW9uOjprbXM6UmVFbmNyeXB0KicsXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUwxJyxcbiAgICAgICAgICByZWFzb246ICdVc2luZyBOb2RlLmpzIDIwLnggd2hpY2ggaXMgdGhlIGN1cnJlbnQgTFRTIHZlcnNpb24gYW5kIGFjdGl2ZWx5IG1haW50YWluZWQnLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWUgLy8gQXBwbHkgdG8gYWxsIGNoaWxkcmVuXG4gICAgKTtcblxuICAgIC8vIEFQSSBHYXRld2F5IHN1cHByZXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIGFwaSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUcyJyxcbiAgICAgICAgICByZWFzb246ICdSZXF1ZXN0IHZhbGlkYXRpb24gaGFuZGxlZCBhdCBMYW1iZGEgbGV2ZWwgZm9yIGZsZXhpYmlsaXR5JyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUcxJyxcbiAgICAgICAgICByZWFzb246ICdBY2Nlc3MgbG9nZ2luZyBjb25maWd1cmVkIHZpYSBkZXBsb3lPcHRpb25zIHdpdGggQ2xvdWRXYXRjaCBpbnRlZ3JhdGlvbicsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHMycsXG4gICAgICAgICAgcmVhc29uOiAnV0FGIG5vdCByZXF1aXJlZCBmb3IgaW50ZXJuYWwgc2VydmljZS10by1zZXJ2aWNlIGNvbW11bmljYXRpb24gaW4gVlBDJyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUc0JyxcbiAgICAgICAgICByZWFzb246ICdTZXJ2aWNlIHVzZXMgQVBJIGtleSBhdXRoZW50aWNhdGlvbiBmb3Igc2VydmljZS10by1zZXJ2aWNlIGNvbW11bmljYXRpb24nLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ09HNCcsXG4gICAgICAgICAgcmVhc29uOiAnQ29nbml0byBub3QgYXBwbGljYWJsZSBmb3IgaW50ZXJuYWwgc2VydmljZS10by1zZXJ2aWNlIEFQSScsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgdHJ1ZSAvLyBBcHBseSB0byBhbGwgY2hpbGRyZW5cbiAgICApO1xuXG4gICAgLy8gTG9nUmV0ZW50aW9uIExhbWJkYSBzdXBwcmVzc2lvbnMgKGF1dG8tZ2VuZXJhdGVkIGJ5IENESylcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9Mb2dSZXRlbnRpb25hYWUwYWEzYzViNGQ0Zjg3YjAyZDg1YjIwMWVmZGQ4YS9TZXJ2aWNlUm9sZS9SZXNvdXJjZWAsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgICByZWFzb246ICdMb2dSZXRlbnRpb24gTGFtYmRhIGF1dG8tZ2VuZXJhdGVkIGJ5IENESyB3aXRoIG1hbmFnZWQgcG9saWN5JyxcbiAgICAgICAgICBhcHBsaWVzVG86IFsnUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSddLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9Mb2dSZXRlbnRpb25hYWUwYWEzYzViNGQ0Zjg3YjAyZDg1YjIwMWVmZGQ4YS9TZXJ2aWNlUm9sZS9EZWZhdWx0UG9saWN5L1Jlc291cmNlYCxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgIHJlYXNvbjogJ0xvZ1JldGVudGlvbiBMYW1iZGEgcmVxdWlyZXMgd2lsZGNhcmQgZm9yIENsb3VkV2F0Y2ggTG9ncyBvcGVyYXRpb25zJyxcbiAgICAgICAgICBhcHBsaWVzVG86IFsnUmVzb3VyY2U6OionXSxcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuICB9XG59Il19