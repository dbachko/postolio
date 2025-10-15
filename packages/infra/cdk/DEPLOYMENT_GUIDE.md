# Postolio Infrastructure Deployment Guide

## 🚨 Fix for AWS Lambda Recursive Loop

The recursive loop was caused by hardcoded API Gateway ARNs in IAM policies. This has been fixed with **dynamic SSM Parameter Store resolution**.

## 🛠 **Dynamic Resource Resolution**

### **Problem Solved:**

- ❌ **Before**: `arn:aws:execute-api:us-east-1:000000000000:*/*/GET/tokens/*`
- ✅ **After**: `arn:aws:execute-api:us-east-1:000000000000:${ssmApiId}/*/GET/tokens/*`

### **Implementation:**

The ContentSchedulerStack now dynamically resolves the Token Service API Gateway ID using **SSM Parameter Store** which provides:

✅ **Flexible deployment order** - Deploy stacks in any order
✅ **No circular dependencies** - No cross-stack references needed
✅ **Runtime resolution** - API Gateway ID resolved at deployment time
✅ **Environment isolation** - Separate parameters per environment

## 📦 **SSM Parameter Store Solution**

### **How it works:**

1. **Token Service Stack** stores the API Gateway ID in SSM:

   ```
   Parameter: /postolio/{environment}/token-service/api-gateway-id
   Value: 2wvb4zp8pk (actual API Gateway ID)
   ```

2. **Content Scheduler Stack** retrieves it during deployment:

   ```typescript
   const apiId = ssm.StringParameter.valueFromLookup(
     this,
     `/postolio/${environment}/token-service/api-gateway-id`
   );
   ```

3. **IAM Policy** uses the resolved ID:
   ```
   arn:aws:execute-api:us-east-1:000000000000:2wvb4zp8pk/*/GET/tokens/*
   ```

## 🚀 **Deployment**

### **Simple Deployment (Any Order):**

```bash
# Deploy both stacks in parallel or any order
pnpm cdk deploy TokenService-dev ContentScheduler-dev

# Or deploy separately in any sequence
pnpm cdk deploy TokenService-dev
pnpm cdk deploy ContentScheduler-dev
```

### **Multi-Environment Setup:**

```bash
# Development
pnpm cdk deploy TokenService-dev ContentScheduler-dev

# Staging
pnpm cdk deploy TokenService-staging ContentScheduler-staging

# Production
pnpm cdk deploy TokenService-prod ContentScheduler-prod
```

## 🎯 **Key Benefits**

1. **✅ No Hardcoded ARNs** - Dynamic resolution at deploy time
2. **✅ Account/Region Agnostic** - Uses `${this.region}` and `${this.account}`
3. **✅ Environment Isolation** - Separate parameters per environment
4. **✅ Flexible Deployment** - Deploy in any order
5. **✅ No Cross-Stack Dependencies** - Cleaner architecture
6. **✅ Infrastructure as Code** - Best practices compliance

## 🔍 **Verification**

After deployment, verify the fix:

```bash
# 1. Check SSM Parameter exists
aws ssm get-parameter \
  --name "/postolio/dev/token-service/api-gateway-id" \
  --query 'Parameter.Value' --output text
# Should return: 2wvb4zp8pk

# 2. Check IAM policy has correct API Gateway ID
aws iam get-role-policy \
  --role-name "ContentScheduler-dev-PublisherLambdaServiceRole*" \
  --policy-name "PublisherLambdaServiceRoleDefaultPolicy*"
# Should show: arn:aws:execute-api:us-east-1:000000000000:2wvb4zp8pk/*/GET/tokens/*

# 3. Test Lambda publisher can access Token Service
aws lambda invoke --function-name postolio-scheduler-dev-publisher \
  --payload '{"scheduleId":"test"}' /tmp/test-response.json
```

## 🏗 **Architecture Benefits**

### **Before (Problematic):**

```
ContentScheduler ──❌ Hardcoded ARN ──> TokenService
                   (*/*/GET/tokens/*)
```

### **After (Fixed):**

```
TokenService ──> SSM Parameter (/postolio/dev/token-service/api-gateway-id: 2wvb4zp8pk)
                       ⬇
ContentScheduler ──> SSM Lookup ──> Dynamic ARN (2wvb4zp8pk/*/GET/tokens/*)
```

## 🚀 **Result**

- ✅ **No more hardcoded ARNs** - Dynamic resolution
- ✅ **No more recursive Lambda loops** - Fixed IAM permissions
- ✅ **Infrastructure as Code best practices** - Proper resource references
- ✅ **Multi-environment support** - Environment-specific parameters
- ✅ **Flexible deployment** - No dependency order requirements

### Scheduling ↔ Publishing integration (EventBridge mode)

- Scheduling now schedules events to the Scheduling EventBus using EventBridge Scheduler. No direct Lambda ARN or Publishing role is referenced.
- Publishing adds a rule on the Scheduling EventBus to invoke the Publisher Lambda for events with:
  - `source: postolio.scheduling`
  - `detail-type: schedule.due`
- Scheduling publishes the Scheduler execution role ARN via SSM for retry use:
  - `/postolio/{environment}/scheduling/scheduler-events-role-arn`
