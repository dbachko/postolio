/**
 * Simple API Gateway Stack
 * Creates API Gateway endpoints for token-service and content-scheduler
 * with IAM authentication to replace service discovery
 */

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface ApiGatewayStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  tokenServiceFunction: lambda.IFunction;
  schedulerFunction: lambda.IFunction;
}

export class ApiGatewayStack extends cdk.Stack {
  public readonly tokenServiceUrl: string;
  public readonly schedulerServiceUrl: string;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    const { environment, tokenServiceFunction, schedulerFunction } = props;

    // Token Service API Gateway
    const tokenApi = new apigateway.RestApi(this, 'TokenServiceApi', {
      restApiName: `postolio-token-service-${environment}`,
      description: `Token Service API for ${environment}`,
      defaultMethodOptions: {
        authorizationType: apigateway.AuthorizationType.IAM,
      },
      // Enable CORS for web frontend if needed
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'PUT', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      },
    });

    // Token Service Routes: /tokens/{userId}/{platform}/{brandId}
    const tokensResource = tokenApi.root.addResource('tokens');
    const userIdResource = tokensResource.addResource('{userId}');
    const platformResource = userIdResource.addResource('{platform}');
    const brandIdResource = platformResource.addResource('{brandId}');

    // GET and PUT methods for token operations
    const tokenIntegration = new apigateway.LambdaIntegration(tokenServiceFunction, {
      requestTemplates: {
        'application/json': JSON.stringify({
          userId: "$input.params('userId')",
          platform: "$input.params('platform')",
          brandId: "$input.params('brandId')",
          httpMethod: '$context.httpMethod',
          body: "$input.json('$')",
        }),
      },
    });

    brandIdResource.addMethod('GET', tokenIntegration);
    brandIdResource.addMethod('PUT', tokenIntegration);

    // Health check endpoint
    const tokenHealthResource = tokenApi.root.addResource('health');
    tokenHealthResource.addMethod('GET', new apigateway.LambdaIntegration(tokenServiceFunction));

    // Content Scheduler API Gateway
    const schedulerApi = new apigateway.RestApi(this, 'SchedulerApi', {
      restApiName: `postolio-scheduler-${environment}`,
      description: `Content Scheduler API for ${environment}`,
      defaultMethodOptions: {
        authorizationType: apigateway.AuthorizationType.IAM,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      },
    });

    // Scheduler Service Routes: /schedules
    const schedulesResource = schedulerApi.root.addResource('schedules');
    const scheduleIntegration = new apigateway.LambdaIntegration(schedulerFunction);

    // List and create schedules
    schedulesResource.addMethod('GET', scheduleIntegration); // List schedules with filters
    schedulesResource.addMethod('POST', scheduleIntegration); // Create new schedule

    // Individual schedule operations: /schedules/{id}
    const scheduleIdResource = schedulesResource.addResource('{id}');
    scheduleIdResource.addMethod('GET', scheduleIntegration); // Get specific schedule
    scheduleIdResource.addMethod('PUT', scheduleIntegration); // Update schedule
    scheduleIdResource.addMethod('DELETE', scheduleIntegration); // Delete schedule

    // Health check endpoint
    const schedulerHealthResource = schedulerApi.root.addResource('health');
    schedulerHealthResource.addMethod('GET', scheduleIntegration);

    // Store URLs for environment variables
    this.tokenServiceUrl = tokenApi.url;
    this.schedulerServiceUrl = schedulerApi.url;

    // Create IAM policy for service-to-service communication
    const serviceClientPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowApiGatewayInvoke',
          effect: iam.Effect.ALLOW,
          actions: ['execute-api:Invoke'],
          resources: [
            `${tokenApi.arnForExecuteApi('*', '/tokens/*')}`,
            `${schedulerApi.arnForExecuteApi('*', '/schedules*')}`,
            `${tokenApi.arnForExecuteApi('*', '/health')}`,
            `${schedulerApi.arnForExecuteApi('*', '/health')}`,
          ],
        }),
      ],
    });

    // Apply the policy to Lambda execution roles
    const lambdaFunctions = [tokenServiceFunction, schedulerFunction];
    const policyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:Invoke'],
      resources: [
        `${tokenApi.arnForExecuteApi('*', '/tokens/*')}`,
        `${schedulerApi.arnForExecuteApi('*', '/schedules*')}`,
        `${tokenApi.arnForExecuteApi('*', '/health')}`,
        `${schedulerApi.arnForExecuteApi('*', '/health')}`,
      ],
    });

    lambdaFunctions.forEach((fn) => {
      fn.addToRolePolicy(policyStatement);
    });

    // Outputs for environment configuration
    new cdk.CfnOutput(this, 'TokenServiceUrl', {
      value: this.tokenServiceUrl,
      description: 'Token Service API Gateway URL',
      exportName: `${this.stackName}-TokenServiceUrl`,
    });

    new cdk.CfnOutput(this, 'SchedulerServiceUrl', {
      value: this.schedulerServiceUrl,
      description: 'Content Scheduler API Gateway URL',
      exportName: `${this.stackName}-SchedulerServiceUrl`,
    });

    // Output environment variables format for easy copy-paste
    new cdk.CfnOutput(this, 'EnvironmentVariables', {
      value: JSON.stringify(
        {
          TOKEN_SERVICE_URL: this.tokenServiceUrl,
          CONTENT_SCHEDULER_URL: this.schedulerServiceUrl,
          SCHEDULER_API_URL: this.schedulerServiceUrl,
        },
        null,
        2
      ),
      description: 'Environment variables for API Gateway URLs',
    });

    // Add tags
    cdk.Tags.of(this).add('Service', 'ApiGateway');
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Purpose', 'ServiceToServiceCommunication');
  }
}
