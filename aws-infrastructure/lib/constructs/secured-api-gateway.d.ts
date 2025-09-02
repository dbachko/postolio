/**
 * Secured API Gateway with IAM Authorization
 * Enterprise-grade API security for microservices
 */
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
export interface SecuredApiGatewayProps {
    environment: string;
    serviceName: string;
    lambdaIntegrations: {
        [path: string]: {
            lambda: lambda.Function;
            methods: string[];
            authType: 'IAM' | 'API_KEY' | 'NONE';
            apiKeyRequired?: boolean;
            throttle?: {
                burstLimit: number;
                rateLimit: number;
            };
        };
    };
    enableWaf?: boolean;
    enableApiKey?: boolean;
    enableUsagePlan?: boolean;
    corsConfig?: apigateway.CorsOptions;
}
export declare class SecuredApiGateway extends Construct {
    readonly api: apigateway.RestApi;
    readonly apiKey?: apigateway.ApiKey;
    readonly usagePlan?: apigateway.UsagePlan;
    readonly webAcl?: wafv2.CfnWebACL;
    constructor(scope: Construct, id: string, props: SecuredApiGatewayProps);
}
