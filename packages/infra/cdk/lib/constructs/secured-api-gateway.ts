/**
 * Secured API Gateway with IAM Authorization
 * Enterprise-grade API security for microservices
 */

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
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

export class SecuredApiGateway extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly apiKey?: apigateway.ApiKey;
  public readonly usagePlan?: apigateway.UsagePlan;
  public readonly webAcl?: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: SecuredApiGatewayProps) {
    super(scope, id);

    const {
      environment,
      serviceName,
      lambdaIntegrations,
      enableWaf,
      enableApiKey,
      enableUsagePlan,
    } = props;

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
        accessLogDestination: new apigateway.LogGroupLogDestination(
          new logs.LogGroup(this, 'ApiAccessLogs', {
            logGroupName: `/aws/api-gateway/postolio-${serviceName}-${environment}`,
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          })
        ),
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
          apiStages: [
            {
              api: this.api,
              stage: this.api.deploymentStage,
            },
          ],
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
                textTransformations: [
                  {
                    priority: 0,
                    type: 'URL_DECODE',
                  },
                  {
                    priority: 1,
                    type: 'HTML_ENTITY_DECODE',
                  },
                ],
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
                textTransformations: [
                  {
                    priority: 0,
                    type: 'URL_DECODE',
                  },
                  {
                    priority: 1,
                    type: 'HTML_ENTITY_DECODE',
                  },
                ],
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
      const pathParts = path.split('/').filter((p) => p);
      let resource = this.api.root;

      // Build resource path
      for (const part of pathParts) {
        const existingResource = resource.getResource(part);
        if (existingResource) {
          resource = existingResource;
        } else {
          resource = resource.addResource(part);
        }
      }

      // Add methods with appropriate authorization
      config.methods.forEach((method) => {
        // Build methodOptions object with all properties at creation time
        let authorizationType = apigateway.AuthorizationType.NONE;
        let apiKeyRequired = false;
        let methodResponses: apigateway.MethodResponse[] | undefined = undefined;

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
          methodResponses = [
            {
              statusCode: '200',
            },
            {
              statusCode: '429',
            },
          ];
        }

        // Create methodOptions with all properties
        const methodOptions: apigateway.MethodOptions = {
          requestValidator,
          authorizationType,
          apiKeyRequired,
          methodResponses,
        };

        // Create Lambda integration
        const integration = new apigateway.LambdaIntegration(config.lambda, {
          proxy: true,
          integrationResponses: [
            {
              statusCode: '200',
            },
            {
              statusCode: '429',
              selectionPattern: '.*Rate limit exceeded.*',
            },
          ],
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
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
      ),
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
