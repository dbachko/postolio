import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
/**
 * Configuration for EventBridge scheduled rules
 * Following industry standards for externalized configuration
 */
export interface ScheduleConfig {
    autopilot: {
        enabled: boolean;
        schedule: string;
        timezone?: string;
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
export declare class EventBridgeRulesStack extends cdk.Stack {
    private readonly scheduleConfig;
    private readonly envName;
    constructor(scope: Construct, id: string, props: EventBridgeRulesStackProps);
    /**
     * Load schedule configuration based on environment
     * Industry Standard: Environment-specific configuration
     */
    private loadScheduleConfig;
    /**
     * Store configuration in AWS Systems Manager Parameter Store
     * Industry Standard: Externalized configuration management
     */
    private storeConfigInParameterStore;
    /**
     * Create Autopilot content generation rule
     */
    private createAutopilotRule;
    /**
     * Create Retention policy processing rule
     */
    private createRetentionRule;
    /**
     * Create GDPR compliance processing rule
     */
    private createGDPRComplianceRule;
    /**
     * Create metrics collection rule
     */
    private createMetricsCollectionRule;
    /**
     * Add CDK Nag suppressions with justifications
     */
    private addNagSuppressions;
    /**
     * Export configuration for documentation
     */
    exportConfiguration(): void;
}
