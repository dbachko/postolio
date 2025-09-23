# Foundation Stack Migration Guide

## Overview
This guide provides step-by-step instructions for migrating shared infrastructure components from the API stack to the new enhanced Foundation stack.

## Pre-Migration Checklist

- [ ] Take RDS database snapshot
- [ ] Document current resource IDs and endpoints
- [ ] Review current SSM parameters
- [ ] Ensure all environments are backed up
- [ ] Test rollback procedures in dev environment

## Migration Steps

### Step 1: Deploy Enhanced Foundation Stack (Without Breaking Changes)

First, deploy the new Foundation stack alongside existing infrastructure:

```bash
# Deploy to dev first
cd packages/infra/cdk
pnpm cdk deploy Postolio-Foundation-dev --context environment=dev
```

### Step 2: Update Lambda Stacks to Use SSM Parameters

Update the Scheduling and Publishing stacks to conditionally use Foundation resources:

#### scheduling-stack.ts
```typescript
// Before (current implementation)
const enableVpcConfig = this.node.tryGetContext('enableVpcConfig') === 'true';

// After (use Foundation resources if available)
const vpcId = ssm.StringParameter.valueFromLookup(
  this,
  `/postolio/${environment}/vpc/id`
);

// Check if Foundation stack resources exist
const hasFoundationResources = vpcId && !vpcId.startsWith('dummy-value-for-');

if (hasFoundationResources) {
  // Use Foundation VPC
  vpc = ec2.Vpc.fromLookup(this, 'DatabaseVpc', {
    vpcId: vpcId,
  });

  // Get security group from Foundation
  const lambdaSecurityGroupId = ssm.StringParameter.valueFromLookup(
    this,
    `/postolio/${environment}/security-groups/lambda`
  );

  lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
    this,
    'LambdaSecurityGroup',
    lambdaSecurityGroupId
  );
}
```

### Step 3: Update API Stack to Use Foundation Resources

Modify the API stack to use Foundation resources instead of creating its own:

#### api-stack.ts
```typescript
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // Import VPC from Foundation stack
    const vpcId = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/vpc/id`
    );

    const vpc = ec2.Vpc.fromLookup(this, 'FoundationVpc', {
      vpcId: vpcId,
    });

    // Import database endpoint
    const databaseEndpoint = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/database/endpoint`
    );

    // Import cache endpoint
    const cacheEndpoint = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/cache/endpoint`
    );

    // Import security groups
    const ecsSecurityGroupId = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/security-groups/ecs`
    );

    const ecsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'EcsSecurityGroup',
      ecsSecurityGroupId
    );

    // Create only ECS-specific resources
    this.ecsCluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc: vpc,
      clusterName: `${prefix}-cluster`,
      containerInsights: true,
    });

    // ... rest of ECS configuration using imported resources
  }
}
```

### Step 4: Update Stack Dependencies

Update the app.ts file to reflect new dependencies:

```typescript
// Foundation is the base for all infrastructure
const foundationStack = new FoundationStack(app, `Postolio-Foundation-${environment}`, {
  env: stackEnv,
  environment: environment as 'dev' | 'staging' | 'prod',
  enableVpcFlowLogs: environment === 'prod',
  enableDatabaseProxy: true,
});

// All stacks now depend on Foundation
authStack.addDependency(foundationStack);
schedulingStack.addDependency(foundationStack);
publishingStack.addDependency(foundationStack);
apiStack.addDependency(foundationStack);
webStack.addDependency(foundationStack);

// Service dependencies remain the same
schedulingStack.addDependency(authStack);
publishingStack.addDependency(authStack);
publishingStack.addDependency(schedulingStack);
webStack.addDependency(apiStack);
```

### Step 5: Deploy Updated Stacks

Deploy in this order to ensure proper dependency resolution:

```bash
# 1. Foundation (already deployed)
pnpm cdk deploy Postolio-Foundation-dev

# 2. Auth (depends on Foundation)
pnpm cdk deploy Postolio-Auth-dev

# 3. API (depends on Foundation, uses new VPC/DB references)
pnpm cdk deploy Postolio-API-dev

# 4. Scheduling and Publishing (parallel, both depend on Foundation)
pnpm cdk deploy Postolio-Scheduling-dev Postolio-Publishing-dev

# 5. Web (depends on API)
pnpm cdk deploy Postolio-Web-dev
```

### Step 6: Verify Migration

Run verification checks:

```bash
# Check SSM parameters
aws ssm get-parameters-by-path --path /postolio/dev --recursive

# Test database connectivity
aws rds describe-db-instances --db-instance-identifier postolio-dev-database

# Test Lambda functions with VPC configuration
aws lambda invoke --function-name postolio-dev-schedule-management test-output.json

# Check ECS service health
aws ecs describe-services --cluster postolio-dev-cluster --services postolio-dev-api-service
```

### Step 7: Clean Up Old Resources

After verification, remove old resources from API stack:

1. Remove VPC creation code from api-stack.ts
2. Remove RDS database creation
3. Remove ElastiCache creation
4. Remove associated security groups
5. Deploy API stack to remove old resources

```bash
# This will delete the old resources
pnpm cdk deploy Postolio-API-dev
```

## Rollback Plan

If issues arise during migration:

### Quick Rollback
1. Revert code changes in git
2. Deploy previous version of stacks
3. Restore from RDS snapshot if needed

### Gradual Rollback
1. Keep both old and new infrastructure running
2. Switch back to old resources via SSM parameter updates
3. Fix issues in new infrastructure
4. Retry migration

## Environment-Specific Considerations

### Development
- Can afford downtime for migration
- Test all changes thoroughly
- Document any issues for staging/prod

### Staging
- Schedule migration during low-traffic window
- Run parallel infrastructure if possible
- Validate with integration tests

### Production
- Use blue-green deployment strategy
- Maintain old infrastructure until new is proven
- Have database failover ready
- Monitor closely for 24-48 hours post-migration

## Post-Migration Tasks

- [ ] Update documentation
- [ ] Update CI/CD pipelines
- [ ] Train team on new architecture
- [ ] Set up monitoring for new Foundation stack
- [ ] Document new SSM parameters
- [ ] Update disaster recovery procedures

## Troubleshooting

### Common Issues and Solutions

#### VPC Lookup Fails
```
Error: Could not find VPC
Solution: Ensure Foundation stack is deployed and SSM parameters exist
```

#### Lambda Cannot Connect to Database
```
Error: Connection timeout
Solution: Check security group rules and VPC endpoints
```

#### ECS Tasks Cannot Start
```
Error: No container instances
Solution: Verify ECS cluster is using correct VPC and subnets
```

## Benefits After Migration

1. **Faster Deployments**: ~40% reduction in deployment time
2. **Better Resource Sharing**: All stacks use same VPC/database
3. **Cost Optimization**: Single NAT Gateway, shared resources
4. **Improved Security**: Centralized security groups and KMS keys
5. **Easier Maintenance**: Clear separation of infrastructure and application

## Next Steps

After successful migration:

1. Monitor resource usage and costs
2. Optimize resource sizing based on metrics
3. Implement additional VPC endpoints for cost savings
4. Consider multi-region setup for production
5. Automate backup and disaster recovery procedures