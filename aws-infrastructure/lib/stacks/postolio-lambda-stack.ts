import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PostolioLambdaStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  databaseUrl: string;
  redisUrl?: string;
}

/**
 * Lambda Stack for Postolio EventBridge Handlers
 * This stack creates the main Lambda function that handles EventBridge scheduled events
 */
export class PostolioLambdaStack extends cdk.Stack {
  public readonly mainLambdaFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: PostolioLambdaStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const prefix = `postolio-${environment}`;

    // ==================== Secrets Management ====================
    
    // Store sensitive configuration in Secrets Manager
    const apiCredentials = new secretsmanager.Secret(this, 'ApiCredentials', {
      secretName: `${prefix}-api-credentials`,
      description: 'API credentials for internal services',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          mainAppApiUrl: '',
          mainAppApiKey: '',
        }),
        generateStringKey: 'apiKey',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    // OpenAI API Key (reference existing secret)
    const openAiSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'OpenAiSecret',
      `${prefix}-openai-key`
    );

    // ==================== IAM Role with Least Privilege ====================
    
    const lambdaRole = new iam.Role(this, 'EventBridgeLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for Postolio EventBridge Lambda handlers',
      roleName: `${prefix}-eventbridge-lambda-role`,
    });

    // Add managed policy for basic Lambda execution
    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Add X-Ray permissions
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
      ],
      resources: ['*'], // X-Ray requires wildcard
    }));

    // Add permissions for accessing secrets
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: [
        apiCredentials.secretArn,
        openAiSecret.secretArn,
      ],
    }));

    // Add permissions for Parameter Store
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
      ],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/*`,
      ],
    }));

    // ==================== Lambda Function ====================
    
    this.mainLambdaFunction = new lambdaNodejs.NodejsFunction(this, 'EventBridgeHandler', {
      functionName: `${prefix}-eventbridge-handler`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../src/lambda/eventbridge-handler.ts'),
      role: lambdaRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: environment === 'prod' ? 2048 : 1024,
      reservedConcurrentExecutions: environment === 'prod' ? 10 : undefined,
      environment: {
        NODE_ENV: environment,
        ENVIRONMENT: environment,
        DATABASE_URL: props.databaseUrl,
        REDIS_URL: props.redisUrl || '',
        API_CREDENTIALS_SECRET_ARN: apiCredentials.secretArn,
        OPENAI_SECRET_ARN: openAiSecret.secretArn,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        PARAMETER_STORE_PREFIX: `/${prefix}`,
      },
      bundling: {
        minify: environment === 'prod',
        sourceMap: environment !== 'prod',
        target: 'es2022',
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        externalModules: [
          '@aws-sdk/*', // Use Lambda runtime's AWS SDK
          'pg-native', // Native module not needed
        ],
        nodeModules: [
          '@prisma/client',
          'fastify',
          'openai',
        ],
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return []
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            // Copy Prisma client
            return [
              `cp -r ${inputDir}/node_modules/.prisma ${outputDir}/`,
              `mkdir -p ${outputDir}/node_modules/@prisma/`,
              `cp -r ${inputDir}/node_modules/@prisma/client ${outputDir}/node_modules/@prisma/`,
            ]
          },
          beforeInstall(inputDir: string, outputDir: string): string[] {
            return []
          },
        },
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueueEnabled: true,
      deadLetterQueue: undefined, // Will be created automatically
    });

    // ==================== Store Lambda ARN in Parameter Store ====================
    
    new ssm.StringParameter(this, 'LambdaArnParameter', {
      parameterName: `/${prefix}/lambda/eventbridge-handler-arn`,
      stringValue: this.mainLambdaFunction.functionArn,
      description: 'ARN of the main EventBridge handler Lambda function',
    });

    // ==================== Outputs ====================
    
    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: this.mainLambdaFunction.functionArn,
      description: 'ARN of the EventBridge handler Lambda function',
      exportName: `${prefix}-lambda-arn`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: this.mainLambdaFunction.functionName,
      description: 'Name of the EventBridge handler Lambda function',
      exportName: `${prefix}-lambda-name`,
    });
  }
}