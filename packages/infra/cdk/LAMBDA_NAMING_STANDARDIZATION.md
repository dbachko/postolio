# Lambda Function Naming Standardization

## Current Lambda Naming Patterns Analysis

### Found Patterns:
1. **video-{function}-{env}**: `video-upload-dev`, `video-processor-dev`
2. **{service}-{env}**: `token-service-dev`, `mediaconvert-event-handler-dev`
3. **postolio-{env}-{service}**: `postolio-dev-token-service`, `postolio-dev-scheduler-service`
4. **postolio-{service}-{env}**: `postolio-dlq-processor-dev`
5. **{prefix}-{function}**: `postolio-scheduler-dev-schedule-management` (where prefix = `postolio-scheduler-${env}`)

### Issues with Current Approach:
- **Multiple patterns** require multiple IAM permission patterns:
  - `postolio-dev-*`
  - `postolio-*-dev`
  - `token-service-dev`
  - `video-*-dev`
  - `*-dev-*`
- This creates complexity in CDK Nag suppressions
- Harder to manage and audit permissions

## Proposed Standardized Pattern

### Recommended Pattern: `postolio-{env}-{service}-{function}`

Examples:
- `postolio-dev-scheduler-management`
- `postolio-dev-scheduler-publisher`
- `postolio-dev-token-service`
- `postolio-dev-token-rotation`
- `postolio-dev-video-upload`
- `postolio-dev-video-processor`
- `postolio-dev-dlq-processor`

### Benefits:
1. **Single IAM pattern**: `postolio-${environment}-*`
2. **Simpler CDK Nag suppressions**: One suppression rule covers all
3. **Clear hierarchy**: Organization → Environment → Service → Function
4. **Easier filtering**: Can filter by environment or service easily
5. **Consistent across all stacks**

## Migration Plan

### Phase 1: Update All Lambda Names
Update function names in these files:
- `packages/infra/cdk/lib/stacks/video-processing-stack.ts`
- `packages/infra/cdk/lib/stacks/token-service-stack.ts`
- `packages/infra/cdk/lib/stacks/platform-microservices-stack.ts`
- `packages/infra/cdk/lib/stacks/postolio-lambda-stack.ts`
- `packages/infra/cdk/lib/scheduler/content-scheduler-stack.ts`

### Phase 2: Update IAM Permissions
Change all Lambda invocation permissions to use:
```typescript
`arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`
```

### Phase 3: Simplify CDK Nag Suppressions
Update suppressions to use single pattern:
```typescript
`Resource::arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`
```

### Phase 4: Update SSM Parameters
Update service discovery parameters to match new naming.

## Implementation Checklist

### Phase 1 (This PR)
- [x] Update content-scheduler-stack.ts Lambda names
- [x] Update content-scheduler-stack.ts prefix variable to `postolio-${environment}-scheduler`
- [x] Update all IAM permission statements in content-scheduler-stack.ts
- [x] Simplify CDK Nag suppressions in content-scheduler-stack.ts
- [x] Fix CloudWatch log group patterns
- [x] Update EventBridge scheduler ARN patterns in suppressions
- [x] Test CDK synth - no errors

### Phase 2 (This PR - Completed)
- [x] Update video-processing-stack.ts Lambda names
- [x] Update token-service-stack.ts Lambda names (changed from `token-service-${environment}`)
- [x] Update platform-microservices-stack.ts Lambda names
- [x] Update platform-microservices-stack.ts IAM references to remove old patterns
- [x] Update postolio-lambda-stack.ts Lambda names (already followed pattern)
- [x] Update cross-stack IAM references to single pattern
- [x] Simplify all IAM permissions to use `postolio-${environment}-*`

## Notes

### Issues Found During Implementation
1. **CloudWatch Log Groups**: Need to match new Lambda naming pattern
2. **EventBridge Scheduler ARNs**: Must be updated in CDK Nag suppressions
3. **Cross-stack References**: Other stacks reference old patterns (e.g., `token-service-${environment}`)
4. **Prefix Variables**: Using centralized prefix helps maintain consistency across resources

### Benefits Achieved
- **Single IAM pattern** for all Lambda invocations: `postolio-${environment}-*`
- **Reduced CDK Nag suppression complexity** from 5+ patterns to 1
- **Consistent resource naming** across all stacks
- **CDK synth passes** without errors for all stacks

## Lambda Name Changes Summary

### Content Scheduler Stack
- `postolio-scheduler-dev-schedule-management` → `postolio-dev-scheduler-management`
- `postolio-scheduler-dev-publisher` → `postolio-dev-scheduler-publisher`
- `postolio-scheduler-dev-retry-handler` → `postolio-dev-scheduler-retry`
- `postolio-scheduler-dev-schedule-cleanup` → `postolio-dev-scheduler-cleanup`
- `postolio-scheduler-dev-status-sync` → `postolio-dev-scheduler-status-sync`

### Token Service Stack
- `token-service-dev` → `postolio-dev-token-service`

### Video Processing Stack
- `video-upload-dev` → `postolio-dev-video-upload`
- `video-processor-dev` → `postolio-dev-video-processor`
- `video-validator-dev` → `postolio-dev-video-validator`
- `mediaconvert-event-handler-dev` → `postolio-dev-video-mediaconvert-handler`

### Platform Microservices Stack
- `postolio-dev-token-service` (already correct)
- `postolio-dev-token-rotation` (already correct)
- `postolio-dev-scheduler-service` (already correct)
- `postolio-dev-{platform}-publisher` (already correct)
- `postolio-dlq-processor-dev` → `postolio-dev-dlq-processor`
- `postolio-dlq-reprocess-dev` → `postolio-dev-dlq-reprocess`

### Postolio Lambda Stack
- `postolio-dev-eventbridge-handler` (already correct)