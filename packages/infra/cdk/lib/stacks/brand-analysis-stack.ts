import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as dashboards from 'aws-cdk-lib/aws-cloudwatch';
import { NagSuppressions } from 'cdk-nag';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface BrandAnalysisStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
}

export class BrandAnalysisStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BrandAnalysisStackProps) {
    super(scope, id, props);
    const { environment } = props;
    const prefix = `postolio-${environment}-brand-analysis`;

    // Optional VPC import (for RDS Proxy connectivity)
    let vpc: ec2.IVpc | undefined;
    let lambdaSecurityGroup: ec2.ISecurityGroup | undefined;
    try {
      const vpcId = ssm.StringParameter.valueFromLookup(this, `/postolio/${environment}/vpc/id`);
      const lambdaSgId = ssm.StringParameter.valueFromLookup(
        this,
        `/postolio/${environment}/security-groups/lambda`
      );
      if (vpcId && lambdaSgId) {
        vpc = ec2.Vpc.fromLookup(this, 'FoundationVpc', { vpcId });
        lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
          this,
          'LambdaSecurityGroup',
          lambdaSgId
        );
      }
    } catch {}

    // Tables
    const profilesTable = new dynamodb.Table(this, 'ProfilesTable', {
      tableName: `${prefix}-profiles`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const jobsTable = new dynamodb.Table(this, 'JobsTable', {
      tableName: `${prefix}-jobs`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    jobsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'brandId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'requestedAt', type: dynamodb.AttributeType.STRING },
    });

    // Event bus (reuse Scheduling bus)
    const schedulingEventBusNameParam = ssm.StringParameter.fromStringParameterName(
      this,
      'SchedulingEventBusNameParam',
      `/postolio/${environment}/scheduling/event-bus-name`
    );
    const eventBus = events.EventBus.fromEventBusName(
      this,
      'SchedulingEventBus',
      schedulingEventBusNameParam.stringValue
    );

    // Lambda
    const lambdaRole = new iam.Role(this, 'BrandAnalysisLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
        resources: [profilesTable.tableArn, jobsTable.tableArn, `${jobsTable.tableArn}/index/GSI1`],
      })
    );
    // Scope EventBridge PutEvents to specific bus
    const eventBusArn = cdk.Stack.of(this).formatArn({
      service: 'events',
      resource: 'event-bus',
      resourceName: schedulingEventBusNameParam.stringValue,
    });
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [eventBusArn],
      })
    );

    const openaiApiKey =
      (this.node.tryGetContext('openaiApiKey') as string | undefined) || undefined;

    const fn = new lambdaNodejs.NodejsFunction(this, 'BrandAnalysisFunction', {
      functionName: `${prefix}-service`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../../../services/brand-analysis/src/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: lambdaRole,
      bundling: {
        externalModules: ['@aws-sdk/*'],
        nodeModules: [
          '@aws-lambda-powertools/logger',
          '@aws-lambda-powertools/metrics',
          '@aws-lambda-powertools/tracer',
        ],
      },
      logGroup: logs.LogGroup.fromLogGroupName(
        this,
        'BrandAnalysisLogGroup',
        `/aws/lambda/${prefix}-service`
      ),
      vpc,
      securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'brand-analysis',
        BRAND_STYLE_PROFILES_TABLE: profilesTable.tableName,
        BRAND_ANALYSIS_JOBS_TABLE: jobsTable.tableName,
        EVENT_BUS_NAME: schedulingEventBusNameParam.stringValue,
        ...(openaiApiKey ? { OPENAI_API_KEY: openaiApiKey } : {}),
        // Default models (override via env if needed)
        LLM_DEFAULT_MODEL: 'gpt-4o-mini',
        BRAND_ANALYSIS_VISION_MODEL: 'gpt-4o-mini',
        BRAND_ANALYSIS_DEBUG: 'true',
        // LLM tuning knobs (non-sensitive)
        BRAND_ANALYSIS_LLM_TIMEOUT_MS: '30000',
        BRAND_ANALYSIS_LLM_MAX_RETRIES: '3',
        BRAND_ANALYSIS_LLM_MAX_CONCURRENT: '2',
        BRAND_ANALYSIS_LLM_MIN_INTERVAL_MS: '100',
      },
    });

    new events.Rule(this, 'BrandAnalysisRequestedRule', {
      eventBus: eventBus,
      eventPattern: {
        source: ['postolio.brand'],
        detailType: ['brand.analysis.requested'],
      },
      targets: [new targets.LambdaFunction(fn)],
    });

    // ==================== Projection Lambda ====================
    const projectionRole = new iam.Role(this, 'BrandAnalysisProjectionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        ProjectionPolicy: new iam.PolicyDocument({
          statements: [
            // Read profiles from Dynamo (no index required for PK+SK queries)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
              resources: [profilesTable.tableArn],
            }),
            // SSM to read DB endpoints and secret ARN (scoped)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter', 'ssm:GetParameters'],
              resources: [
                cdk.Stack.of(this).formatArn({
                  service: 'ssm',
                  resource: 'parameter',
                  resourceName: `/postolio/${environment}/database/endpoint`,
                }),
                cdk.Stack.of(this).formatArn({
                  service: 'ssm',
                  resource: 'parameter',
                  resourceName: `/postolio/${environment}/database/proxy-endpoint`,
                }),
                cdk.Stack.of(this).formatArn({
                  service: 'ssm',
                  resource: 'parameter',
                  resourceName: `/postolio/${environment}/database/secret-arn`,
                }),
              ],
            }),
            // Secrets Manager to read DB credentials (parameter value fetched at deploy-time)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [
                ssm.StringParameter.valueForStringParameter(
                  this,
                  `/postolio/${environment}/database/secret-arn`
                ),
              ],
            }),
          ],
        }),
      },
    });

    // DLQ for projection failures
    const projectionDlq = new cdk.aws_sqs.Queue(this, 'ProjectionDLQ', {
      queueName: `${prefix}-projection-dlq`,
      encryption: cdk.aws_sqs.QueueEncryption.KMS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.minutes(5),
    });
    projectionDlq.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sqs:*'],
        resources: [projectionDlq.queueArn],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } },
      })
    );

    const projectionFunction = new lambdaNodejs.NodejsFunction(
      this,
      'BrandAnalysisProjectionFunction',
      {
        functionName: `${prefix}-projection`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        entry: path.join(__dirname, '../../../../services/brand-analysis-projection/src/index.ts'),
        timeout: cdk.Duration.minutes(2),
        memorySize: 512,
        role: projectionRole,
        bundling: {
          nodeModules: ['pg', '@prisma/adapter-pg'],
          commandHooks: {
            beforeBundling(): string[] {
              return [];
            },
            beforeInstall(): string[] {
              return [];
            },
            afterBundling(inputDir: string, outputDir: string): string[] {
              const dbLambdaClientPath = 'packages/libs/database/lambda-client';
              return [
                `mkdir -p ${outputDir}/lambda-client`,
                `cp -vr ${inputDir}/${dbLambdaClientPath}/. ${outputDir}/lambda-client/ 2>/dev/null || true`,
              ];
            },
          },
        },
        logGroup: logs.LogGroup.fromLogGroupName(
          this,
          'BrandAnalysisProjectionLogGroup',
          `/aws/lambda/${prefix}-projection`
        ),
        vpc,
        securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
        environment: {
          NODE_ENV: environment,
          SERVICE_NAME: 'brand-analysis-projection',
          ENVIRONMENT: environment,
          BRAND_STYLE_PROFILES_TABLE: profilesTable.tableName,
        },
      }
    );

    const projectionRule = new events.Rule(this, 'BrandAnalysisCompletedProjectionRule', {
      eventBus: eventBus,
      eventPattern: {
        source: ['postolio.brand'],
        detailType: ['brand.analysis.completed'],
      },
      targets: [
        new targets.LambdaFunction(projectionFunction, {
          deadLetterQueue: projectionDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // ==================== CloudWatch Monitoring ====================
    const alertTopic = new sns.Topic(this, 'BrandAnalysisAlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: `Brand Analysis Alerts - ${environment}`,
    });

    const functions = [
      { func: fn, name: 'brand-analysis' },
      { func: projectionFunction, name: 'brand-analysis-projection' },
    ];
    functions.forEach(({ func, name }) => {
      const errorMetric = func.metricErrors({ period: cdk.Duration.minutes(5) });
      const errorAlarm = new cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
        alarmName: `${prefix}-${name}-errors`,
        metric: errorMetric,
        threshold: 5,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${name} service error rate too high`,
      });
      errorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));
    });

    const dlqAlarm = new cloudwatch.Alarm(this, 'ProjectionDLQDepth', {
      alarmName: `${prefix}-projection-dlq-depth`,
      metric: projectionDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Projection DLQ accumulating messages',
    });
    dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // Enforce SSL for SNS topic publishing
    alertTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [alertTopic.topicArn],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } },
      })
    );

    // ==================== Dashboard ====================
    const dashboard = new dashboards.Dashboard(this, 'BrandAnalysisDashboard', {
      dashboardName: `${prefix}-dashboard`,
    });
    dashboard.addWidgets(
      new dashboards.GraphWidget({
        title: 'Brand Analysis Errors',
        left: [fn.metricErrors({ period: cdk.Duration.minutes(5) })],
        width: 12,
      }),
      new dashboards.GraphWidget({
        title: 'Projection Errors',
        left: [projectionFunction.metricErrors({ period: cdk.Duration.minutes(5) })],
        width: 12,
      }),
      new dashboards.GraphWidget({
        title: 'DLQ Visible Messages',
        left: [
          projectionDlq.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 24,
      })
    );
    // ============ CDK Nag Suppressions ============
    // BrandAnalysisLambdaRole and projection role managed policies acceptable for logging
    NagSuppressions.addResourceSuppressions(
      lambdaRole,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'AWSLambdaBasicExecutionRole acceptable for Lambda execution; no sensitive permissions',
        },
      ],
      true
    );
    NagSuppressions.addResourceSuppressions(
      projectionRole,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'AWSLambdaBasicExecutionRole acceptable for Lambda execution; logs only',
        },
      ],
      true
    );
    NagSuppressions.addResourceSuppressions(projectionDlq, [
      {
        id: 'AwsSolutions-SQS3',
        reason: 'Queue is a DLQ target from EventBridge rule; not intended to have its own DLQ',
      },
    ]);
    NagSuppressions.addResourceSuppressions(alertTopic, [
      {
        id: 'AwsSolutions-SNS3',
        reason: 'SSL-only policy applied explicitly to the topic',
      },
    ]);

    // Expose table names via SSM parameters
    new ssm.StringParameter(this, 'ProfilesTableParam', {
      parameterName: `/postolio/${environment}/brand-analysis/profiles-table`,
      stringValue: profilesTable.tableName,
    });
    new ssm.StringParameter(this, 'JobsTableParam', {
      parameterName: `/postolio/${environment}/brand-analysis/jobs-table`,
      stringValue: jobsTable.tableName,
    });

    // ==================== Weekly Scheduler ====================
    const schedulerRole = new iam.Role(this, 'BrandAnalysisSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });
    // Allow read brands via RDS Proxy (SSM + Secrets) and query jobs table; put events
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query'],
        resources: [jobsTable.tableArn, `${jobsTable.tableArn}/index/GSI1`],
      })
    );
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [eventBusArn],
      })
    );
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: `/postolio/${environment}/database/proxy-endpoint`,
          }),
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: `/postolio/${environment}/database/secret-arn`,
          }),
        ],
      })
    );
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          ssm.StringParameter.valueForStringParameter(
            this,
            `/postolio/${environment}/database/secret-arn`
          ),
        ],
      })
    );

    const schedulerFn = new lambdaNodejs.NodejsFunction(this, 'BrandAnalysisSchedulerFunction', {
      functionName: `${prefix}-scheduler`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/brand-analysis-scheduler/src/index.ts'),
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      role: schedulerRole,
      bundling: {
        commandHooks: {
          beforeBundling(): string[] {
            return [];
          },
          beforeInstall(): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            const dbLambdaClientPath = 'packages/libs/database/lambda-client';
            return [
              `mkdir -p ${outputDir}/lambda-client`,
              `cp -vr ${inputDir}/${dbLambdaClientPath}/. ${outputDir}/lambda-client/ 2>/dev/null || true`,
            ];
          },
        },
      },
      vpc,
      securityGroups: lambdaSecurityGroup ? [lambdaSecurityGroup] : undefined,
      environment: {
        NODE_ENV: environment,
        ENVIRONMENT: environment,
        SERVICE_NAME: 'brand-analysis-scheduler',
        EVENT_BUS_NAME: schedulingEventBusNameParam.stringValue,
        BRAND_ANALYSIS_JOBS_TABLE: jobsTable.tableName,
        BRAND_ANALYSIS_SCHEDULE_DEBOUNCE_MS: (6 * 24 * 60 * 60 * 1000).toString(),
      },
    });

    new events.Rule(this, 'BrandAnalysisWeeklyScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.days(7)),
      targets: [new targets.LambdaFunction(schedulerFn)],
    });

    // ==================== CDK-Nag Suppressions ====================
    // Allow AWS managed basic execution policy for Lambda roles (logs only)
    NagSuppressions.addResourceSuppressions(
      schedulerRole,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'AWSLambdaBasicExecutionRole acceptable for Lambda execution; logs only',
        },
      ],
      true
    );
  }
}
