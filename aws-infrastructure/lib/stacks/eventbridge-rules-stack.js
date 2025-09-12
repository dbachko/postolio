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
exports.EventBridgeRulesStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
const cdk_nag_1 = require("cdk-nag");
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
class EventBridgeRulesStack extends cdk.Stack {
    scheduleConfig;
    envName;
    constructor(scope, id, props) {
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
    loadScheduleConfig(customConfig) {
        // Default configurations per environment
        const defaultConfigs = {
            dev: {
                autopilot: {
                    enabled: true,
                    schedule: 'rate(1 hour)', // Run every hour in dev for testing
                    timezone: 'America/New_York',
                },
                retention: {
                    enabled: true,
                    schedule: 'rate(12 hours)', // Twice daily in dev
                },
                gdpr: {
                    enabled: false, // Disabled in dev
                    schedule: 'cron(0 4 ? * SUN *)', // Weekly on Sunday at 4 AM UTC
                },
                metrics: {
                    enabled: true,
                    schedule: 'rate(30 minutes)', // Every 30 minutes in dev
                },
            },
            staging: {
                autopilot: {
                    enabled: true,
                    schedule: 'cron(0 2 * * ? *)', // Daily at 2 AM UTC
                    timezone: 'America/New_York',
                },
                retention: {
                    enabled: true,
                    schedule: 'cron(0 3 * * ? *)', // Daily at 3 AM UTC
                },
                gdpr: {
                    enabled: true,
                    schedule: 'cron(0 4 ? * SUN *)', // Weekly on Sunday at 4 AM UTC
                },
                metrics: {
                    enabled: true,
                    schedule: 'rate(1 hour)', // Every hour
                },
            },
            prod: {
                autopilot: {
                    enabled: true,
                    schedule: 'cron(0 2,14 * * ? *)', // Twice daily at 2 AM and 2 PM UTC
                    timezone: 'America/New_York',
                },
                retention: {
                    enabled: true,
                    schedule: 'cron(0 3 * * ? *)', // Daily at 3 AM UTC
                },
                gdpr: {
                    enabled: true,
                    schedule: 'cron(0 4 ? * SUN *)', // Weekly on Sunday at 4 AM UTC
                },
                metrics: {
                    enabled: true,
                    schedule: 'cron(0/15 * * * ? *)', // Every 15 minutes
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
    storeConfigInParameterStore() {
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
    createAutopilotRule(targetFunction) {
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
    createRetentionRule(targetFunction) {
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
    createGDPRComplianceRule(targetFunction) {
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
    createMetricsCollectionRule(targetFunction) {
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
    addNagSuppressions() {
        // Suppress IAM4 only for specific EventBridge managed policies
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'EventBridge service-linked role uses AWS managed policy for basic Lambda invocation',
                appliesTo: [
                    'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaRole',
                ],
            },
        ]);
        // Suppress IAM5 with specific resource patterns
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
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
    exportConfiguration() {
        new cdk.CfnOutput(this, 'ScheduleConfiguration', {
            value: JSON.stringify(this.scheduleConfig, null, 2),
            description: 'EventBridge schedule configuration',
            exportName: `${this.stackName}-schedule-config`,
        });
        // Export individual rule ARNs for monitoring
        const ruleNames = ['AutopilotRule', 'RetentionRule', 'GDPRComplianceRule', 'MetricsCollectionRule'];
        ruleNames.forEach(ruleName => {
            const rule = this.node.tryFindChild(ruleName);
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
exports.EventBridgeRulesStack = EventBridgeRulesStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXZlbnRicmlkZ2UtcnVsZXMtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJldmVudGJyaWRnZS1ydWxlcy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsK0RBQWlEO0FBQ2pELHdFQUEwRDtBQUcxRCx5REFBMkM7QUFFM0MscUNBQTBDO0FBZ0MxQzs7Ozs7Ozs7OztHQVVHO0FBQ0gsTUFBYSxxQkFBc0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNqQyxjQUFjLENBQWlCO0lBQy9CLE9BQU8sQ0FBUztJQUVqQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWlDO1FBQ3pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxXQUFXLEVBQUUsa0JBQWtCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFDbEQsSUFBSSxDQUFDLE9BQU8sR0FBRyxXQUFXLENBQUM7UUFFM0Isc0RBQXNEO1FBQ3RELElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUU1RCw0REFBNEQ7UUFDNUQsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUM7UUFFbkMsa0RBQWtEO1FBQ2xELElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBQzdDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBQzdDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBQ2xELElBQUksQ0FBQywyQkFBMkIsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBRXJELCtDQUErQztRQUMvQyxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztJQUM1QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0ssa0JB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QUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF4VEQsc0RBd1RDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgRXZlbnRCcmlkZ2Ugc2NoZWR1bGVkIHJ1bGVzXG4gKiBGb2xsb3dpbmcgaW5kdXN0cnkgc3RhbmRhcmRzIGZvciBleHRlcm5hbGl6ZWQgY29uZmlndXJhdGlvblxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNjaGVkdWxlQ29uZmlnIHtcbiAgYXV0b3BpbG90OiB7XG4gICAgZW5hYmxlZDogYm9vbGVhbjtcbiAgICBzY2hlZHVsZTogc3RyaW5nOyAgLy8gQ3JvbiBleHByZXNzaW9uIG9yIHJhdGUgZXhwcmVzc2lvblxuICAgIHRpbWV6b25lPzogc3RyaW5nOyAvLyBPcHRpb25hbCB0aW1lem9uZSAoZGVmYXVsdHMgdG8gVVRDKVxuICB9O1xuICByZXRlbnRpb246IHtcbiAgICBlbmFibGVkOiBib29sZWFuO1xuICAgIHNjaGVkdWxlOiBzdHJpbmc7XG4gIH07XG4gIGdkcHI6IHtcbiAgICBlbmFibGVkOiBib29sZWFuO1xuICAgIHNjaGVkdWxlOiBzdHJpbmc7XG4gIH07XG4gIG1ldHJpY3M6IHtcbiAgICBlbmFibGVkOiBib29sZWFuO1xuICAgIHNjaGVkdWxlOiBzdHJpbmc7XG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXZlbnRCcmlkZ2VSdWxlc1N0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiAnZGV2JyB8ICdzdGFnaW5nJyB8ICdwcm9kJztcbiAgbWFpbkxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gIGNvbmZpZz86IFNjaGVkdWxlQ29uZmlnO1xufVxuXG4vKipcbiAqIEV2ZW50QnJpZGdlIFJ1bGVzIFN0YWNrXG4gKiBcbiAqIEluZHVzdHJ5IFN0YW5kYXJkcyBBcHBsaWVkOlxuICogMS4gSW5mcmFzdHJ1Y3R1cmUgYXMgQ29kZSAoSWFDKSAtIEFsbCBydWxlcyBkZWZpbmVkIGluIENES1xuICogMi4gRW52aXJvbm1lbnQtc3BlY2lmaWMgY29uZmlndXJhdGlvbiAtIERpZmZlcmVudCBzY2hlZHVsZXMgcGVyIGVudmlyb25tZW50XG4gKiAzLiBQYXJhbWV0ZXIgU3RvcmUgaW50ZWdyYXRpb24gLSBSdW50aW1lIGNvbmZpZ3VyYXRpb24gY2hhbmdlc1xuICogNC4gTGVhc3QgcHJpdmlsZWdlIElBTSAtIE1pbmltYWwgcGVybWlzc2lvbnMgZm9yIGVhY2ggcnVsZVxuICogNS4gTW9uaXRvcmluZyBhbmQgYWxlcnRpbmcgLSBDbG91ZFdhdGNoIGludGVncmF0aW9uXG4gKiA2LiBEb2N1bWVudGF0aW9uIGFzIGNvZGUgLSBTZWxmLWRvY3VtZW50aW5nIGluZnJhc3RydWN0dXJlXG4gKi9cbmV4cG9ydCBjbGFzcyBFdmVudEJyaWRnZVJ1bGVzU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwcml2YXRlIHJlYWRvbmx5IHNjaGVkdWxlQ29uZmlnOiBTY2hlZHVsZUNvbmZpZztcbiAgcHJpdmF0ZSByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEV2ZW50QnJpZGdlUnVsZXNTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudmlyb25tZW50LCBtYWluTGFtYmRhRnVuY3Rpb24gfSA9IHByb3BzO1xuICAgIHRoaXMuZW52TmFtZSA9IGVudmlyb25tZW50O1xuXG4gICAgLy8gTG9hZCBjb25maWd1cmF0aW9uIGZyb20gZW52aXJvbm1lbnQgb3IgdXNlIGRlZmF1bHRzXG4gICAgdGhpcy5zY2hlZHVsZUNvbmZpZyA9IHRoaXMubG9hZFNjaGVkdWxlQ29uZmlnKHByb3BzLmNvbmZpZyk7XG5cbiAgICAvLyBTdG9yZSBjb25maWd1cmF0aW9uIGluIFBhcmFtZXRlciBTdG9yZSBmb3IgcnVudGltZSBhY2Nlc3NcbiAgICB0aGlzLnN0b3JlQ29uZmlnSW5QYXJhbWV0ZXJTdG9yZSgpO1xuXG4gICAgLy8gQ3JlYXRlIEV2ZW50QnJpZGdlIHJ1bGVzIGJhc2VkIG9uIGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmNyZWF0ZUF1dG9waWxvdFJ1bGUobWFpbkxhbWJkYUZ1bmN0aW9uKTtcbiAgICB0aGlzLmNyZWF0ZVJldGVudGlvblJ1bGUobWFpbkxhbWJkYUZ1bmN0aW9uKTtcbiAgICB0aGlzLmNyZWF0ZUdEUFJDb21wbGlhbmNlUnVsZShtYWluTGFtYmRhRnVuY3Rpb24pO1xuICAgIHRoaXMuY3JlYXRlTWV0cmljc0NvbGxlY3Rpb25SdWxlKG1haW5MYW1iZGFGdW5jdGlvbik7XG5cbiAgICAvLyBBZGQgQ0RLIE5hZyBzdXBwcmVzc2lvbnMgd2l0aCBqdXN0aWZpY2F0aW9uc1xuICAgIHRoaXMuYWRkTmFnU3VwcHJlc3Npb25zKCk7XG4gIH1cblxuICAvKipcbiAgICogTG9hZCBzY2hlZHVsZSBjb25maWd1cmF0aW9uIGJhc2VkIG9uIGVudmlyb25tZW50XG4gICAqIEluZHVzdHJ5IFN0YW5kYXJkOiBFbnZpcm9ubWVudC1zcGVjaWZpYyBjb25maWd1cmF0aW9uXG4gICAqL1xuICBwcml2YXRlIGxvYWRTY2hlZHVsZUNvbmZpZyhjdXN0b21Db25maWc/OiBTY2hlZHVsZUNvbmZpZyk6IFNjaGVkdWxlQ29uZmlnIHtcbiAgICAvLyBEZWZhdWx0IGNvbmZpZ3VyYXRpb25zIHBlciBlbnZpcm9ubWVudFxuICAgIGNvbnN0IGRlZmF1bHRDb25maWdzOiBSZWNvcmQ8c3RyaW5nLCBTY2hlZHVsZUNvbmZpZz4gPSB7XG4gICAgICBkZXY6IHtcbiAgICAgICAgYXV0b3BpbG90OiB7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBzY2hlZHVsZTogJ3JhdGUoMSBob3VyKScsICAvLyBSdW4gZXZlcnkgaG91ciBpbiBkZXYgZm9yIHRlc3RpbmdcbiAgICAgICAgICB0aW1lem9uZTogJ0FtZXJpY2EvTmV3X1lvcmsnLFxuICAgICAgICB9LFxuICAgICAgICByZXRlbnRpb246IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNjaGVkdWxlOiAncmF0ZSgxMiBob3VycyknLCAgLy8gVHdpY2UgZGFpbHkgaW4gZGV2XG4gICAgICAgIH0sXG4gICAgICAgIGdkcHI6IHtcbiAgICAgICAgICBlbmFibGVkOiBmYWxzZSwgIC8vIERpc2FibGVkIGluIGRldlxuICAgICAgICAgIHNjaGVkdWxlOiAnY3JvbigwIDQgPyAqIFNVTiAqKScsICAvLyBXZWVrbHkgb24gU3VuZGF5IGF0IDQgQU0gVVRDXG4gICAgICAgIH0sXG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNjaGVkdWxlOiAncmF0ZSgzMCBtaW51dGVzKScsICAvLyBFdmVyeSAzMCBtaW51dGVzIGluIGRldlxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHN0YWdpbmc6IHtcbiAgICAgICAgYXV0b3BpbG90OiB7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBzY2hlZHVsZTogJ2Nyb24oMCAyICogKiA/ICopJywgIC8vIERhaWx5IGF0IDIgQU0gVVRDXG4gICAgICAgICAgdGltZXpvbmU6ICdBbWVyaWNhL05ld19Zb3JrJyxcbiAgICAgICAgfSxcbiAgICAgICAgcmV0ZW50aW9uOiB7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBzY2hlZHVsZTogJ2Nyb24oMCAzICogKiA/ICopJywgIC8vIERhaWx5IGF0IDMgQU0gVVRDXG4gICAgICAgIH0sXG4gICAgICAgIGdkcHI6IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNjaGVkdWxlOiAnY3JvbigwIDQgPyAqIFNVTiAqKScsICAvLyBXZWVrbHkgb24gU3VuZGF5IGF0IDQgQU0gVVRDXG4gICAgICAgIH0sXG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNjaGVkdWxlOiAncmF0ZSgxIGhvdXIpJywgIC8vIEV2ZXJ5IGhvdXJcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBwcm9kOiB7XG4gICAgICAgIGF1dG9waWxvdDoge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgc2NoZWR1bGU6ICdjcm9uKDAgMiwxNCAqICogPyAqKScsICAvLyBUd2ljZSBkYWlseSBhdCAyIEFNIGFuZCAyIFBNIFVUQ1xuICAgICAgICAgIHRpbWV6b25lOiAnQW1lcmljYS9OZXdfWW9yaycsXG4gICAgICAgIH0sXG4gICAgICAgIHJldGVudGlvbjoge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgc2NoZWR1bGU6ICdjcm9uKDAgMyAqICogPyAqKScsICAvLyBEYWlseSBhdCAzIEFNIFVUQ1xuICAgICAgICB9LFxuICAgICAgICBnZHByOiB7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBzY2hlZHVsZTogJ2Nyb24oMCA0ID8gKiBTVU4gKiknLCAgLy8gV2Vla2x5IG9uIFN1bmRheSBhdCA0IEFNIFVUQ1xuICAgICAgICB9LFxuICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBzY2hlZHVsZTogJ2Nyb24oMC8xNSAqICogKiA/ICopJywgIC8vIEV2ZXJ5IDE1IG1pbnV0ZXNcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIC8vIFVzZSBjdXN0b20gY29uZmlnIGlmIHByb3ZpZGVkLCBvdGhlcndpc2UgdXNlIGVudmlyb25tZW50IGRlZmF1bHRzXG4gICAgcmV0dXJuIGN1c3RvbUNvbmZpZyB8fCBkZWZhdWx0Q29uZmlnc1t0aGlzLmVudk5hbWVdIHx8IGRlZmF1bHRDb25maWdzLmRldjtcbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9yZSBjb25maWd1cmF0aW9uIGluIEFXUyBTeXN0ZW1zIE1hbmFnZXIgUGFyYW1ldGVyIFN0b3JlXG4gICAqIEluZHVzdHJ5IFN0YW5kYXJkOiBFeHRlcm5hbGl6ZWQgY29uZmlndXJhdGlvbiBtYW5hZ2VtZW50XG4gICAqL1xuICBwcml2YXRlIHN0b3JlQ29uZmlnSW5QYXJhbWV0ZXJTdG9yZSgpOiB2b2lkIHtcbiAgICBjb25zdCBwYXJhbWV0ZXJQcmVmaXggPSBgL3Bvc3RvbGlvLyR7dGhpcy5lbnZOYW1lfS9zY2hlZHVsZXJgO1xuXG4gICAgLy8gU3RvcmUgZWFjaCBzY2hlZHVsZSBjb25maWd1cmF0aW9uIGFzIGEgcGFyYW1ldGVyXG4gICAgT2JqZWN0LmVudHJpZXModGhpcy5zY2hlZHVsZUNvbmZpZykuZm9yRWFjaCgoW3Rhc2tUeXBlLCBjb25maWddKSA9PiB7XG4gICAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCBgJHt0YXNrVHlwZX1Db25maWdQYXJhbWV0ZXJgLCB7XG4gICAgICAgIHBhcmFtZXRlck5hbWU6IGAke3BhcmFtZXRlclByZWZpeH0vJHt0YXNrVHlwZX1gLFxuICAgICAgICBzdHJpbmdWYWx1ZTogSlNPTi5zdHJpbmdpZnkoY29uZmlnKSxcbiAgICAgICAgZGVzY3JpcHRpb246IGBFdmVudEJyaWRnZSBzY2hlZHVsZSBjb25maWd1cmF0aW9uIGZvciAke3Rhc2tUeXBlfWAsXG4gICAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBTdG9yZSBhIG1hc3RlciBjb25maWd1cmF0aW9uIHBhcmFtZXRlclxuICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdNYXN0ZXJTY2hlZHVsZUNvbmZpZycsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAke3BhcmFtZXRlclByZWZpeH0vY29uZmlnYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBKU09OLnN0cmluZ2lmeSh0aGlzLnNjaGVkdWxlQ29uZmlnKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTWFzdGVyIEV2ZW50QnJpZGdlIHNjaGVkdWxlIGNvbmZpZ3VyYXRpb24nLFxuICAgICAgdGllcjogc3NtLlBhcmFtZXRlclRpZXIuU1RBTkRBUkQsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIEF1dG9waWxvdCBjb250ZW50IGdlbmVyYXRpb24gcnVsZVxuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVBdXRvcGlsb3RSdWxlKHRhcmdldEZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb24pOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuc2NoZWR1bGVDb25maWcuYXV0b3BpbG90LmVuYWJsZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBydWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdBdXRvcGlsb3RSdWxlJywge1xuICAgICAgcnVsZU5hbWU6IGBwb3N0b2xpby0ke3RoaXMuZW52TmFtZX0tYXV0b3BpbG90YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVHJpZ2dlciBhdXRvcGlsb3QgY29udGVudCBnZW5lcmF0aW9uJyxcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuZXhwcmVzc2lvbih0aGlzLnNjaGVkdWxlQ29uZmlnLmF1dG9waWxvdC5zY2hlZHVsZSksXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIExhbWJkYSB0YXJnZXQgd2l0aCBzcGVjaWZpYyBldmVudCBkZXRhaWxzXG4gICAgcnVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24odGFyZ2V0RnVuY3Rpb24sIHtcbiAgICAgIGV2ZW50OiBldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBzb3VyY2U6ICdwb3N0b2xpby5zY2hlZHVsZXInLFxuICAgICAgICAnZGV0YWlsLXR5cGUnOiAnU2NoZWR1bGVkIFRhc2snLFxuICAgICAgICBkZXRhaWw6IHtcbiAgICAgICAgICB0YXNrVHlwZTogJ2F1dG9waWxvdCcsXG4gICAgICAgICAgZW52aXJvbm1lbnQ6IHRoaXMuZW52TmFtZSxcbiAgICAgICAgICB0aW1lc3RhbXA6IGV2ZW50cy5FdmVudEZpZWxkLnRpbWUsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIHJldHJ5QXR0ZW1wdHM6IDIsXG4gICAgICBtYXhFdmVudEFnZTogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgIH0pKTtcblxuICAgIC8vIEFkZCB0YWdzIGZvciBjb3N0IHRyYWNraW5nXG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdTZXJ2aWNlJywgJ1Bvc3RvbGlvJyk7XG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdDb21wb25lbnQnLCAnQXV0b3BpbG90Jyk7XG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdFbnZpcm9ubWVudCcsIHRoaXMuZW52TmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIFJldGVudGlvbiBwb2xpY3kgcHJvY2Vzc2luZyBydWxlXG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZVJldGVudGlvblJ1bGUodGFyZ2V0RnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbik6IHZvaWQge1xuICAgIGlmICghdGhpcy5zY2hlZHVsZUNvbmZpZy5yZXRlbnRpb24uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ1JldGVudGlvblJ1bGUnLCB7XG4gICAgICBydWxlTmFtZTogYHBvc3RvbGlvLSR7dGhpcy5lbnZOYW1lfS1yZXRlbnRpb25gLFxuICAgICAgZGVzY3JpcHRpb246ICdQcm9jZXNzIGV4cGlyZWQgY29udGVudCBiYXNlZCBvbiByZXRlbnRpb24gcG9saWNpZXMnLFxuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5leHByZXNzaW9uKHRoaXMuc2NoZWR1bGVDb25maWcucmV0ZW50aW9uLnNjaGVkdWxlKSxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICBydWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0YXJnZXRGdW5jdGlvbiwge1xuICAgICAgZXZlbnQ6IGV2ZW50cy5SdWxlVGFyZ2V0SW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIHNvdXJjZTogJ3Bvc3RvbGlvLnNjaGVkdWxlcicsXG4gICAgICAgICdkZXRhaWwtdHlwZSc6ICdTY2hlZHVsZWQgVGFzaycsXG4gICAgICAgIGRldGFpbDoge1xuICAgICAgICAgIHRhc2tUeXBlOiAncmV0ZW50aW9uJyxcbiAgICAgICAgICBlbnZpcm9ubWVudDogdGhpcy5lbnZOYW1lLFxuICAgICAgICAgIHRpbWVzdGFtcDogZXZlbnRzLkV2ZW50RmllbGQudGltZSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgcmV0cnlBdHRlbXB0czogMyxcbiAgICAgIG1heEV2ZW50QWdlOiBjZGsuRHVyYXRpb24uaG91cnMoMiksXG4gICAgfSkpO1xuXG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdTZXJ2aWNlJywgJ1Bvc3RvbGlvJyk7XG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdDb21wb25lbnQnLCAnUmV0ZW50aW9uJyk7XG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdFbnZpcm9ubWVudCcsIHRoaXMuZW52TmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIEdEUFIgY29tcGxpYW5jZSBwcm9jZXNzaW5nIHJ1bGVcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlR0RQUkNvbXBsaWFuY2VSdWxlKHRhcmdldEZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb24pOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuc2NoZWR1bGVDb25maWcuZ2Rwci5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnR0RQUkNvbXBsaWFuY2VSdWxlJywge1xuICAgICAgcnVsZU5hbWU6IGBwb3N0b2xpby0ke3RoaXMuZW52TmFtZX0tZ2RwcmAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1Byb2Nlc3MgR0RQUiBjb21wbGlhbmNlIGFuZCBkYXRhIGRlbGV0aW9uIHJlcXVlc3RzJyxcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuZXhwcmVzc2lvbih0aGlzLnNjaGVkdWxlQ29uZmlnLmdkcHIuc2NoZWR1bGUpLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIHJ1bGUuYWRkVGFyZ2V0KG5ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRhcmdldEZ1bmN0aW9uLCB7XG4gICAgICBldmVudDogZXZlbnRzLlJ1bGVUYXJnZXRJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgc291cmNlOiAncG9zdG9saW8uc2NoZWR1bGVyJyxcbiAgICAgICAgJ2RldGFpbC10eXBlJzogJ1NjaGVkdWxlZCBUYXNrJyxcbiAgICAgICAgZGV0YWlsOiB7XG4gICAgICAgICAgdGFza1R5cGU6ICdnZHByJyxcbiAgICAgICAgICBlbnZpcm9ubWVudDogdGhpcy5lbnZOYW1lLFxuICAgICAgICAgIHRpbWVzdGFtcDogZXZlbnRzLkV2ZW50RmllbGQudGltZSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgcmV0cnlBdHRlbXB0czogMyxcbiAgICAgIG1heEV2ZW50QWdlOiBjZGsuRHVyYXRpb24uaG91cnMoNiksXG4gICAgfSkpO1xuXG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdTZXJ2aWNlJywgJ1Bvc3RvbGlvJyk7XG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdDb21wb25lbnQnLCAnR0RQUicpO1xuICAgIGNkay5UYWdzLm9mKHJ1bGUpLmFkZCgnRW52aXJvbm1lbnQnLCB0aGlzLmVudk5hbWUpO1xuICAgIGNkay5UYWdzLm9mKHJ1bGUpLmFkZCgnQ29tcGxpYW5jZScsICdHRFBSJyk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIG1ldHJpY3MgY29sbGVjdGlvbiBydWxlXG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZU1ldHJpY3NDb2xsZWN0aW9uUnVsZSh0YXJnZXRGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLnNjaGVkdWxlQ29uZmlnLm1ldHJpY3MuZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ01ldHJpY3NDb2xsZWN0aW9uUnVsZScsIHtcbiAgICAgIHJ1bGVOYW1lOiBgcG9zdG9saW8tJHt0aGlzLmVudk5hbWV9LW1ldHJpY3NgLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2xsZWN0IGFuZCBhZ2dyZWdhdGUgYXBwbGljYXRpb24gbWV0cmljcycsXG4gICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLmV4cHJlc3Npb24odGhpcy5zY2hlZHVsZUNvbmZpZy5tZXRyaWNzLnNjaGVkdWxlKSxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICBydWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0YXJnZXRGdW5jdGlvbiwge1xuICAgICAgZXZlbnQ6IGV2ZW50cy5SdWxlVGFyZ2V0SW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIHNvdXJjZTogJ3Bvc3RvbGlvLnNjaGVkdWxlcicsXG4gICAgICAgICdkZXRhaWwtdHlwZSc6ICdTY2hlZHVsZWQgVGFzaycsXG4gICAgICAgIGRldGFpbDoge1xuICAgICAgICAgIHRhc2tUeXBlOiAnbWV0cmljcy1jb2xsZWN0aW9uJyxcbiAgICAgICAgICBlbnZpcm9ubWVudDogdGhpcy5lbnZOYW1lLFxuICAgICAgICAgIHRpbWVzdGFtcDogZXZlbnRzLkV2ZW50RmllbGQudGltZSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgcmV0cnlBdHRlbXB0czogMSxcbiAgICAgIG1heEV2ZW50QWdlOiBjZGsuRHVyYXRpb24ubWludXRlcygzMCksXG4gICAgfSkpO1xuXG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdTZXJ2aWNlJywgJ1Bvc3RvbGlvJyk7XG4gICAgY2RrLlRhZ3Mub2YocnVsZSkuYWRkKCdDb21wb25lbnQnLCAnTWV0cmljcycpO1xuICAgIGNkay5UYWdzLm9mKHJ1bGUpLmFkZCgnRW52aXJvbm1lbnQnLCB0aGlzLmVudk5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBDREsgTmFnIHN1cHByZXNzaW9ucyB3aXRoIGp1c3RpZmljYXRpb25zXG4gICAqL1xuICBwcml2YXRlIGFkZE5hZ1N1cHByZXNzaW9ucygpOiB2b2lkIHtcbiAgICAvLyBTdXBwcmVzcyBJQU00IG9ubHkgZm9yIHNwZWNpZmljIEV2ZW50QnJpZGdlIG1hbmFnZWQgcG9saWNpZXNcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkU3RhY2tTdXBwcmVzc2lvbnModGhpcywgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgcmVhc29uOiAnRXZlbnRCcmlkZ2Ugc2VydmljZS1saW5rZWQgcm9sZSB1c2VzIEFXUyBtYW5hZ2VkIHBvbGljeSBmb3IgYmFzaWMgTGFtYmRhIGludm9jYXRpb24nLFxuICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAnUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FXU0xhbWJkYVJvbGUnLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICBdKTtcblxuICAgIC8vIFN1cHByZXNzIElBTTUgd2l0aCBzcGVjaWZpYyByZXNvdXJjZSBwYXR0ZXJuc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyh0aGlzLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdFdmVudEJyaWRnZSByZXF1aXJlcyB3aWxkY2FyZCBmb3IgTGFtYmRhIGZ1bmN0aW9uIHZlcnNpb25zIGFuZCBhbGlhc2VzIHdpdGhpbiB0aGUgc3BlY2lmaWMgZnVuY3Rpb24gQVJOJyxcbiAgICAgICAgYXBwbGllc1RvOiBbXG4gICAgICAgICAgJ1Jlc291cmNlOjphcm46YXdzOmxhbWJkYToqOio6ZnVuY3Rpb246cG9zdG9saW8tKjoqJyxcbiAgICAgICAgICAnQWN0aW9uOjpsYW1iZGE6SW52b2tlRnVuY3Rpb24nLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHBvcnQgY29uZmlndXJhdGlvbiBmb3IgZG9jdW1lbnRhdGlvblxuICAgKi9cbiAgcHVibGljIGV4cG9ydENvbmZpZ3VyYXRpb24oKTogdm9pZCB7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NjaGVkdWxlQ29uZmlndXJhdGlvbicsIHtcbiAgICAgIHZhbHVlOiBKU09OLnN0cmluZ2lmeSh0aGlzLnNjaGVkdWxlQ29uZmlnLCBudWxsLCAyKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRCcmlkZ2Ugc2NoZWR1bGUgY29uZmlndXJhdGlvbicsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tc2NoZWR1bGUtY29uZmlnYCxcbiAgICB9KTtcblxuICAgIC8vIEV4cG9ydCBpbmRpdmlkdWFsIHJ1bGUgQVJOcyBmb3IgbW9uaXRvcmluZ1xuICAgIGNvbnN0IHJ1bGVOYW1lcyA9IFsnQXV0b3BpbG90UnVsZScsICdSZXRlbnRpb25SdWxlJywgJ0dEUFJDb21wbGlhbmNlUnVsZScsICdNZXRyaWNzQ29sbGVjdGlvblJ1bGUnXTtcbiAgICBydWxlTmFtZXMuZm9yRWFjaChydWxlTmFtZSA9PiB7XG4gICAgICBjb25zdCBydWxlID0gdGhpcy5ub2RlLnRyeUZpbmRDaGlsZChydWxlTmFtZSkgYXMgZXZlbnRzLlJ1bGU7XG4gICAgICBpZiAocnVsZSkge1xuICAgICAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBgJHtydWxlTmFtZX1Bcm5gLCB7XG4gICAgICAgICAgdmFsdWU6IHJ1bGUucnVsZUFybixcbiAgICAgICAgICBkZXNjcmlwdGlvbjogYEFSTiBmb3IgJHtydWxlTmFtZX1gLFxuICAgICAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS0ke3J1bGVOYW1lfS1hcm5gLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufSJdfQ==