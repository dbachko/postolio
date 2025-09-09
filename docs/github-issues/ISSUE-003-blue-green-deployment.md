# [CRITICAL] Implement Blue-Green Deployment Strategy

## 🚨 Safe Production Deployment Requirement

### Problem

Current deployment strategy is **direct replacement** with no traffic shifting or rollback capability. A failed deployment could cause **complete service outage** with manual intervention required for recovery.

### Business Impact

- **Service outage risk** during deployments
- **No gradual rollout** capability
- **Slow rollback** (15+ minutes manual process)
- **No canary testing** before full deployment
- **Customer impact** from deployment failures

### Current State vs Required

```
Current: Direct deployment with manual rollback
Required: Blue-green with automated traffic shifting
Gap: No safe deployment mechanism
```

### Required Implementation

#### 1. Blue-Green Architecture with AWS CodeDeploy

```typescript
// aws-infrastructure/lib/deployment/blue-green-stack.ts

import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

// Application Load Balancer with two target groups
const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
  vpc,
  internetFacing: true,
});

// Blue environment (current production)
const blueTargetGroup = new elbv2.ApplicationTargetGroup(
  this,
  "BlueTargetGroup",
  {
    vpc,
    port: 80,
    targetType: elbv2.TargetType.IP,
    healthCheck: {
      path: "/health",
      interval: cdk.Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    },
  },
);

// Green environment (new deployment)
const greenTargetGroup = new elbv2.ApplicationTargetGroup(
  this,
  "GreenTargetGroup",
  {
    vpc,
    port: 80,
    targetType: elbv2.TargetType.IP,
    healthCheck: {
      path: "/health",
      interval: cdk.Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    },
  },
);

// CodeDeploy configuration
const deploymentGroup = new codedeploy.EcsDeploymentGroup(this, "BlueGreenDG", {
  service: ecsService,
  blueGreenDeploymentConfig: {
    blueTargetGroup,
    greenTargetGroup,
    listener: albListener,
    deploymentConfig: codedeploy.EcsDeploymentConfig.CANARY_10PERCENT_5MINUTES,
    terminationWaitTime: cdk.Duration.minutes(5),
  },
  autoRollback: {
    failedDeployment: true,
    stoppedDeployment: true,
    deploymentInAlarm: true,
  },
  alarms: [highErrorRateAlarm, highLatencyAlarm],
});
```

#### 2. Lambda Blue-Green with Weighted Alias

```typescript
// Lambda function versioning and aliases
const lambdaFunction = new lambda.Function(this, "SchedulerFunction", {
  // ... configuration
});

// Create versions
const version = lambdaFunction.currentVersion;

// Create weighted alias for traffic shifting
const prodAlias = new lambda.Alias(this, "ProdAlias", {
  aliasName: "prod",
  version: version,
});

// CodeDeploy for Lambda
const deploymentConfig = new codedeploy.LambdaDeploymentConfig(
  this,
  "DeployConfig",
  {
    deploymentConfigName: "Canary10Percent5Minutes",
    trafficRoutingConfig: {
      type: codedeploy.TrafficRoutingType.TIME_BASED_CANARY,
      timeBasedCanary: {
        canaryPercentage: 10,
        canaryInterval: cdk.Duration.minutes(5),
      },
    },
  },
);

const deploymentGroup = new codedeploy.LambdaDeploymentGroup(
  this,
  "DeploymentGroup",
  {
    application: application,
    alias: prodAlias,
    deploymentConfig: deploymentConfig,
    alarms: [errorAlarm, throttleAlarm],
    autoRollback: {
      failedDeployment: true,
      stoppedDeployment: true,
      deploymentInAlarm: true,
    },
  },
);
```

#### 3. Traffic Shifting Strategies

```typescript
// Progressive deployment configurations
enum DeploymentStrategy {
  // Canary: 10% traffic for 5 minutes, then 100%
  CANARY_10_PERCENT = "CodeDeployDefault.LambdaCanary10PercentEvery5Minutes",

  // Linear: Shift 10% every 10 minutes
  LINEAR_10_PERCENT = "CodeDeployDefault.LambdaLinear10PercentEvery10Minutes",

  // All at once (for emergency fixes)
  ALL_AT_ONCE = "CodeDeployDefault.LambdaAllAtOnce",
}

// Custom deployment configuration
const customConfig = new codedeploy.CustomLambdaDeploymentConfig(
  this,
  "CustomConfig",
  {
    type: codedeploy.CustomLambdaDeploymentConfigType.CANARY,
    interval: cdk.Duration.minutes(10),
    percentage: 20,
  },
);
```

#### 4. Deployment Pipeline Integration

```yaml
# .github/workflows/blue-green-deploy.yml
name: Blue-Green Production Deployment

on:
  workflow_dispatch:
    inputs:
      strategy:
        type: choice
        description: "Deployment strategy"
        options:
          - canary-10
          - linear-10
          - all-at-once
        required: true
        default: "canary-10"

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE }}
          aws-region: us-east-1

      - name: Deploy with Blue-Green
        run: |
          aws deploy create-deployment \
            --application-name postolio-scheduler \
            --deployment-group-name production \
            --deployment-config-name ${{ github.event.inputs.strategy }} \
            --revision location=S3,bucket=deployments,key=latest.zip

      - name: Monitor Deployment
        run: |
          deployment_id=$(aws deploy list-deployments \
            --application-name postolio-scheduler \
            --max-items 1 \
            --query 'deployments[0]' \
            --output text)

          aws deploy wait deployment-successful \
            --deployment-id $deployment_id
```

### Deployment Script Updates

```bash
#!/bin/bash
# scripts/blue-green-deploy.sh

deploy_blue_green() {
    local STRATEGY="${1:-canary-10}"
    local DEPLOYMENT_ID="deploy-$(date +%Y%m%d-%H%M%S)"

    log_info "Starting blue-green deployment: ${DEPLOYMENT_ID}"
    log_info "Strategy: ${STRATEGY}"

    # 1. Create new version
    log_info "Creating new Lambda version..."
    VERSION=$(aws lambda publish-version \
        --function-name content-scheduler-api \
        --description "${DEPLOYMENT_ID}" \
        --query 'Version' \
        --output text)

    # 2. Start CodeDeploy deployment
    log_info "Starting CodeDeploy deployment..."
    DEPLOYMENT=$(aws deploy create-deployment \
        --application-name postolio-scheduler \
        --deployment-group-name production \
        --deployment-config-name "${STRATEGY}" \
        --description "${DEPLOYMENT_ID}" \
        --revision revisionType=AppSpecContent,appSpecContent="{
            \"version\": \"0.0\",
            \"Resources\": [{
                \"TargetService\": {
                    \"Type\": \"AWS::Lambda::Function\",
                    \"Properties\": {
                        \"Name\": \"content-scheduler-api\",
                        \"Alias\": \"prod\",
                        \"CurrentVersion\": \"${VERSION}\",
                        \"TargetVersion\": \"${VERSION}\"
                    }
                }
            }]
        }" \
        --output json)

    DEPLOYMENT_ID=$(echo $DEPLOYMENT | jq -r '.deploymentId')

    # 3. Monitor deployment
    log_info "Monitoring deployment: ${DEPLOYMENT_ID}"
    monitor_deployment "${DEPLOYMENT_ID}"
}

monitor_deployment() {
    local DEPLOYMENT_ID=$1
    local MAX_WAIT=1800  # 30 minutes
    local ELAPSED=0

    while [ $ELAPSED -lt $MAX_WAIT ]; do
        STATUS=$(aws deploy get-deployment \
            --deployment-id "${DEPLOYMENT_ID}" \
            --query 'deploymentInfo.status' \
            --output text)

        case $STATUS in
            "Succeeded")
                log_success "Deployment succeeded!"
                return 0
                ;;
            "Failed"|"Stopped")
                log_error "Deployment failed: ${STATUS}"
                trigger_rollback "${DEPLOYMENT_ID}"
                return 1
                ;;
            "InProgress"|"Queued"|"Ready")
                log_info "Status: ${STATUS} (${ELAPSED}s elapsed)"
                sleep 30
                ELAPSED=$((ELAPSED + 30))
                ;;
        esac
    done

    log_error "Deployment timeout after ${MAX_WAIT} seconds"
    return 1
}
```

### Rollback Procedures

#### Automatic Rollback Triggers

1. **CloudWatch Alarms** - High error rate or latency
2. **Health Check Failures** - Target group unhealthy
3. **Deployment Failures** - CodeDeploy errors
4. **Manual Trigger** - Operator intervention

#### Manual Rollback Command

```bash
# Immediate rollback
aws deploy stop-deployment \
  --deployment-id DEPLOYMENT_ID \
  --auto-rollback-enabled

# Or shift all traffic back
aws lambda update-alias \
  --function-name content-scheduler-api \
  --name prod \
  --function-version PREVIOUS_VERSION \
  --routing-config AdditionalVersionWeights={}
```

### Testing Requirements

- [ ] Test canary deployment (10% traffic)
- [ ] Test linear deployment (gradual shift)
- [ ] Test automatic rollback on alarm
- [ ] Test manual rollback procedure
- [ ] Measure deployment time
- [ ] Validate zero-downtime deployment

### Success Criteria

- [ ] Zero-downtime deployments
- [ ] Automatic rollback working
- [ ] < 5 minute rollback time
- [ ] Canary testing before full rollout
- [ ] CloudWatch integration
- [ ] No customer impact during deployment

### Monitoring During Deployment

```typescript
// CloudWatch Dashboard for deployment monitoring
const deploymentDashboard = new cloudwatch.Dashboard(
  this,
  "DeploymentDashboard",
  {
    dashboardName: "BlueGreenDeployment",
    widgets: [
      [
        new cloudwatch.GraphWidget({
          title: "Canary vs Production Errors",
          left: [canaryErrorMetric],
          right: [productionErrorMetric],
        }),
        new cloudwatch.GraphWidget({
          title: "Traffic Distribution",
          left: [canaryTrafficMetric, productionTrafficMetric],
        }),
      ],
      [
        new cloudwatch.SingleValueWidget({
          title: "Deployment Status",
          metrics: [deploymentStatusMetric],
        }),
      ],
    ],
  },
);
```

### Files to Modify

1. **aws-infrastructure/lib/deployment/**
   - Create `blue-green-stack.ts`
   - Add CodeDeploy configuration
   - Configure traffic shifting

2. **scripts/blue-green-deploy.sh**
   - New deployment script
   - Monitoring functions
   - Rollback procedures

3. **.github/workflows/deploy-production.yml**
   - Update deployment workflow
   - Add blue-green steps

### Estimated Effort

- **Development**: 3-4 days
- **Testing**: 2-3 days
- **Documentation**: 1 day
- **Total**: 1-1.5 weeks

### References

- [AWS CodeDeploy Blue-Green Deployments](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployments-blue-green.html)
- [Lambda Traffic Shifting](https://docs.aws.amazon.com/lambda/latest/dg/lambda-traffic-shifting-using-aliases.html)
- [ECS Blue-Green Deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-bluegreen.html)

### Priority

**🔴 CRITICAL** - Required for safe production deployments

### Labels

`critical`, `deployment`, `blue-green`, `production-blocker`, `devops`
