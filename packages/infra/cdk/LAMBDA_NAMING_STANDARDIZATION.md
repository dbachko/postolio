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

- [ ] Update video-processing-stack.ts Lambda names
- [ ] Update token-service-stack.ts Lambda names
- [ ] Update platform-microservices-stack.ts Lambda names
- [ ] Update postolio-lambda-stack.ts Lambda names
- [ ] Update content-scheduler-stack.ts Lambda names
- [ ] Update all IAM permission statements
- [ ] Simplify CDK Nag suppressions
- [ ] Test CDK synth
- [ ] Update any hardcoded references in application code
- [ ] Update documentation