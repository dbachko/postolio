"use strict";
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
exports.PostolioLambdaStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const lambdaNodejs = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
const path = __importStar(require("path"));
/**
 * Lambda Stack for Postolio EventBridge Handlers
 * This stack creates the main Lambda function that handles EventBridge scheduled events
 */
class PostolioLambdaStack extends cdk.Stack {
    mainLambdaFunction;
    constructor(scope, id, props) {
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
        const openAiSecret = secretsmanager.Secret.fromSecretNameV2(this, 'OpenAiSecret', `${prefix}-openai-key`);
        // ==================== IAM Role with Least Privilege ====================
        const lambdaRole = new iam.Role(this, 'EventBridgeLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'Execution role for Postolio EventBridge Lambda handlers',
            roleName: `${prefix}-eventbridge-lambda-role`,
        });
        // Add managed policy for basic Lambda execution
        lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
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
                    beforeBundling(inputDir, outputDir) {
                        return [];
                    },
                    afterBundling(inputDir, outputDir) {
                        // Copy Prisma client
                        return [
                            `cp -r ${inputDir}/node_modules/.prisma ${outputDir}/`,
                            `mkdir -p ${outputDir}/node_modules/@prisma/`,
                            `cp -r ${inputDir}/node_modules/@prisma/client ${outputDir}/node_modules/@prisma/`,
                        ];
                    },
                    beforeInstall(inputDir, outputDir) {
                        return [];
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
exports.PostolioLambdaStack = PostolioLambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9zdG9saW8tbGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicG9zdG9saW8tbGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQsNEVBQThEO0FBQzlELHlEQUEyQztBQUMzQywyREFBNkM7QUFDN0MsK0VBQWlFO0FBQ2pFLHlEQUEyQztBQUUzQywyQ0FBNkI7QUFRN0I7OztHQUdHO0FBQ0gsTUFBYSxtQkFBb0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNoQyxrQkFBa0IsQ0FBa0I7SUFFcEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUErQjtRQUN2RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBQzlCLE1BQU0sTUFBTSxHQUFHLFlBQVksV0FBVyxFQUFFLENBQUM7UUFFekMsK0RBQStEO1FBRS9ELG1EQUFtRDtRQUNuRCxNQUFNLGNBQWMsR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3ZFLFVBQVUsRUFBRSxHQUFHLE1BQU0sa0JBQWtCO1lBQ3ZDLFdBQVcsRUFBRSx1Q0FBdUM7WUFDcEQsb0JBQW9CLEVBQUU7Z0JBQ3BCLG9CQUFvQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25DLGFBQWEsRUFBRSxFQUFFO29CQUNqQixhQUFhLEVBQUUsRUFBRTtpQkFDbEIsQ0FBQztnQkFDRixpQkFBaUIsRUFBRSxRQUFRO2dCQUMzQixpQkFBaUIsRUFBRSwrQkFBK0I7YUFDbkQ7U0FDRixDQUFDLENBQUM7UUFFSCw2Q0FBNkM7UUFDN0MsTUFBTSxZQUFZLEdBQUcsY0FBYyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FD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LG9CQUFvQixFQUFFO1lBQ2xELGFBQWEsRUFBRSxJQUFJLE1BQU0saUNBQWlDO1lBQzFELFdBQVcsRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsV0FBVztZQUNoRCxXQUFXLEVBQUUscURBQXFEO1NBQ25FLENBQUMsQ0FBQztRQUVILG9EQUFvRDtRQUVwRCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzNDLEtBQUssRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsV0FBVztZQUMxQyxXQUFXLEVBQUUsZ0RBQWdEO1lBQzdELFVBQVUsRUFBRSxHQUFHLE1BQU0sYUFBYTtTQUNuQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzVDLEtBQUssRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsWUFBWTtZQUMzQyxXQUFXLEVBQUUsaURBQWlEO1lBQzlELFVBQVUsRUFBRSxHQUFHLE1BQU0sY0FBYztTQUNwQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFsS0Qsa0RBa0tDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGxhbWJkYU5vZGVqcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBzc20gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9zdG9saW9MYW1iZGFTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBlbnZpcm9ubWVudDogJ2RldicgfCAnc3RhZ2luZycgfCAncHJvZCc7XG4gIGRhdGFiYXNlVXJsOiBzdHJpbmc7XG4gIHJlZGlzVXJsPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIExhbWJkYSBTdGFjayBmb3IgUG9zdG9saW8gRXZlbnRCcmlkZ2UgSGFuZGxlcnNcbiAqIFRoaXMgc3RhY2sgY3JlYXRlcyB0aGUgbWFpbiBMYW1iZGEgZnVuY3Rpb24gdGhhdCBoYW5kbGVzIEV2ZW50QnJpZGdlIHNjaGVkdWxlZCBldmVudHNcbiAqL1xuZXhwb3J0IGNsYXNzIFBvc3RvbGlvTGFtYmRhU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgbWFpbkxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFBvc3RvbGlvTGFtYmRhU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZpcm9ubWVudCB9ID0gcHJvcHM7XG4gICAgY29uc3QgcHJlZml4ID0gYHBvc3RvbGlvLSR7ZW52aXJvbm1lbnR9YDtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IFNlY3JldHMgTWFuYWdlbWVudCA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIC8vIFN0b3JlIHNlbnNpdGl2ZSBjb25maWd1cmF0aW9uIGluIFNlY3JldHMgTWFuYWdlclxuICAgIGNvbnN0IGFwaUNyZWRlbnRpYWxzID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnQXBpQ3JlZGVudGlhbHMnLCB7XG4gICAgICBzZWNyZXROYW1lOiBgJHtwcmVmaXh9LWFwaS1jcmVkZW50aWFsc2AsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBjcmVkZW50aWFscyBmb3IgaW50ZXJuYWwgc2VydmljZXMnLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBtYWluQXBwQXBpVXJsOiAnJyxcbiAgICAgICAgICBtYWluQXBwQXBpS2V5OiAnJyxcbiAgICAgICAgfSksXG4gICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAnYXBpS2V5JyxcbiAgICAgICAgZXhjbHVkZUNoYXJhY3RlcnM6ICcgJSt+YCMkJiooKXxbXXt9Ojs8Pj8hXFwnL0BcIlxcXFwnLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIE9wZW5BSSBBUEkgS2V5IChyZWZlcmVuY2UgZXhpc3Rpbmcgc2VjcmV0KVxuICAgIGNvbnN0IG9wZW5BaVNlY3JldCA9IHNlY3JldHNtYW5hZ2VyLlNlY3JldC5mcm9tU2VjcmV0TmFtZVYyKFxuICAgICAgdGhpcyxcbiAgICAgICdPcGVuQWlTZWNyZXQnLFxuICAgICAgYCR7cHJlZml4fS1vcGVuYWkta2V5YFxuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBJQU0gUm9sZSB3aXRoIExlYXN0IFByaXZpbGVnZSA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0V2ZW50QnJpZGdlTGFtYmRhUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdFeGVjdXRpb24gcm9sZSBmb3IgUG9zdG9saW8gRXZlbnRCcmlkZ2UgTGFtYmRhIGhhbmRsZXJzJyxcbiAgICAgIHJvbGVOYW1lOiBgJHtwcmVmaXh9LWV2ZW50YnJpZGdlLWxhbWJkYS1yb2xlYCxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBtYW5hZ2VkIHBvbGljeSBmb3IgYmFzaWMgTGFtYmRhIGV4ZWN1dGlvblxuICAgIGxhbWJkYVJvbGUuYWRkTWFuYWdlZFBvbGljeShcbiAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXG4gICAgKTtcblxuICAgIC8vIEFkZCBYLVJheSBwZXJtaXNzaW9uc1xuICAgIGxhbWJkYVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAneHJheTpQdXRUcmFjZVNlZ21lbnRzJyxcbiAgICAgICAgJ3hyYXk6UHV0VGVsZW1ldHJ5UmVjb3JkcycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSwgLy8gWC1SYXkgcmVxdWlyZXMgd2lsZGNhcmRcbiAgICB9KSk7XG5cbiAgICAvLyBBZGQgcGVybWlzc2lvbnMgZm9yIGFjY2Vzc2luZyBzZWNyZXRzXG4gICAgbGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZScsXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpEZXNjcmliZVNlY3JldCcsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGFwaUNyZWRlbnRpYWxzLnNlY3JldEFybixcbiAgICAgICAgb3BlbkFpU2VjcmV0LnNlY3JldEFybixcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gQWRkIHBlcm1pc3Npb25zIGZvciBQYXJhbWV0ZXIgU3RvcmVcbiAgICBsYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXInLFxuICAgICAgICAnc3NtOkdldFBhcmFtZXRlcnMnLFxuICAgICAgICAnc3NtOkdldFBhcmFtZXRlcnNCeVBhdGgnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpzc206JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnBhcmFtZXRlci8ke3ByZWZpeH0vKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IExhbWJkYSBGdW5jdGlvbiA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIHRoaXMubWFpbkxhbWJkYUZ1bmN0aW9uID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAnRXZlbnRCcmlkZ2VIYW5kbGVyJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgJHtwcmVmaXh9LWV2ZW50YnJpZGdlLWhhbmRsZXJgLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uLy4uL3NyYy9sYW1iZGEvZXZlbnRicmlkZ2UtaGFuZGxlci50cycpLFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IDIwNDggOiAxMDI0LFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IDEwIDogdW5kZWZpbmVkLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTk9ERV9FTlY6IGVudmlyb25tZW50LFxuICAgICAgICBFTlZJUk9OTUVOVDogZW52aXJvbm1lbnQsXG4gICAgICAgIERBVEFCQVNFX1VSTDogcHJvcHMuZGF0YWJhc2VVcmwsXG4gICAgICAgIFJFRElTX1VSTDogcHJvcHMucmVkaXNVcmwgfHwgJycsXG4gICAgICAgIEFQSV9DUkVERU5USUFMU19TRUNSRVRfQVJOOiBhcGlDcmVkZW50aWFscy5zZWNyZXRBcm4sXG4gICAgICAgIE9QRU5BSV9TRUNSRVRfQVJOOiBvcGVuQWlTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgICBMT0dfTEVWRUw6IGVudmlyb25tZW50ID09PSAncHJvZCcgPyAnaW5mbycgOiAnZGVidWcnLFxuICAgICAgICBQQVJBTUVURVJfU1RPUkVfUFJFRklYOiBgLyR7cHJlZml4fWAsXG4gICAgICB9LFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgbWluaWZ5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnLFxuICAgICAgICBzb3VyY2VNYXA6IGVudmlyb25tZW50ICE9PSAncHJvZCcsXG4gICAgICAgIHRhcmdldDogJ2VzMjAyMicsXG4gICAgICAgIGZvcm1hdDogbGFtYmRhTm9kZWpzLk91dHB1dEZvcm1hdC5FU00sXG4gICAgICAgIG1haW5GaWVsZHM6IFsnbW9kdWxlJywgJ21haW4nXSxcbiAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXG4gICAgICAgICAgJ0Bhd3Mtc2RrLyonLCAvLyBVc2UgTGFtYmRhIHJ1bnRpbWUncyBBV1MgU0RLXG4gICAgICAgICAgJ3BnLW5hdGl2ZScsIC8vIE5hdGl2ZSBtb2R1bGUgbm90IG5lZWRlZFxuICAgICAgICBdLFxuICAgICAgICBub2RlTW9kdWxlczogW1xuICAgICAgICAgICdAcHJpc21hL2NsaWVudCcsXG4gICAgICAgICAgJ2Zhc3RpZnknLFxuICAgICAgICAgICdvcGVuYWknLFxuICAgICAgICBdLFxuICAgICAgICBjb21tYW5kSG9va3M6IHtcbiAgICAgICAgICBiZWZvcmVCdW5kbGluZyhpbnB1dERpcjogc3RyaW5nLCBvdXRwdXREaXI6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICAgICAgICAgIHJldHVybiBbXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgYWZ0ZXJCdW5kbGluZyhpbnB1dERpcjogc3RyaW5nLCBvdXRwdXREaXI6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICAgICAgICAgIC8vIENvcHkgUHJpc21hIGNsaWVudFxuICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgYGNwIC1yICR7aW5wdXREaXJ9L25vZGVfbW9kdWxlcy8ucHJpc21hICR7b3V0cHV0RGlyfS9gLFxuICAgICAgICAgICAgICBgbWtkaXIgLXAgJHtvdXRwdXREaXJ9L25vZGVfbW9kdWxlcy9AcHJpc21hL2AsXG4gICAgICAgICAgICAgIGBjcCAtciAke2lucHV0RGlyfS9ub2RlX21vZHVsZXMvQHByaXNtYS9jbGllbnQgJHtvdXRwdXREaXJ9L25vZGVfbW9kdWxlcy9AcHJpc21hL2AsXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICBiZWZvcmVJbnN0YWxsKGlucHV0RGlyOiBzdHJpbmcsIG91dHB1dERpcjogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgICAgICAgICAgcmV0dXJuIFtdXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZUVuYWJsZWQ6IHRydWUsXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHVuZGVmaW5lZCwgLy8gV2lsbCBiZSBjcmVhdGVkIGF1dG9tYXRpY2FsbHlcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IFN0b3JlIExhbWJkYSBBUk4gaW4gUGFyYW1ldGVyIFN0b3JlID09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ0xhbWJkYUFyblBhcmFtZXRlcicsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAvJHtwcmVmaXh9L2xhbWJkYS9ldmVudGJyaWRnZS1oYW5kbGVyLWFybmAsXG4gICAgICBzdHJpbmdWYWx1ZTogdGhpcy5tYWluTGFtYmRhRnVuY3Rpb24uZnVuY3Rpb25Bcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgbWFpbiBFdmVudEJyaWRnZSBoYW5kbGVyIExhbWJkYSBmdW5jdGlvbicsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBPdXRwdXRzID09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xhbWJkYUZ1bmN0aW9uQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMubWFpbkxhbWJkYUZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIEV2ZW50QnJpZGdlIGhhbmRsZXIgTGFtYmRhIGZ1bmN0aW9uJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3ByZWZpeH0tbGFtYmRhLWFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGFtYmRhRnVuY3Rpb25OYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMubWFpbkxhbWJkYUZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTmFtZSBvZiB0aGUgRXZlbnRCcmlkZ2UgaGFuZGxlciBMYW1iZGEgZnVuY3Rpb24nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7cHJlZml4fS1sYW1iZGEtbmFtZWAsXG4gICAgfSk7XG4gIH1cbn0iXX0=