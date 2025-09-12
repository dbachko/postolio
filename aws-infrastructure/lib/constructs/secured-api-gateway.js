"use strict";
/**
 * Secured API Gateway with IAM Authorization
 * Enterprise-grade API security for microservices
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
exports.SecuredApiGateway = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const wafv2 = __importStar(require("aws-cdk-lib/aws-wafv2"));
const constructs_1 = require("constructs");
class SecuredApiGateway extends constructs_1.Construct {
    api;
    apiKey;
    usagePlan;
    webAcl;
    constructor(scope, id, props) {
        super(scope, id);
        const { environment, serviceName, lambdaIntegrations, enableWaf, enableApiKey, enableUsagePlan } = props;
        // ==================== API Gateway ====================
        this.api = new apigateway.RestApi(this, 'Api', {
            restApiName: `postolio-${serviceName}-${environment}`,
            description: `Secured API for ${serviceName} microservice`,
            deployOptions: {
                stageName: environment,
                tracingEnabled: true,
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                metricsEnabled: true,
                dataTraceEnabled: true,
                throttlingBurstLimit: 100,
                throttlingRateLimit: 50,
                accessLogDestination: new apigateway.LogGroupLogDestination(new logs.LogGroup(this, 'ApiAccessLogs', {
                    logGroupName: `/aws/api-gateway/postolio-${serviceName}-${environment}`,
                    retention: logs.RetentionDays.ONE_MONTH,
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                })),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
                    caller: false,
                    httpMethod: true,
                    ip: true,
                    protocol: true,
                    requestTime: true,
                    resourcePath: true,
                    responseLength: true,
                    status: true,
                    user: true,
                }),
            },
            defaultCorsPreflightOptions: props.corsConfig || {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'X-Amz-Date',
                    'Authorization',
                    'X-Api-Key',
                    'X-Amz-Security-Token',
                    'X-User-Id',
                    'X-User-Tier',
                    'X-Correlation-Id',
                ],
                maxAge: cdk.Duration.hours(1),
            },
            endpointConfiguration: {
                types: [apigateway.EndpointType.REGIONAL],
            },
            cloudWatchRole: true,
        });
        // ==================== Request Validator ====================
        const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
            restApi: this.api,
            validateRequestBody: true,
            validateRequestParameters: true,
        });
        // ==================== API Key & Usage Plan ====================
        if (enableApiKey) {
            this.apiKey = new apigateway.ApiKey(this, 'ApiKey', {
                apiKeyName: `postolio-${serviceName}-${environment}-key`,
                description: `API key for ${serviceName} service`,
                enabled: true,
            });
            if (enableUsagePlan) {
                this.usagePlan = new apigateway.UsagePlan(this, 'UsagePlan', {
                    name: `postolio-${serviceName}-${environment}-usage`,
                    description: `Usage plan for ${serviceName} service`,
                    apiStages: [{
                            api: this.api,
                            stage: this.api.deploymentStage,
                        }],
                    throttle: {
                        burstLimit: 200,
                        rateLimit: 100,
                    },
                    quota: {
                        limit: 10000,
                        period: apigateway.Period.DAY,
                    },
                });
                this.usagePlan.addApiKey(this.apiKey);
            }
        }
        // ==================== WAF Integration ====================
        if (enableWaf) {
            this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
                scope: 'REGIONAL',
                name: `postolio-${serviceName}-${environment}-waf`,
                description: `WAF rules for ${serviceName} API`,
                defaultAction: { allow: {} },
                rules: [
                    // Rate limiting rule
                    {
                        name: 'RateLimitRule',
                        priority: 1,
                        statement: {
                            rateBasedStatement: {
                                limit: 2000, // 2000 requests per 5 minutes
                                aggregateKeyType: 'IP',
                            },
                        },
                        action: { block: {} },
                        visibilityConfig: {
                            sampledRequestsEnabled: true,
                            cloudWatchMetricsEnabled: true,
                            metricName: 'RateLimitRule',
                        },
                    },
                    // SQL injection protection
                    {
                        name: 'SqlInjectionRule',
                        priority: 2,
                        statement: {
                            sqliMatchStatement: {
                                fieldToMatch: { allQueryArguments: {} },
                                textTransformations: [{
                                        priority: 0,
                                        type: 'URL_DECODE',
                                    }, {
                                        priority: 1,
                                        type: 'HTML_ENTITY_DECODE',
                                    }],
                            },
                        },
                        action: { block: {} },
                        visibilityConfig: {
                            sampledRequestsEnabled: true,
                            cloudWatchMetricsEnabled: true,
                            metricName: 'SqlInjectionRule',
                        },
                    },
                    // XSS protection
                    {
                        name: 'XssRule',
                        priority: 3,
                        statement: {
                            xssMatchStatement: {
                                fieldToMatch: { allQueryArguments: {} },
                                textTransformations: [{
                                        priority: 0,
                                        type: 'URL_DECODE',
                                    }, {
                                        priority: 1,
                                        type: 'HTML_ENTITY_DECODE',
                                    }],
                            },
                        },
                        action: { block: {} },
                        visibilityConfig: {
                            sampledRequestsEnabled: true,
                            cloudWatchMetricsEnabled: true,
                            metricName: 'XssRule',
                        },
                    },
                ],
                visibilityConfig: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: `${serviceName}-waf`,
                },
            });
            // Associate WAF with API Gateway
            new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
                resourceArn: `arn:aws:apigateway:${cdk.Stack.of(this).region}::/restapis/${this.api.restApiId}/stages/${environment}`,
                webAclArn: this.webAcl.attrArn,
            });
        }
        // ==================== API Resources & Methods ====================
        Object.entries(lambdaIntegrations).forEach(([path, config]) => {
            const pathParts = path.split('/').filter(p => p);
            let resource = this.api.root;
            // Build resource path
            for (const part of pathParts) {
                const existingResource = resource.getResource(part);
                if (existingResource) {
                    resource = existingResource;
                }
                else {
                    resource = resource.addResource(part);
                }
            }
            // Add methods with appropriate authorization
            config.methods.forEach(method => {
                // Build methodOptions object with all properties at creation time
                let authorizationType = apigateway.AuthorizationType.NONE;
                let apiKeyRequired = false;
                let methodResponses = undefined;
                // Configure authorization based on authType
                switch (config.authType) {
                    case 'IAM':
                        authorizationType = apigateway.AuthorizationType.IAM;
                        break;
                    case 'API_KEY':
                        authorizationType = apigateway.AuthorizationType.NONE;
                        apiKeyRequired = true;
                        break;
                    case 'NONE':
                        authorizationType = apigateway.AuthorizationType.NONE;
                        break;
                }
                if (config.apiKeyRequired) {
                    apiKeyRequired = true;
                }
                // Add throttling if specified
                if (config.throttle) {
                    methodResponses = [{
                            statusCode: '200',
                        }, {
                            statusCode: '429',
                        }];
                }
                // Create methodOptions with all properties
                const methodOptions = {
                    requestValidator,
                    authorizationType,
                    apiKeyRequired,
                    methodResponses
                };
                // Create Lambda integration
                const integration = new apigateway.LambdaIntegration(config.lambda, {
                    proxy: true,
                    integrationResponses: [{
                            statusCode: '200',
                        }, {
                            statusCode: '429',
                            selectionPattern: '.*Rate limit exceeded.*',
                        }],
                });
                resource.addMethod(method, integration, methodOptions);
            });
        });
        // ==================== API Documentation ====================
        new apigateway.CfnDocumentationPart(this, 'ApiDocumentation', {
            location: {
                type: 'API',
            },
            properties: JSON.stringify({
                description: `Secured API Gateway for ${serviceName} microservice`,
                version: '1.0.0',
                contact: {
                    name: 'Postolio Team',
                    email: 'support@postolio.example',
                },
            }),
            restApiId: this.api.restApiId,
        });
        // ==================== IAM Policies ====================
        // Create IAM policy for API access
        const apiAccessPolicy = new iam.ManagedPolicy(this, 'ApiAccessPolicy', {
            managedPolicyName: `postolio-${serviceName}-${environment}-api-access`,
            description: `Policy for accessing ${serviceName} API`,
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['execute-api:Invoke'],
                    resources: [
                        `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${this.api.restApiId}/*/*/*`,
                    ],
                }),
            ],
        });
        // Create IAM role for service-to-service communication
        const serviceRole = new iam.Role(this, 'ServiceRole', {
            roleName: `postolio-${serviceName}-${environment}-service-role`,
            assumedBy: new iam.CompositePrincipal(new iam.ServicePrincipal('lambda.amazonaws.com'), new iam.ServicePrincipal('ecs-tasks.amazonaws.com')),
            managedPolicies: [apiAccessPolicy],
            description: `Service role for ${serviceName} microservice`,
        });
        // ==================== Outputs ====================
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: this.api.url,
            description: `API Gateway URL for ${serviceName}`,
        });
        new cdk.CfnOutput(this, 'ApiId', {
            value: this.api.restApiId,
            description: `API Gateway ID for ${serviceName}`,
        });
        if (this.apiKey) {
            new cdk.CfnOutput(this, 'ApiKeyId', {
                value: this.apiKey.keyId,
                description: `API Key ID for ${serviceName}`,
            });
        }
        new cdk.CfnOutput(this, 'ServiceRoleArn', {
            value: serviceRole.roleArn,
            description: `Service role ARN for ${serviceName}`,
        });
    }
}
exports.SecuredApiGateway = SecuredApiGateway;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjdXJlZC1hcGktZ2F0ZXdheS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNlY3VyZWQtYXBpLWdhdGV3YXkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7R0FHRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsaURBQWtDO0FBQ2xDLHVFQUF3RDtBQUN4RCx5REFBMEM7QUFFMUMsMkRBQTRDO0FBQzVDLDZEQUE4QztBQUM5QywyQ0FBc0M7QUF1QnRDLE1BQWEsaUJBQWtCLFNBQVEsc0JBQVM7SUFDOUIsR0FBRyxDQUFvQjtJQUN2QixNQUFNLENBQW9CO0lBQzFCLFNBQVMsQ0FBdUI7SUFDaEMsTUFBTSxDQUFrQjtJQUV4QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTZCO1FBQ3JFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFFaEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsa0JBQWtCLEVBQUUsU0FBUyxFQUFFLFlBQVksRUFBRSxlQUFlLEVBQUUsR0FBRyxLQUFLLENBQUE7UUFFeEcsd0RBQXdEO1FBQ3hELElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDN0MsV0FBVyxFQUFFLFlBQVksV0FBVyxJQUFJLFdBQVcsRUFBRTtZQUNyRCxXQUFXLEVBQUUsbUJBQW1CLFdBQVcsZUFBZTtZQUMxRCxhQUFhLEVBQUU7Z0JBQ2IsU0FBUyxFQUFFLFdBQVc7Z0JBQ3RCLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixZQUFZLEVBQUUsVUFBVSxDQUFDLGtCQUFrQixDQUFDLElBQUk7Z0JBQ2hELGNBQWMsRUFBRSxJQUFJO2dCQUNwQixnQkFBZ0IsRUFBRSxJQUFJO2dCQUN0QixvQkFBb0IsRUFBRSxHQUFHO2dCQUN6QixtQkFBbUIsRUFBRSxFQUFFO2dCQUN2QixvQkFBb0IsRUFBRSxJQUFJLFVBQVUs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dXRob3JpemF0aW9uXG4gKiBFbnRlcnByaXNlLWdyYWRlIEFQSSBzZWN1cml0eSBmb3IgbWljcm9zZXJ2aWNlc1xuICovXG5cbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJ1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncydcbmltcG9ydCAqIGFzIHdhZnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy13YWZ2MidcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VjdXJlZEFwaUdhdGV3YXlQcm9wcyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmdcbiAgc2VydmljZU5hbWU6IHN0cmluZ1xuICBsYW1iZGFJbnRlZ3JhdGlvbnM6IHtcbiAgICBbcGF0aDogc3RyaW5nXToge1xuICAgICAgbGFtYmRhOiBsYW1iZGEuRnVuY3Rpb25cbiAgICAgIG1ldGhvZHM6IHN0cmluZ1tdXG4gICAgICBhdXRoVHlwZTogJ0lBTScgfCAnQVBJX0tFWScgfCAnTk9ORSdcbiAgICAgIGFwaUtleVJlcXVpcmVkPzogYm9vbGVhblxuICAgICAgdGhyb3R0bGU/OiB7XG4gICAgICAgIGJ1cnN0TGltaXQ6IG51bWJlclxuICAgICAgICByYXRlTGltaXQ6IG51bWJlclxuICAgICAgfVxuICAgIH1cbiAgfVxuICBlbmFibGVXYWY/OiBib29sZWFuXG4gIGVuYWJsZUFwaUtleT86IGJvb2xlYW5cbiAgZW5hYmxlVXNhZ2VQbGFuPzogYm9vbGVhblxuICBjb3JzQ29uZmlnPzogYXBpZ2F0ZXdheS5Db3JzT3B0aW9uc1xufVxuXG5leHBvcnQgY2xhc3MgU2VjdXJlZEFwaUdhdGV3YXkgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpOiBhcGlnYXRld2F5LlJlc3RBcGlcbiAgcHVibGljIHJlYWRvbmx5IGFwaUtleT86IGFwaWdhdGV3YXkuQXBpS2V5XG4gIHB1YmxpYyByZWFkb25seSB1c2FnZVBsYW4/OiBhcGlnYXRld2F5LlVzYWdlUGxhblxuICBwdWJsaWMgcmVhZG9ubHkgd2ViQWNsPzogd2FmdjIuQ2ZuV2ViQUNMXG4gIFxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU2VjdXJlZEFwaUdhdGV3YXlQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZClcbiAgICBcbiAgICBjb25zdCB7IGVudmlyb25tZW50LCBzZXJ2aWNlTmFtZSwgbGFtYmRhSW50ZWdyYXRpb25zLCBlbmFibGVXYWYsIGVuYWJsZUFwaUtleSwgZW5hYmxlVXNhZ2VQbGFuIH0gPSBwcm9wc1xuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IEFQSSBHYXRld2F5ID09PT09PT09PT09PT09PT09PT09XG4gICAgdGhpcy5hcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdBcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogYHBvc3RvbGlvLSR7c2VydmljZU5hbWV9LSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgU2VjdXJlZCBBUEkgZm9yICR7c2VydmljZU5hbWV9IG1pY3Jvc2VydmljZWAsXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogZW52aXJvbm1lbnQsXG4gICAgICAgIHRyYWNpbmdFbmFibGVkOiB0cnVlLFxuICAgICAgICBsb2dnaW5nTGV2ZWw6IGFwaWdhdGV3YXkuTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXG4gICAgICAgIG1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiB0cnVlLFxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogMTAwLFxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiA1MCxcbiAgICAgICAgYWNjZXNzTG9nRGVzdGluYXRpb246IG5ldyBhcGlnYXRld2F5LkxvZ0dyb3VwTG9nRGVzdGluYXRpb24oXG4gICAgICAgICAgbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0FwaUFjY2Vzc0xvZ3MnLCB7XG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2FwaS1nYXRld2F5L3Bvc3RvbGlvLSR7c2VydmljZU5hbWV9LSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgICAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgfSlcbiAgICAgICAgKSxcbiAgICAgICAgYWNjZXNzTG9nRm9ybWF0OiBhcGlnYXRld2F5LkFjY2Vzc0xvZ0Zvcm1hdC5qc29uV2l0aFN0YW5kYXJkRmllbGRzKHtcbiAgICAgICAgICBjYWxsZXI6IGZhbHNlLFxuICAgICAgICAgIGh0dHBNZXRob2Q6IHRydWUsXG4gICAgICAgICAgaXA6IHRydWUsXG4gICAgICAgICAgcHJvdG9jb2w6IHRydWUsXG4gICAgICAgICAgcmVxdWVzdFRpbWU6IHRydWUsXG4gICAgICAgICAgcmVzb3VyY2VQYXRoOiB0cnVlLFxuICAgICAgICAgIHJlc3BvbnNlTGVuZ3RoOiB0cnVlLFxuICAgICAgICAgIHN0YXR1czogdHJ1ZSxcbiAgICAgICAgICB1c2VyOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHByb3BzLmNvcnNDb25maWcgfHwge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUyxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIGFsbG93SGVhZGVyczogW1xuICAgICAgICAgICdDb250ZW50LVR5cGUnLFxuICAgICAgICAgICdYLUFtei1EYXRlJyxcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbicsXG4gICAgICAgICAgJ1gtQXBpLUtleScsXG4gICAgICAgICAgJ1gtQW16LVNlY3VyaXR5LVRva2VuJyxcbiAgICAgICAgICAnWC1Vc2VyLUlkJyxcbiAgICAgICAgICAnWC1Vc2VyLVRpZXInLFxuICAgICAgICAgICdYLUNvcnJlbGF0aW9uLUlkJyxcbiAgICAgICAgXSxcbiAgICAgICAgbWF4QWdlOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICB9LFxuICAgICAgZW5kcG9pbnRDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIHR5cGVzOiBbYXBpZ2F0ZXdheS5FbmRwb2ludFR5cGUuUkVHSU9OQUxdLFxuICAgICAgfSxcbiAgICAgIGNsb3VkV2F0Y2hSb2xlOiB0cnVlLFxuICAgIH0pXG4gICAgXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gUmVxdWVzdCBWYWxpZGF0b3IgPT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCByZXF1ZXN0VmFsaWRhdG9yID0gbmV3IGFwaWdhdGV3YXkuUmVxdWVzdFZhbGlkYXRvcih0aGlzLCAnUmVxdWVzdFZhbGlkYXRvcicsIHtcbiAgICAgIHJlc3RBcGk6IHRoaXMuYXBpLFxuICAgICAgdmFsaWRhdGVSZXF1ZXN0Qm9keTogdHJ1ZSxcbiAgICAgIHZhbGlkYXRlUmVxdWVzdFBhcmFtZXRlcnM6IHRydWUsXG4gICAgfSlcbiAgICBcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBBUEkgS2V5ICYgVXNhZ2UgUGxhbiA9PT09PT09PT09PT09PT09PT09PVxuICAgIGlmIChlbmFibGVBcGlLZXkpIHtcbiAgICAgIHRoaXMuYXBpS2V5ID0gbmV3IGFwaWdhdGV3YXkuQXBpS2V5KHRoaXMsICdBcGlLZXknLCB7XG4gICAgICAgIGFwaUtleU5hbWU6IGBwb3N0b2xpby0ke3NlcnZpY2VOYW1lfS0ke2Vudmlyb25tZW50fS1rZXlgLFxuICAgICAgICBkZXNjcmlwdGlvbjogYEFQSSBrZXkgZm9yICR7c2VydmljZU5hbWV9IHNlcnZpY2VgLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgfSlcbiAgICAgIFxuICAgICAgaWYgKGVuYWJsZVVzYWdlUGxhbikge1xuICAgICAgICB0aGlzLnVzYWdlUGxhbiA9IG5ldyBhcGlnYXRld2F5LlVzYWdlUGxhbih0aGlzLCAnVXNhZ2VQbGFuJywge1xuICAgICAgICAgIG5hbWU6IGBwb3N0b2xpby0ke3NlcnZpY2VOYW1lfS0ke2Vudmlyb25tZW50fS11c2FnZWAsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGBVc2FnZSBwbGFuIGZvciAke3NlcnZpY2VOYW1lfSBzZXJ2aWNlYCxcbiAgICAgICAgICBhcGlTdGFnZXM6IFt7XG4gICAgICAgICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgICAgICAgc3RhZ2U6IHRoaXMuYXBpLmRlcGxveW1lbnRTdGFnZSxcbiAgICAgICAgICB9XSxcbiAgICAgICAgICB0aHJvdHRsZToge1xuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBxdW90YToge1xuICAgICAgICAgICAgbGltaXQ6IDEwMDAwLFxuICAgICAgICAgICAgcGVyaW9kOiBhcGlnYXRld2F5LlBlcmlvZC5EQVksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHRoaXMudXNhZ2VQbGFuLmFkZEFwaUtleSh0aGlzLmFwaUtleSlcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gV0FGIEludGVncmF0aW9uID09PT09PT09PT09PT09PT09PT09XG4gICAgaWYgKGVuYWJsZVdhZikge1xuICAgICAgdGhpcy53ZWJBY2wgPSBuZXcgd2FmdjIuQ2ZuV2ViQUNMKHRoaXMsICdXZWJBY2wnLCB7XG4gICAgICAgIHNjb3BlOiAnUkVHSU9OQUwnLFxuICAgICAgICBuYW1lOiBgcG9zdG9saW8tJHtzZXJ2aWNlTmFtZX0tJHtlbnZpcm9ubWVudH0td2FmYCxcbiAgICAgICAgZGVzY3JpcHRpb246IGBXQUYgcnVsZXMgZm9yICR7c2VydmljZU5hbWV9IEFQSWAsXG4gICAgICAgIGRlZmF1bHRBY3Rpb246IHsgYWxsb3c6IHt9IH0sXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAgLy8gUmF0ZSBsaW1pdGluZyBydWxlXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ1JhdGVMaW1pdFJ1bGUnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgICAgICBzdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgcmF0ZUJhc2VkU3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgICAgbGltaXQ6IDIwMDAsIC8vIDIwMDAgcmVxdWVzdHMgcGVyIDUgbWludXRlc1xuICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZUtleVR5cGU6ICdJUCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYWN0aW9uOiB7IGJsb2NrOiB7fSB9LFxuICAgICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdSYXRlTGltaXRSdWxlJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyBTUUwgaW5qZWN0aW9uIHByb3RlY3Rpb25cbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnU3FsSW5qZWN0aW9uUnVsZScsXG4gICAgICAgICAgICBwcmlvcml0eTogMixcbiAgICAgICAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICAgICAgICBzcWxpTWF0Y2hTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgICBmaWVsZFRvTWF0Y2g6IHsgYWxsUXVlcnlBcmd1bWVudHM6IHt9IH0sXG4gICAgICAgICAgICAgICAgdGV4dFRyYW5zZm9ybWF0aW9uczogW3tcbiAgICAgICAgICAgICAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgICAgICAgICAgICAgdHlwZTogJ1VSTF9ERUNPREUnLFxuICAgICAgICAgICAgICAgIH0sIHtcbiAgICAgICAgICAgICAgICAgIHByaW9yaXR5OiAxLFxuICAgICAgICAgICAgICAgICAgdHlwZTogJ0hUTUxfRU5USVRZX0RFQ09ERScsXG4gICAgICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYWN0aW9uOiB7IGJsb2NrOiB7fSB9LFxuICAgICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdTcWxJbmplY3Rpb25SdWxlJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyBYU1MgcHJvdGVjdGlvblxuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdYc3NSdWxlJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAzLFxuICAgICAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIHhzc01hdGNoU3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgICAgZmllbGRUb01hdGNoOiB7IGFsbFF1ZXJ5QXJndW1lbnRzOiB7fSB9LFxuICAgICAgICAgICAgICAgIHRleHRUcmFuc2Zvcm1hdGlvbnM6IFt7XG4gICAgICAgICAgICAgICAgICBwcmlvcml0eTogMCxcbiAgICAgICAgICAgICAgICAgIHR5cGU6ICdVUkxfREVDT0RFJyxcbiAgICAgICAgICAgICAgICB9LCB7XG4gICAgICAgICAgICAgICAgICBwcmlvcml0eTogMSxcbiAgICAgICAgICAgICAgICAgIHR5cGU6ICdIVE1MX0VOVElUWV9ERUNPREUnLFxuICAgICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGFjdGlvbjogeyBibG9jazoge30gfSxcbiAgICAgICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnWHNzUnVsZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBtZXRyaWNOYW1lOiBgJHtzZXJ2aWNlTmFtZX0td2FmYCxcbiAgICAgICAgfSxcbiAgICAgIH0pXG4gICAgICBcbiAgICAgIC8vIEFzc29jaWF0ZSBXQUYgd2l0aCBBUEkgR2F0ZXdheVxuICAgICAgbmV3IHdhZnYyLkNmbldlYkFDTEFzc29jaWF0aW9uKHRoaXMsICdXZWJBY2xBc3NvY2lhdGlvbicsIHtcbiAgICAgICAgcmVzb3VyY2VBcm46IGBhcm46YXdzOmFwaWdhdGV3YXk6JHtjZGsuU3RhY2sub2YodGhpcykucmVnaW9ufTo6L3Jlc3RhcGlzLyR7dGhpcy5hcGkucmVzdEFwaUlkfS9zdGFnZXMvJHtlbnZpcm9ubWVudH1gLFxuICAgICAgICB3ZWJBY2xBcm46IHRoaXMud2ViQWNsLmF0dHJBcm4sXG4gICAgICB9KVxuICAgIH1cbiAgICBcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBBUEkgUmVzb3VyY2VzICYgTWV0aG9kcyA9PT09PT09PT09PT09PT09PT09PVxuICAgIE9iamVjdC5lbnRyaWVzKGxhbWJkYUludGVncmF0aW9ucykuZm9yRWFjaCgoW3BhdGgsIGNvbmZpZ10pID0+IHtcbiAgICAgIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGguc3BsaXQoJy8nKS5maWx0ZXIocCA9PiBwKVxuICAgICAgbGV0IHJlc291cmNlID0gdGhpcy5hcGkucm9vdFxuICAgICAgXG4gICAgICAvLyBCdWlsZCByZXNvdXJjZSBwYXRoXG4gICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGF0aFBhcnRzKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUmVzb3VyY2UgPSByZXNvdXJjZS5nZXRSZXNvdXJjZShwYXJ0KVxuICAgICAgICBpZiAoZXhpc3RpbmdSZXNvdXJjZSkge1xuICAgICAgICAgIHJlc291cmNlID0gZXhpc3RpbmdSZXNvdXJjZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc291cmNlID0gcmVzb3VyY2UuYWRkUmVzb3VyY2UocGFydClcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBBZGQgbWV0aG9kcyB3aXRoIGFwcHJvcHJpYXRlIGF1dGhvcml6YXRpb25cbiAgICAgIGNvbmZpZy5tZXRob2RzLmZvckVhY2gobWV0aG9kID0+IHtcbiAgICAgICAgLy8gQnVpbGQgbWV0aG9kT3B0aW9ucyBvYmplY3Qgd2l0aCBhbGwgcHJvcGVydGllcyBhdCBjcmVhdGlvbiB0aW1lXG4gICAgICAgIGxldCBhdXRob3JpemF0aW9uVHlwZSA9IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuTk9ORVxuICAgICAgICBsZXQgYXBpS2V5UmVxdWlyZWQgPSBmYWxzZVxuICAgICAgICBsZXQgbWV0aG9kUmVzcG9uc2VzOiBhcGlnYXRld2F5Lk1ldGhvZFJlc3BvbnNlW10gfCB1bmRlZmluZWQgPSB1bmRlZmluZWRcbiAgICAgICAgXG4gICAgICAgIC8vIENvbmZpZ3VyZSBhdXRob3JpemF0aW9uIGJhc2VkIG9uIGF1dGhUeXBlXG4gICAgICAgIHN3aXRjaCAoY29uZmlnLmF1dGhUeXBlKSB7XG4gICAgICAgICAgY2FzZSAnSUFNJzpcbiAgICAgICAgICAgIGF1dGhvcml6YXRpb25UeXBlID0gYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU1cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgY2FzZSAnQVBJX0tFWSc6XG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZSA9IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuTk9ORVxuICAgICAgICAgICAgYXBpS2V5UmVxdWlyZWQgPSB0cnVlXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIGNhc2UgJ05PTkUnOlxuICAgICAgICAgICAgYXV0aG9yaXphdGlvblR5cGUgPSBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLk5PTkVcbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChjb25maWcuYXBpS2V5UmVxdWlyZWQpIHtcbiAgICAgICAgICBhcGlLZXlSZXF1aXJlZCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gQWRkIHRocm90dGxpbmcgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb25maWcudGhyb3R0bGUpIHtcbiAgICAgICAgICBtZXRob2RSZXNwb25zZXMgPSBbe1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgfSwge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogJzQyOScsXG4gICAgICAgICAgfV1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gQ3JlYXRlIG1ldGhvZE9wdGlvbnMgd2l0aCBhbGwgcHJvcGVydGllc1xuICAgICAgICBjb25zdCBtZXRob2RPcHRpb25zOiBhcGlnYXRld2F5Lk1ldGhvZE9wdGlvbnMgPSB7XG4gICAgICAgICAgcmVxdWVzdFZhbGlkYXRvcixcbiAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZSxcbiAgICAgICAgICBhcGlLZXlSZXF1aXJlZCxcbiAgICAgICAgICBtZXRob2RSZXNwb25zZXNcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gQ3JlYXRlIExhbWJkYSBpbnRlZ3JhdGlvblxuICAgICAgICBjb25zdCBpbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGNvbmZpZy5sYW1iZGEsIHtcbiAgICAgICAgICBwcm94eTogdHJ1ZSxcbiAgICAgICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW3tcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIH0sIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6ICc0MjknLFxuICAgICAgICAgICAgc2VsZWN0aW9uUGF0dGVybjogJy4qUmF0ZSBsaW1pdCBleGNlZWRlZC4qJyxcbiAgICAgICAgICB9XSxcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJlc291cmNlLmFkZE1ldGhvZChtZXRob2QsIGludGVncmF0aW9uLCBtZXRob2RPcHRpb25zKVxuICAgICAgfSlcbiAgICB9KVxuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IEFQSSBEb2N1bWVudGF0aW9uID09PT09PT09PT09PT09PT09PT09XG4gICAgbmV3IGFwaWdhdGV3YXkuQ2ZuRG9jdW1lbnRhdGlvblBhcnQodGhpcywgJ0FwaURvY3VtZW50YXRpb24nLCB7XG4gICAgICBsb2NhdGlvbjoge1xuICAgICAgICB0eXBlOiAnQVBJJyxcbiAgICAgIH0sXG4gICAgICBwcm9wZXJ0aWVzOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGRlc2NyaXB0aW9uOiBgU2VjdXJlZCBBUEkgR2F0ZXdheSBmb3IgJHtzZXJ2aWNlTmFtZX0gbWljcm9zZXJ2aWNlYCxcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcbiAgICAgICAgY29udGFjdDoge1xuICAgICAgICAgIG5hbWU6ICdQb3N0b2xpbyBUZWFtJyxcbiAgICAgICAgICBlbWFpbDogJ3N1cHBvcnRAcG9zdG9saW8uY29tJyxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgcmVzdEFwaUlkOiB0aGlzLmFwaS5yZXN0QXBpSWQsXG4gICAgfSlcbiAgICBcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBJQU0gUG9saWNpZXMgPT09PT09PT09PT09PT09PT09PT1cbiAgICBcbiAgICAvLyBDcmVhdGUgSUFNIHBvbGljeSBmb3IgQVBJIGFjY2Vzc1xuICAgIGNvbnN0IGFwaUFjY2Vzc1BvbGljeSA9IG5ldyBpYW0uTWFuYWdlZFBvbGljeSh0aGlzLCAnQXBpQWNjZXNzUG9saWN5Jywge1xuICAgICAgbWFuYWdlZFBvbGljeU5hbWU6IGBwb3N0b2xpby0ke3NlcnZpY2VOYW1lfS0ke2Vudmlyb25tZW50fS1hcGktYWNjZXNzYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgUG9saWN5IGZvciBhY2Nlc3NpbmcgJHtzZXJ2aWNlTmFtZX0gQVBJYCxcbiAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICBhY3Rpb25zOiBbJ2V4ZWN1dGUtYXBpOkludm9rZSddLFxuICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgYGFybjphd3M6ZXhlY3V0ZS1hcGk6JHtjZGsuU3RhY2sub2YodGhpcykucmVnaW9ufToke2Nkay5TdGFjay5vZih0aGlzKS5hY2NvdW50fToke3RoaXMuYXBpLnJlc3RBcGlJZH0vKi8qLypgLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KVxuICAgIFxuICAgIC8vIENyZWF0ZSBJQU0gcm9sZSBmb3Igc2VydmljZS10by1zZXJ2aWNlIGNvbW11bmljYXRpb25cbiAgICBjb25zdCBzZXJ2aWNlUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnU2VydmljZVJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogYHBvc3RvbGlvLSR7c2VydmljZU5hbWV9LSR7ZW52aXJvbm1lbnR9LXNlcnZpY2Utcm9sZWAsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKFxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZWNzLXRhc2tzLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFthcGlBY2Nlc3NQb2xpY3ldLFxuICAgICAgZGVzY3JpcHRpb246IGBTZXJ2aWNlIHJvbGUgZm9yICR7c2VydmljZU5hbWV9IG1pY3Jvc2VydmljZWAsXG4gICAgfSlcbiAgICBcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBPdXRwdXRzID09PT09PT09PT09PT09PT09PT09XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogYEFQSSBHYXRld2F5IFVSTCBmb3IgJHtzZXJ2aWNlTmFtZX1gLFxuICAgIH0pXG4gICAgXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUlkJywge1xuICAgICAgdmFsdWU6IHRoaXMuYXBpLnJlc3RBcGlJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIEdhdGV3YXkgSUQgZm9yICR7c2VydmljZU5hbWV9YCxcbiAgICB9KVxuICAgIFxuICAgIGlmICh0aGlzLmFwaUtleSkge1xuICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUtleUlkJywge1xuICAgICAgICB2YWx1ZTogdGhpcy5hcGlLZXkua2V5SWQsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIEtleSBJRCBmb3IgJHtzZXJ2aWNlTmFtZX1gLFxuICAgICAgfSlcbiAgICB9XG4gICAgXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NlcnZpY2VSb2xlQXJuJywge1xuICAgICAgdmFsdWU6IHNlcnZpY2VSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogYFNlcnZpY2Ugcm9sZSBBUk4gZm9yICR7c2VydmljZU5hbWV9YCxcbiAgICB9KVxuICB9XG59XG4iXX0=