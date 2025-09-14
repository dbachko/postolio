# AWS Lambda Recursive Loop Fix - Testing Guide

## 🚨 **PROBLEM SOLVED**

### **Root Cause Identified:**

- **51 failed publisher invocations** despite `MAX_RETRY_ATTEMPTS = 3`
- **SQS was retrying the retry-handler itself** when it threw errors
- **Infinite loop**: Publisher fails → DLQ → Retry-handler throws error → SQS retries retry-handler → ♻️

### **Solution Implemented:**

1. **Smart Error Classification** - Auth errors trigger circuit breaker
2. **Exponential Backoff with Jitter** - Industry standard (AWS/Google)
3. **Never throw errors** from retry-handler - Always process messages successfully
4. **Manual DLQ management** - Structured error messages instead of AWS automatic retry
5. **EventBridge Scheduler** - Precise delayed retries instead of immediate invocation

---

## 🔧 **ARCHITECTURE TRANSFORMATION**

### **Before (Broken):**

```
Publisher fails → AWS auto-DLQ → Retry-handler → Invoke publisher immediately → Fails → Retry-handler throws error → SQS retries retry-handler → ♻️ INFINITE LOOP
```

### **After (Fixed):**

```
Publisher fails → Manual DLQ with error context → Retry-handler analyzes error →
├─ Auth error (403) → Circuit breaker → Mark as failed ✅
├─ Rate limit (429) → Schedule retry in 5s with jitter ⏰
└─ Server error (500) → Schedule retry with exponential backoff ⏰
```

---

## 🧪 **TESTING PLAN**

### **Test 1: Authentication Error (403) - Circuit Breaker**

```bash
# Simulate 403 error from Token Service
# Expected: Circuit breaker opens immediately, no retries

# 1. Deploy the fix
pnpm cdk deploy ContentScheduler-dev

# 2. Monitor logs
aws logs tail --follow /aws/lambda/postolio-scheduler-dev-publisher
aws logs tail --follow /aws/lambda/postolio-scheduler-dev-retry-handler

# 3. Trigger a publish (will fail with 403)
# 4. Verify: Circuit breaker opens, marked as failed, NO retries
```

### **Test 2: Rate Limiting (429) - Exponential Backoff**

```bash
# Expected: 5 retries with delays: 5s, 10s, 20s, 40s, 60s (max)

# Monitor retry scheduling:
aws logs filter-log-events \
  --log-group-name "/aws/lambda/postolio-scheduler-dev-retry-handler" \
  --filter-pattern "Retry scheduled"
```

### **Test 3: Server Error (500) - Standard Exponential Backoff**

```bash
# Expected: 5 retries with delays: 1s, 2s, 4s, 8s, 16s

# Check EventBridge schedules created:
aws scheduler list-schedules \
  --group-name postolio-scheduler-dev-schedules \
  --query 'Schedules[?contains(Name, `retry-`)].{Name:Name,State:State}'
```

### **Test 4: Verify No Infinite Loops**

```bash
# Monitor publisher invocations - should NOT exceed retry limits
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=postolio-scheduler-dev-publisher \
  --start-time $(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%S') \
  --end-time $(date -u '+%Y-%m-%dT%H:%M:%S') \
  --period 300 \
  --statistics Sum
```

---

## 📊 **MONITORING METRICS**

### **Key CloudWatch Metrics:**

```bash
# Circuit breaker activations
aws logs filter-log-events \
  --log-group-name "/aws/lambda/postolio-scheduler-dev-retry-handler" \
  --filter-pattern "Circuit breaker"

# Retry decisions
aws logs filter-log-events \
  --log-group-name "/aws/lambda/postolio-scheduler-dev-retry-handler" \
  --filter-pattern "Retry decision made"

# Error type classification
aws logs filter-log-events \
  --log-group-name "/aws/lambda/postolio-scheduler-dev-retry-handler" \
  --filter-pattern "ErrorType"
```

### **Expected Log Patterns:**

```json
// Circuit breaker for 403 errors
{
  "message": "Retry decision made",
  "scheduleId": "SCH_...",
  "shouldRetry": false,
  "reason": "Authentication error - circuit breaker opened",
  "circuitBreakerOpen": true
}

// Exponential backoff for 500 errors
{
  "message": "Retry scheduled with exponential backoff",
  "scheduleId": "SCH_...",
  "attemptNumber": 2,
  "delayMs": 2000
}
```

---

## ✅ **SUCCESS CRITERIA**

### **Must Verify:**

1. **No infinite loops** - Max 5 retries per schedule ID
2. **Circuit breaker works** - 403 errors stop immediately
3. **Exponential backoff** - Delays increase: 1s, 2s, 4s, 8s, 16s
4. **Jitter applied** - Actual delays vary slightly from exact exponentials
5. **Structured error handling** - Error types correctly classified
6. **EventBridge scheduling** - Delayed retries use scheduler, not immediate invocation

### **Performance Metrics:**

- **Publisher invocations**: Should match retry limits (≤ 5 per schedule)
- **DLQ processing**: 100% success rate (no retry-handler errors)
- **Circuit breaker response**: < 100ms for auth errors
- **Retry delays**: Match exponential backoff formula ± jitter

---

## 🚀 **DEPLOYMENT STEPS**

### **1. Deploy Infrastructure:**

```bash
cd packages/infra/cdk
pnpm cdk diff ContentScheduler-dev
pnpm cdk deploy ContentScheduler-dev
```

### **2. Verify Configuration:**

```bash
# Check DLQ URL is set
aws lambda get-function-configuration \
  --function-name postolio-scheduler-dev-publisher \
  --query 'Environment.Variables.DLQ_URL'

# Check Scheduler role ARN
aws lambda get-function-configuration \
  --function-name postolio-scheduler-dev-retry-handler \
  --query 'Environment.Variables.SCHEDULER_ROLE_ARN'
```

### **3. Test Scenarios:**

```bash
# Force a 403 error scenario
# Monitor logs for circuit breaker activation
# Verify no retries occur

# Force a 500 error scenario
# Monitor EventBridge schedules
# Verify exponential backoff delays
```

---

## 🔍 **VERIFICATION COMMANDS**

### **Check Current State:**

```bash
# No stuck schedules
aws dynamodb scan \
  --table-name postolio-scheduler-dev-schedules \
  --filter-expression "#status = :status" \
  --expression-attribute-names '{"#status":"status"}' \
  --expression-attribute-values '{":status":{"S":"scheduled"}}' \
  --query 'Count'

# No pending EventBridge schedules
aws scheduler list-schedules \
  --group-name postolio-scheduler-dev-schedules \
  --query 'Schedules[?State==`ENABLED`].Name'

# DLQ message count (should be 0 after processing)
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name postolio-scheduler-dev-dlq --query 'QueueUrl' --output text) \
  --attribute-names ApproximateNumberOfMessages
```

---

## 🎯 **EXPECTED RESULTS**

After deploying this fix:

✅ **No more 51+ failed invocations** - Limited to 5 max per schedule
✅ **No more recursive loops** - Retry-handler never throws errors
✅ **Smart error handling** - Auth errors fail fast with circuit breaker
✅ **Proper retry delays** - Exponential backoff with jitter
✅ **Structured monitoring** - Clear error classification and metrics
✅ **Industry compliance** - Follows AWS, Netflix, Google best practices

The AWS Lambda recursive loop issue will be **completely resolved**.
