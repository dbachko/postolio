# [CRITICAL] Configure Lambda Functions with VPC Isolation

## 🚨 Security Requirement

### Problem
All Lambda functions are currently deployed **without VPC configuration**, exposing them to potential security risks. Functions have direct internet access and are not network-isolated, violating enterprise security best practices.

### Security Impact
- **Network exposure** - Functions accessible from public internet
- **No network segmentation** - Cannot restrict traffic between components
- **Compliance violation** - Fails SOC2/PCI requirements for network isolation
- **Data exfiltration risk** - No control over outbound traffic
- **Missing defense in depth** - No network-level security controls

### Current State vs Required
```
Current: Lambda functions with public internet access
Required: Lambda functions in private VPC subnets
Gap: No VPC configuration implemented
```

### Required Implementation

#### 1. VPC Architecture

```typescript
// aws-infrastructure/lib/scheduler/content-scheduler-stack.ts

import * as ec2 from 'aws-cdk-lib/aws-ec2';

// Create VPC with proper subnet configuration
const vpc = new ec2.Vpc(this, 'SchedulerVPC', {
  maxAzs: 2,
  natGateways: 2, // HA NAT gateways
  subnetConfiguration: [
    {
      name: 'Public',
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 24,
    },
    {
      name: 'Private',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      cidrMask: 24,
    },
    {
      name: 'Isolated',
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      cidrMask: 24,
    },
  ],
  flowLogs: {
    'VPCFlowLogs': {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
      trafficType: ec2.FlowLogTrafficType.ALL,
    },
  },
});
```

#### 2. Security Groups Configuration

```typescript
// Create security groups for different components
const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSG', {
  vpc,
  description: 'Security group for Lambda functions',
  allowAllOutbound: false, // Explicit outbound rules
});

// Allow HTTPS outbound for AWS services
lambdaSecurityGroup.addEgressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(443),
  'Allow HTTPS to AWS services'
);

// Allow connection to RDS
const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RDSSG', {
  vpc,
  description: 'Security group for RDS',
});

rdsSecurityGroup.addIngressRule(
  lambdaSecurityGroup,
  ec2.Port.tcp(5432),
  'Allow PostgreSQL from Lambda'
);
```

#### 3. Lambda VPC Configuration

```typescript
// Configure Lambda with VPC
const apiLambda = new lambda.Function(this, 'ApiHandler', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda'),
  vpc: vpc,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
  },
  securityGroups: [lambdaSecurityGroup],
  environment: {
    // Environment variables
  },
  // Performance optimization for VPC
  reservedConcurrentExecutions: 100,
});

// Add VPC endpoints for AWS services to avoid internet routing
const s3Endpoint = vpc.addGatewayEndpoint('S3Endpoint', {
  service: ec2.GatewayVpcEndpointAwsService.S3,
});

const dynamoEndpoint = vpc.addGatewayEndpoint('DynamoEndpoint', {
  service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
});

// Interface endpoints for other services
const secretsEndpoint = vpc.addInterfaceEndpoint('SecretsEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
  subnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
  },
});
```

#### 4. NAT Gateway Configuration

```typescript
// Configure NAT instances for cost optimization (optional)
const natInstance = new ec2.NatProvider.instance({
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
  keyName: 'nat-instance-key',
});

// Or use managed NAT Gateway (recommended for production)
const natGateway = new ec2.NatProvider.gateway();
```

### Network Architecture Diagram

```
Internet Gateway
      |
  [Public Subnet]
      |
  NAT Gateway
      |
  [Private Subnet] <-- Lambda Functions here
      |
  [Isolated Subnet] <-- RDS/ElastiCache here
```

### Performance Considerations

#### Cold Start Mitigation
```typescript
// 1. Use provisioned concurrency for critical functions
const alias = new lambda.Alias(this, 'ProdAlias', {
  aliasName: 'prod',
  version: apiLambda.currentVersion,
  provisionedConcurrentExecutions: 5,
});

// 2. Optimize ENI management
const lambdaWithOptimizedENI = new lambda.Function(this, 'OptimizedLambda', {
  // ... other config
  vpc: vpc,
  allowPublicSubnet: false,
  filesystem: lambda.FileSystem.fromEfsAccessPoint(
    accessPoint,
    '/mnt/efs'
  ), // Share ENI across invocations
});
```

### Migration Strategy

#### Phase 1: Development Environment
1. Deploy VPC in development
2. Configure Lambda functions
3. Test connectivity
4. Measure performance impact

#### Phase 2: Staging Environment
1. Deploy to staging
2. Load testing with VPC
3. Optimize cold starts
4. Validate security groups

#### Phase 3: Production Deployment
1. Deploy VPC infrastructure
2. Migrate Lambda functions
3. Monitor performance
4. Adjust capacity

### Testing Requirements

- [ ] Verify Lambda can access DynamoDB
- [ ] Verify Lambda can access Secrets Manager
- [ ] Verify Lambda can access S3
- [ ] Test external API calls work
- [ ] Measure cold start impact
- [ ] Validate security group rules
- [ ] Test failover scenarios

### Files to Modify

1. **aws-infrastructure/lib/scheduler/content-scheduler-stack.ts**
   - Add VPC creation
   - Configure security groups
   - Update Lambda definitions

2. **aws-infrastructure/lib/constructs/lambda-construct.ts**
   - Add VPC configuration helper
   - Implement ENI optimization

3. **scripts/deploy-production.sh**
   - Add VPC validation checks
   - Include network testing

### Success Criteria

- [ ] All Lambda functions in private subnets
- [ ] Security groups properly configured
- [ ] VPC endpoints operational
- [ ] No performance degradation > 10%
- [ ] Flow logs enabled and monitored
- [ ] Network segmentation validated

### Performance Benchmarks

| Metric | Without VPC | With VPC | Acceptable |
|--------|-------------|----------|------------|
| Cold Start | ~200ms | ~400ms | < 500ms |
| Warm Start | ~50ms | ~50ms | < 100ms |
| P99 Latency | 1.5s | 1.8s | < 2s |

### Cost Impact

- **NAT Gateway**: ~$45/month per gateway (2 for HA = $90)
- **VPC Endpoints**: ~$10/month per endpoint
- **Data Transfer**: ~$0.09/GB for NAT processing
- **Total Estimated**: ~$150/month additional

### Estimated Effort

- **Development**: 2-3 days
- **Testing**: 2 days
- **Migration**: 1 day
- **Total**: 1 week

### References

- [Lambda VPC Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [VPC Security Best Practices](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-best-practices.html)
- [Optimizing Lambda Performance in VPC](https://aws.amazon.com/blogs/compute/optimizing-lambda-performance-for-your-vpc-configuration/)

### Priority

**🔴 CRITICAL** - Security requirement for production

### Labels

`critical`, `security`, `vpc`, `lambda`, `production-blocker`, `networking`