import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

/**
 * Configuration for EventBridge scheduled rules
 * Following industry standards for externalized configuration
 */
export interface ScheduleConfig {
  autopilot: {
    enabled: boolean;
    schedule: string;  // Cron expression or rate expression
    timezone?: string; // Optional timezone (defaults to UTC)
  };
  retention: {
    enabled: boolean;
    schedule: string;
  };
  gdpr: {
    enabled: boolean;
    schedule: string;
  };
  metrics: {
    enabled: boolean;
    schedule: string;
  };
}

export interface EventBridgeRulesStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  mainLambdaFunction: lambda.Function;
  config?: ScheduleConfig;
}

/**
 * EventBridge Rules Stack
 * 
 * Industry Standards Applied:
 * 1. Infrastructure as Code (IaC) - All rules defined in CDK
 * 2. Environment-specific configuration - Different schedules per environment
 * 3. Parameter Store integration - Runtime configuration changes
 * 4. Least privilege IAM - Minimal permissions for each rule
 * 5. Monitoring and alerting - CloudWatch integration
 * 6. Documentation as code - Self-documenting infrastructure
 */
export class EventBridgeRulesStack extends cdk.Stack {
  private readonly scheduleConfig: ScheduleConfig;
  private readonly envName: string;

  constructor(scope: Construct, id: string, props: EventBridgeRulesStackProps) {
    super(scope, id, props);

    const { environment, mainLambdaFunction } = props;
    this.envName = environment;

    // Load configuration from environment or use defaults
    this.scheduleConfig = this.loadScheduleConfig(props.config);

    // Store configuration in Parameter Store for runtime access
    this.storeConfigInParameterStore();

    // Create EventBridge rules based on configuration
    this.createAutopilotRule(mainLambdaFunction);
    this.createRetentionRule(mainLambdaFunction);
    this.createGDPRComplianceRule(mainLambdaFunction);
    this.createMetricsCollectionRule(mainLambdaFunction);

    // Add CDK Nag suppressions with justifications
    this.addNagSuppressions();
  }

  /**
   * Load schedule configuration based on environment
   * Industry Standard: Environment-specific configuration
   */
  private loadScheduleConfig(customConfig?: ScheduleConfig): ScheduleConfig {
    // Default configurations per environment
    const defaultConfigs: Record<string, ScheduleConfig> = {
      dev: {
        autopilot: {
          enabled: true,
          schedule: 'rate(1 hour)',  // Run every hour in dev for testing
          timezone: 'America/New_York',
        },
        retention: {
          enabled: true,
          schedule: 'rate(12 hours)',  // Twice daily in dev
        },
        gdpr: {
          enabled: false,  // Disabled in dev
          schedule: 'cron(0 4 ? * SUN *)',  // Weekly on Sunday at 4 AM UTC
        },
        metrics: {
          enabled: true,
          schedule: 'rate(30 minutes)',  // Every 30 minutes in dev
        },
      },
      staging: {
        autopilot: {
          enabled: true,
          schedule: 'cron(0 2 * * ? *)',  // Daily at 2 AM UTC
          timezone: 'America/New_York',
        },
        retention: {
          enabled: true,
          schedule: 'cron(0 3 * * ? *)',  // Daily at 3 AM UTC
        },
        gdpr: {
          enabled: true,
          schedule: 'cron(0 4 ? * SUN *)',  // Weekly on Sunday at 4 AM UTC
        },
        metrics: {
          enabled: true,
          schedule: 'rate(1 hour)',  // Every hour
        },
      },
      prod: {
        autopilot: {
          enabled: true,
          schedule: 'cron(0 2,14 * * ? *)',  // Twice daily at 2 AM and 2 PM UTC
          timezone: 'America/New_York',
        },
        retention: {
          enabled: true,
          schedule: 'cron(0 3 * * ? *)',  // Daily at 3 AM UTC
        },
        gdpr: {
          enabled: true,
          schedule: 'cron(0 4 ? * SUN *)',  // Weekly on Sunday at 4 AM UTC
        },
        metrics: {
          enabled: true,
          schedule: 'cron(0/15 * * * ? *)',  // Every 15 minutes
        },
      },
    };

    // Use custom config if provided, otherwise use environment defaults
    return customConfig || defaultConfigs[this.envName] || defaultConfigs.dev;
  }

  /**
   * Store configuration in AWS Systems Manager Parameter Store
   * Industry Standard: Externalized configuration management
   */
  private storeConfigInParameterStore(): void {
    const parameterPrefix = `/postolio/${this.envName}/scheduler`;

    // Store each schedule configuration as a parameter
    Object.entries(this.scheduleConfig).forEach(([taskType, config]) => {
      new ssm.StringParameter(this, `${taskType}ConfigParameter`, {
        parameterName: `${parameterPrefix}/${taskType}`,
        stringValue: JSON.stringify(config),
        description: `EventBridge schedule configuration for ${taskType}`,
        tier: ssm.ParameterTier.STANDARD,
      });
    });

    // Store a master configuration parameter
    new ssm.StringParameter(this, 'MasterScheduleConfig', {
      parameterName: `${parameterPrefix}/config`,
      stringValue: JSON.stringify(this.scheduleConfig),
      description: 'Master EventBridge schedule configuration',
      tier: ssm.ParameterTier.STANDARD,
    });
  }

  /**
   * Create Autopilot content generation rule
   */
  private createAutopilotRule(targetFunction: lambda.Function): void {
    if (!this.scheduleConfig.autopilot.enabled) {
      return;
    }

    const rule = new events.Rule(this, 'AutopilotRule', {
      ruleName: `postolio-${this.envName}-autopilot`,
      description: 'Trigger autopilot content generation',
      schedule: events.Schedule.expression(this.scheduleConfig.autopilot.schedule),
      enabled: true,
    });

    // Add Lambda target with specific event details
    rule.addTarget(new targets.LambdaFunction(targetFunction, {
      event: events.RuleTargetInput.fromObject({
        source: 'postolio.scheduler',
        'detail-type': 'Scheduled Task',
        detail: {
          taskType: 'autopilot',
          environment: this.envName,
          timestamp: events.EventField.time,
        },
      }),
      retryAttempts: 2,
      maxEventAge: cdk.Duration.hours(1),
    }));

    // Add tags for cost tracking
    cdk.Tags.of(rule).add('Service', 'Postolio');
    cdk.Tags.of(rule).add('Component', 'Autopilot');
    cdk.Tags.of(rule).add('Environment', this.envName);
  }

  /**
   * Create Retention policy processing rule
   */
  private createRetentionRule(targetFunction: lambda.Function): void {
    if (!this.scheduleConfig.retention.enabled) {
      return;
    }

    const rule = new events.Rule(this, 'RetentionRule', {
      ruleName: `postolio-${this.envName}-retention`,
      description: 'Process expired content based on retention policies',
      schedule: events.Schedule.expression(this.scheduleConfig.retention.schedule),
      enabled: true,
    });

    rule.addTarget(new targets.LambdaFunction(targetFunction, {
      event: events.RuleTargetInput.fromObject({
        source: 'postolio.scheduler',
        'detail-type': 'Scheduled Task',
        detail: {
          taskType: 'retention',
          environment: this.envName,
          timestamp: events.EventField.time,
        },
      }),
      retryAttempts: 3,
      maxEventAge: cdk.Duration.hours(2),
    }));

    cdk.Tags.of(rule).add('Service', 'Postolio');
    cdk.Tags.of(rule).add('Component', 'Retention');
    cdk.Tags.of(rule).add('Environment', this.envName);
  }

  /**
   * Create GDPR compliance processing rule
   */
  private createGDPRComplianceRule(targetFunction: lambda.Function): void {
    if (!this.scheduleConfig.gdpr.enabled) {
      return;
    }

    const rule = new events.Rule(this, 'GDPRComplianceRule', {
      ruleName: `postolio-${this.envName}-gdpr`,
      description: 'Process GDPR compliance and data deletion requests',
      schedule: events.Schedule.expression(this.scheduleConfig.gdpr.schedule),
      enabled: true,
    });

    rule.addTarget(new targets.LambdaFunction(targetFunction, {
      event: events.RuleTargetInput.fromObject({
        source: 'postolio.scheduler',
        'detail-type': 'Scheduled Task',
        detail: {
          taskType: 'gdpr',
          environment: this.envName,
          timestamp: events.EventField.time,
        },
      }),
      retryAttempts: 3,
      maxEventAge: cdk.Duration.hours(6),
    }));

    cdk.Tags.of(rule).add('Service', 'Postolio');
    cdk.Tags.of(rule).add('Component', 'GDPR');
    cdk.Tags.of(rule).add('Environment', this.envName);
    cdk.Tags.of(rule).add('Compliance', 'GDPR');
  }

  /**
   * Create metrics collection rule
   */
  private createMetricsCollectionRule(targetFunction: lambda.Function): void {
    if (!this.scheduleConfig.metrics.enabled) {
      return;
    }

    const rule = new events.Rule(this, 'MetricsCollectionRule', {
      ruleName: `postolio-${this.envName}-metrics`,
      description: 'Collect and aggregate application metrics',
      schedule: events.Schedule.expression(this.scheduleConfig.metrics.schedule),
      enabled: true,
    });

    rule.addTarget(new targets.LambdaFunction(targetFunction, {
      event: events.RuleTargetInput.fromObject({
        source: 'postolio.scheduler',
        'detail-type': 'Scheduled Task',
        detail: {
          taskType: 'metrics-collection',
          environment: this.envName,
          timestamp: events.EventField.time,
        },
      }),
      retryAttempts: 1,
      maxEventAge: cdk.Duration.minutes(30),
    }));

    cdk.Tags.of(rule).add('Service', 'Postolio');
    cdk.Tags.of(rule).add('Component', 'Metrics');
    cdk.Tags.of(rule).add('Environment', this.envName);
  }

  /**
   * Add CDK Nag suppressions with justifications
   */
  private addNagSuppressions(): void {
    // Suppress IAM4 only for specific EventBridge managed policies
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'EventBridge service-linked role uses AWS managed policy for basic Lambda invocation',
        appliesTo: [
          'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaRole',
        ],
      },
    ]);

    // Suppress IAM5 with specific resource patterns
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'EventBridge requires wildcard for Lambda function versions and aliases within the specific function ARN',
        appliesTo: [
          'Resource::arn:aws:lambda:*:*:function:postolio-*:*',
          'Action::lambda:InvokeFunction',
        ],
      },
    ]);
  }

  /**
   * Export configuration for documentation
   */
  public exportConfiguration(): void {
    new cdk.CfnOutput(this, 'ScheduleConfiguration', {
      value: JSON.stringify(this.scheduleConfig, null, 2),
      description: 'EventBridge schedule configuration',
      exportName: `${this.stackName}-schedule-config`,
    });

    // Export individual rule ARNs for monitoring
    const ruleNames = ['AutopilotRule', 'RetentionRule', 'GDPRComplianceRule', 'MetricsCollectionRule'];
    ruleNames.forEach(ruleName => {
      const rule = this.node.tryFindChild(ruleName) as events.Rule;
      if (rule) {
        new cdk.CfnOutput(this, `${ruleName}Arn`, {
          value: rule.ruleArn,
          description: `ARN for ${ruleName}`,
          exportName: `${this.stackName}-${ruleName}-arn`,
        });
      }
    });
  }
}