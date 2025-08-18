# Configuration Management Guide for Postolio

## 📋 Table of Contents
1. [Overview](#overview)
2. [Industry Standards](#industry-standards)
3. [Configuration Hierarchy](#configuration-hierarchy)
4. [EventBridge Rules Configuration](#eventbridge-rules-configuration)
5. [Environment-Specific Settings](#environment-specific-settings)
6. [Security Best Practices](#security-best-practices)
7. [Migration Guide](#migration-guide)

---

## 🎯 Overview

This guide documents the configuration management strategy for Postolio, following industry best practices for cloud-native applications. The system uses a hierarchical configuration approach with AWS services for secure, scalable configuration management.

---

## 🏆 Industry Standards

### 1. **The Twelve-Factor App Methodology**
- **Config Factor (III)**: Store config in the environment
- **Backing Services (IV)**: Treat backing services as attached resources
- **Dev/Prod Parity (X)**: Keep development, staging, and production as similar as possible

### 2. **Configuration Management Patterns**

#### **Externalized Configuration**
```yaml
# ✅ GOOD: Configuration external to code
Environment: production
Schedule: cron(0 2 * * ? *)

# ❌ BAD: Hardcoded in application
if (env === 'prod') {
  schedule = '0 2 * * *'
}
```

#### **Configuration Hierarchy** (Most Specific Wins)
```
1. Runtime parameters (highest priority)
2. Environment variables
3. AWS Systems Manager Parameter Store
4. AWS Secrets Manager (for secrets)
5. Configuration files
6. Default values in code (lowest priority)
```

### 3. **AWS Best Practices**

#### **Systems Manager Parameter Store**
- Non-sensitive configuration
- Hierarchical organization
- Version tracking
- Cost-effective for standard parameters

#### **Secrets Manager**
- Sensitive data (API keys, passwords)
- Automatic rotation capability
- Cross-region replication
- Higher cost but enhanced security

#### **EventBridge for Scheduling**
- Serverless scheduling
- No infrastructure management
- Pay only for events
- Built-in retry and DLQ support

---

## 🔧 Configuration Hierarchy

### **Directory Structure in Parameter Store**
```
/postolio/
├── global/                      # Global settings across all environments
│   ├── feature-flags/          # Feature toggles
│   └── rate-limits/            # API rate limiting configs
├── dev/                        # Development environment
│   ├── scheduler/              # EventBridge schedules
│   │   ├── autopilot/         # Autopilot configuration
│   │   ├── retention/         # Retention policy settings
│   │   ├── gdpr/             # GDPR compliance settings
│   │   └── metrics/          # Metrics collection config
│   ├── api/                  # API configuration
│   └── database/             # Database settings
├── staging/                  # Staging environment
│   └── ...                   # Same structure as dev
└── prod/                     # Production environment
    └── ...                   # Same structure as dev
```

### **Configuration Loading Strategy**
```typescript
class ConfigurationManager {
  async loadConfig(key: string): Promise<any> {
    // 1. Check runtime override
    const runtimeValue = process.env[`OVERRIDE_${key}`];
    if (runtimeValue) return JSON.parse(runtimeValue);

    // 2. Check environment variable
    const envValue = process.env[key];
    if (envValue) return envValue;

    // 3. Check Parameter Store
    try {
      const param = await ssm.getParameter({
        Name: `/postolio/${environment}/${key}`,
        WithDecryption: true
      }).promise();
      return JSON.parse(param.Parameter.Value);
    } catch (error) {
      // Parameter not found, continue to defaults
    }

    // 4. Return default value
    return this.getDefaultValue(key);
  }
}
```

---

## ⏰ EventBridge Rules Configuration

### **1. Where to Configure**

EventBridge rules are configured in three places:

#### **Infrastructure as Code (Primary)**
Location: `aws-infrastructure/lib/stacks/eventbridge-rules-stack.ts`
```typescript
const rule = new events.Rule(this, 'AutopilotRule', {
  schedule: events.Schedule.expression('cron(0 2 * * ? *)'),
  enabled: true,
});
```

#### **Parameter Store (Runtime Overrides)**
Location: AWS Systems Manager Parameter Store
```json
{
  "path": "/postolio/prod/scheduler/autopilot",
  "value": {
    "enabled": true,
    "schedule": "cron(0 2,14 * * ? *)",
    "timezone": "America/New_York"
  }
}
```

#### **Environment Variables (Local Development)**
```bash
# .env.local
AUTOPILOT_SCHEDULE="rate(5 minutes)"  # Fast iteration in dev
RETENTION_ENABLED="false"             # Disable in local dev
```

### **2. Schedule Expressions**

#### **Rate Expressions** (Simple intervals)
```
rate(5 minutes)         # Every 5 minutes
rate(1 hour)           # Every hour
rate(7 days)           # Every 7 days
```

#### **Cron Expressions** (Precise scheduling)
```
# Format: cron(Minutes Hours Day-of-month Month Day-of-week Year)
cron(0 2 * * ? *)      # Daily at 2 AM UTC
cron(0 */4 * * ? *)    # Every 4 hours
cron(0 9 ? * MON-FRI *) # Weekdays at 9 AM UTC
cron(0 0 1 * ? *)      # First day of every month at midnight
```

### **3. Environment-Specific Schedules**

```typescript
const schedulesByEnvironment = {
  dev: {
    autopilot: 'rate(1 hour)',        // Frequent for testing
    retention: 'rate(12 hours)',      // Twice daily
    gdpr: 'rate(7 days)',            // Weekly
    metrics: 'rate(30 minutes)'       // Every 30 min
  },
  staging: {
    autopilot: 'cron(0 2 * * ? *)',   // Daily at 2 AM
    retention: 'cron(0 3 * * ? *)',   // Daily at 3 AM
    gdpr: 'cron(0 4 ? * SUN *)',     // Sunday at 4 AM
    metrics: 'rate(1 hour)'           // Hourly
  },
  prod: {
    autopilot: 'cron(0 2,14 * * ? *)', // Twice daily
    retention: 'cron(0 3 * * ? *)',    // Daily at 3 AM
    gdpr: 'cron(0 4 ? * SUN *)',      // Sunday at 4 AM
    metrics: 'cron(0/15 * * * ? *)'    // Every 15 minutes
  }
};
```

---

## 🌍 Environment-Specific Settings

### **Development Environment**
```yaml
Purpose: Rapid iteration and testing
Characteristics:
  - Frequent schedules for quick feedback
  - Verbose logging enabled
  - Mock external services allowed
  - Relaxed rate limits
  - Data retention: 7 days

Configuration:
  Parameter Store: /postolio/dev/*
  Secrets: postolio-dev-*
  EventBridge: Aggressive schedules (minutes/hours)
```

### **Staging Environment**
```yaml
Purpose: Production-like testing
Characteristics:
  - Production-like schedules
  - Standard logging levels
  - Real external services
  - Production rate limits
  - Data retention: 30 days

Configuration:
  Parameter Store: /postolio/staging/*
  Secrets: postolio-staging-*
  EventBridge: Production schedules
```

### **Production Environment**
```yaml
Purpose: Live user traffic
Characteristics:
  - Optimized schedules for performance
  - Error-level logging only
  - Production external services
  - Strict rate limits
  - Data retention: 90+ days (compliance)

Configuration:
  Parameter Store: /postolio/prod/*
  Secrets: postolio-prod-*
  EventBridge: Conservative schedules
```

---

## 🔒 Security Best Practices

### **1. Secrets Management**
```typescript
// ✅ GOOD: Using Secrets Manager
const apiKey = await secretsManager.getSecretValue({
  SecretId: 'postolio-prod-openai-key'
}).promise();

// ❌ BAD: Hardcoded or in environment variables
const apiKey = process.env.OPENAI_API_KEY;
```

### **2. Least Privilege Access**
```yaml
IAM Policy for Lambda:
  - ssm:GetParameter (specific paths only)
  - secretsmanager:GetSecretValue (specific secrets)
  - kms:Decrypt (specific keys)
  - No wildcard permissions
```

### **3. Encryption**
```yaml
At Rest:
  - Parameter Store: KMS encryption
  - Secrets Manager: Automatic KMS encryption
  - DynamoDB: Customer-managed KMS keys

In Transit:
  - TLS 1.2+ for all API calls
  - VPC endpoints for AWS services
```

### **4. Audit and Compliance**
```yaml
CloudTrail:
  - Log all Parameter Store access
  - Log all Secrets Manager access
  - Log EventBridge rule modifications

CloudWatch:
  - Alert on configuration changes
  - Monitor failed schedule executions
  - Track configuration drift
```

---

## 🔄 Migration Guide

### **From node-cron to EventBridge**

#### **Step 1: Map Existing Schedules**
```javascript
// Old (node-cron)
cron.schedule('0 3 * * *', processRetention);

// New (EventBridge)
{
  "schedule": "cron(0 3 * * ? *)",
  "taskType": "retention"
}
```

#### **Step 2: Deploy EventBridge Rules**
```bash
# Deploy infrastructure with rules
cdk deploy EventBridgeRulesStack --context environment=dev

# Verify rules created
aws events list-rules --name-prefix postolio-dev
```

#### **Step 3: Update Lambda Handlers**
```typescript
// Old handler
async processRetention() {
  // Process logic
}

// New handler
async handleEventBridgeTrigger(event: EventBridgeScheduledEvent) {
  if (event.detail.taskType === 'retention') {
    await this.processRetention();
  }
}
```

#### **Step 4: Configure Parameter Store**
```bash
# Set schedule configuration
aws ssm put-parameter \
  --name "/postolio/prod/scheduler/config" \
  --value '{"autopilot":{"enabled":true,"schedule":"cron(0 2 * * ? *)"}}'
  --type String
```

#### **Step 5: Monitor and Validate**
```bash
# Check rule execution
aws events list-rule-names-by-target \
  --target-arn arn:aws:lambda:region:account:function:name

# View execution history
aws logs filter-log-events \
  --log-group-name /aws/lambda/your-function \
  --filter-pattern "EventBridge"
```

---

## 📊 Monitoring Configuration Changes

### **CloudWatch Dashboard**
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Events", "SuccessfulRuleMatches", {"stat": "Sum"}],
          [".", "FailedInvocations", {"stat": "Sum"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "EventBridge Rule Execution"
      }
    }
  ]
}
```

### **Configuration Drift Detection**
```typescript
class ConfigurationAuditor {
  async detectDrift(): Promise<DriftReport> {
    const expected = await this.loadExpectedConfig();
    const actual = await this.loadActualConfig();
    
    const drift = this.compareConfigs(expected, actual);
    
    if (drift.length > 0) {
      await this.alertOnDrift(drift);
    }
    
    return drift;
  }
}
```

---

## 🎯 Best Practices Summary

1. **Use Parameter Store** for non-sensitive configuration
2. **Use Secrets Manager** for sensitive data
3. **Version control** infrastructure code (CDK/Terraform)
4. **Environment parity** with different values
5. **Audit logging** for all configuration access
6. **Automated validation** of configuration changes
7. **Gradual rollout** using feature flags
8. **Monitor and alert** on configuration drift
9. **Document** all configuration options
10. **Test** configuration changes in staging first

---

## 📚 References

- [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [AWS EventBridge Scheduler](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html)
- [The Twelve-Factor App](https://12factor.net/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [NIST Configuration Management Guidelines](https://csrc.nist.gov/publications/detail/sp/800-128/final)

---

*Last Updated: January 2025*
*Version: 1.0.0*