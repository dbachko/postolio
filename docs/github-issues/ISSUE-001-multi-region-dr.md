# [CRITICAL] Implement Multi-Region Disaster Recovery Architecture

## 🚨 Critical Production Requirement

### Problem
The current architecture is **single-region only** (us-east-1), despite documentation claiming multi-region support. This creates a **critical single point of failure** with no disaster recovery capability.

### Business Impact
- **No disaster recovery** if us-east-1 fails
- **Extended downtime** (hours/days) in regional outage
- **Data loss risk** without cross-region replication
- **SLA violation** - Cannot achieve 99.99% availability target

### Current State
```
Current: Single region (us-east-1)
Expected: Multi-region with automatic failover
Gap: No cross-region infrastructure exists
```

### Required Implementation

#### 1. Primary Region (us-east-1) - Active
- All current infrastructure
- Real-time processing
- Primary database

#### 2. Secondary Region (us-west-2) - Passive
- Standby infrastructure
- Database replication
- Ready for failover

#### 3. Cross-Region Components

##### DynamoDB Global Tables
```typescript
// In CDK stack
const table = new dynamodb.Table(this, 'SchedulesTable', {
  tableName: 'content-scheduler-schedules',
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
  replicationRegions: ['us-west-2'], // Enable global table
  stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
});
```

##### Route 53 Health Checks
```typescript
const healthCheck = new route53.HealthCheck(this, 'PrimaryHealthCheck', {
  type: route53.HealthCheckType.HTTPS,
  resourcePath: '/health',
  fullQualifiedDomainName: 'api.postolio.example',
  failureThreshold: 3,
});

const recordSet = new route53.RecordSet(this, 'ApiRecord', {
  recordType: route53.RecordType.A,
  target: route53.RecordTarget.fromAlias(new targets.ApiGatewayDomain(primaryApi)),
  setIdentifier: 'Primary',
  region: 'us-east-1',
  healthCheckId: healthCheck.healthCheckId,
});
```

##### S3 Cross-Region Replication
```typescript
const bucket = new s3.Bucket(this, 'ContentBucket', {
  versioned: true,
  replicationConfiguration: {
    role: replicationRole.roleArn,
    rules: [{
      id: 'ReplicateAll',
      status: 'Enabled',
      destination: {
        bucket: `arn:aws:s3:::${bucketName}-us-west-2`,
        replicationTime: { status: 'Enabled', time: 15 },
        metrics: { status: 'Enabled', eventThreshold: 15 },
      },
    }],
  },
});
```

### Failover Strategy

#### Automatic Failover (< 5 minutes)
1. Route 53 health check detects primary failure
2. DNS automatically routes to secondary region
3. Secondary region activates
4. Notifications sent to ops team

#### Manual Failover Process
```bash
# 1. Verify primary region failure
aws cloudwatch get-metric-statistics \
  --namespace AWS/Route53 \
  --metric-name HealthCheckStatus \
  --dimensions Name=HealthCheckId,Value=HEALTH_CHECK_ID

# 2. Update Route 53 weighted routing
aws route53 change-resource-record-sets \
  --hosted-zone-id ZONE_ID \
  --change-batch file://failover.json

# 3. Activate secondary region
aws lambda update-alias \
  --function-name content-scheduler-api \
  --region us-west-2 \
  --name PROD \
  --function-version ACTIVE
```

### Testing Requirements

#### DR Drill Checklist
- [ ] Test failover to secondary region
- [ ] Verify data consistency
- [ ] Measure failover time (target < 5 min)
- [ ] Test failback to primary
- [ ] Validate no data loss

### Files to Modify

1. **aws-infrastructure/lib/scheduler/content-scheduler-stack.ts**
   - Add multi-region configuration
   - Implement global tables
   - Add Route 53 setup

2. **scripts/deploy-production.sh**
   - Add secondary region deployment
   - Include health check configuration

3. **scripts/rollback-production.sh**
   - Add cross-region rollback logic

4. **docs/production-runbook.md**
   - Update with actual DR procedures
   - Add failover runbook

### Success Criteria
- [ ] Both regions deployed and synchronized
- [ ] Automatic failover working (< 5 minutes)
- [ ] Zero data loss during failover
- [ ] Successful DR test completed
- [ ] Documentation updated with procedures

### Estimated Effort
- **Development**: 3-5 days
- **Testing**: 2-3 days
- **Documentation**: 1 day
- **Total**: 1-2 weeks

### References
- [AWS Multi-Region Application Architecture](https://aws.amazon.com/solutions/implementations/multi-region-application-architecture/)
- [DynamoDB Global Tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html)
- [Route 53 Failover Routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-failover.html)

### Priority
**🔴 CRITICAL** - Required before production deployment

### Labels
`critical`, `architecture`, `disaster-recovery`, `multi-region`, `production-blocker`