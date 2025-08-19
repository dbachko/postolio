# Postolio Infrastructure Architecture

## Overview

Postolio uses a modern AWS cloud-native architecture with microservices, serverless components, and enterprise-grade security. The infrastructure is managed using AWS CDK (Cloud Development Kit) for Infrastructure as Code.

## Architecture Components

### 1. ContentScheduler Microservice Stack

The ContentScheduler is a dedicated microservice responsible for content scheduling and publishing operations.

**Key Components:**
- **API Gateway**: RESTful API with JWT authorization
- **Lambda Functions**: 
  - Schedule Management Lambda
  - Publisher Lambda
  - Retry Handler Lambda
- **DynamoDB Tables**: Schedule storage with TTL
- **EventBridge Rules**: Automated scheduling triggers
- **Cognito User Pool**: OAuth2 authentication provider
- **CloudWatch**: Monitoring and alerting

### 2. Postolio Main Application Stack

The main application stack hosts the core Postolio platform.

**Key Components:**
- **VPC**: Multi-AZ with public/private subnets
- **ECS Fargate**: Containerized application hosting
- **Application Load Balancer**: HTTPS traffic distribution
- **RDS PostgreSQL**: Primary database (Multi-AZ in production)
- **ElastiCache Redis**: Session management and caching
- **S3 Buckets**: Static assets and AI-generated images
- **CloudFront CDN**: Global content delivery
- **Secrets Manager**: Secure credential storage

### 3. Cross-Stack Dependencies

The infrastructure uses AWS CDK cross-stack references for secure communication between stacks.

```typescript
// ContentScheduler exports its API endpoint and OAuth2 configuration
contentSchedulerStack.exportValue('api-endpoint', apiGateway.url);
contentSchedulerStack.exportValue('user-pool-id', userPool.userPoolId);

// Postolio imports these values
const schedulerApiUrl = Fn.importValue('ContentScheduler-dev-api-endpoint');
const userPoolId = Fn.importValue('ContentScheduler-dev-user-pool-id');
```

## Security Architecture

### OAuth2 Service-to-Service Authentication

Starting January 2025, all microservice communication uses OAuth2 Client Credentials Grant flow:

1. **Authentication Flow:**
   ```
   Postolio → Request Token → Cognito User Pool
   Cognito → Validate Credentials → Return JWT
   Postolio → API Request with JWT → ContentScheduler
   ContentScheduler → Validate JWT → Process Request
   ```

2. **Token Management:**
   - Tokens cached with 5-minute buffer before expiry
   - Automatic token refresh on expiration
   - Circuit breaker pattern for resilience

3. **Credential Storage:**
   - OAuth2 credentials stored in AWS Secrets Manager
   - Automatic rotation capability
   - Environment-specific isolation

### Network Security

- **VPC Isolation**: Private subnets for databases and cache
- **Security Groups**: Least-privilege network access
- **NACLs**: Additional network layer protection
- **WAF**: Web Application Firewall on CloudFront

### Data Protection

- **Encryption at Rest**: All databases and S3 buckets
- **Encryption in Transit**: TLS 1.2+ for all connections
- **KMS**: AWS Key Management Service for encryption keys
- **Secrets Rotation**: Automated credential rotation

## Deployment Architecture

### Environment Management

Three environments with isolated resources:
- **Development**: Rapid iteration and testing
- **Staging**: Pre-production validation
- **Production**: High availability and redundancy

### CI/CD Pipeline

```yaml
GitHub Actions Workflow:
  1. Code Push → GitHub
  2. Run Tests & Linting
  3. Build Docker Images
  4. Push to ECR
  5. CDK Synthesis & Validation
  6. Deploy ContentScheduler Stack
  7. Deploy Postolio Stack
  8. Health Checks
```

### Infrastructure as Code

All infrastructure is defined using AWS CDK v2:

```typescript
// Stack Organization
aws-infrastructure/
├── bin/
│   └── app.ts                    # Main CDK app entry point
├── lib/
│   ├── stacks/
│   │   └── postolio-stack.ts     # Main application stack
│   ├── scheduler/
│   │   ├── content-scheduler-stack.ts  # Microservice stack
│   │   └── lambda/                     # Lambda function code
│   └── utils/
│       └── cross-stack-utils.ts  # Cross-stack utilities
└── cdk.json                      # CDK configuration
```

## Scalability & Performance

### Auto-Scaling

- **ECS Services**: CPU/Memory-based auto-scaling
- **Lambda Functions**: Automatic scaling (0 to 1000 concurrent)
- **RDS**: Read replicas for read-heavy workloads
- **DynamoDB**: On-demand scaling

### Caching Strategy

```
User Request → CloudFront (Edge Cache)
                ↓ (Cache Miss)
             ALB → ECS Service
                    ↓
                 Redis Cache
                    ↓ (Cache Miss)
                 PostgreSQL
```

### Performance Targets

- **API Response Time**: < 200ms (p95)
- **Content Generation**: < 5s
- **Image Generation**: < 10s
- **Schedule Creation**: < 500ms
- **Cache Hit Rate**: > 80%

## Monitoring & Observability

### CloudWatch Dashboards

Custom dashboards for:
- Application metrics (requests, latency, errors)
- Infrastructure metrics (CPU, memory, network)
- Business metrics (content generated, schedules created)
- Cost metrics (service utilization)

### Alerting

SNS-based alerting for:
- High error rates (> 1% 5xx errors)
- Performance degradation (p95 latency > 1s)
- Resource exhaustion (> 80% utilization)
- Failed deployments
- Security events

### Logging

Centralized logging with CloudWatch Logs:
- Application logs (structured JSON)
- Access logs (ALB, CloudFront)
- Security logs (WAF, VPC Flow Logs)
- Audit logs (API Gateway, Lambda)

## Cost Optimization

### Strategies

1. **Right-Sizing**: Regular review of instance types
2. **Reserved Capacity**: RDS and ElastiCache reservations
3. **Spot Instances**: Development environment ECS tasks
4. **S3 Lifecycle**: Intelligent tiering for old content
5. **Lambda Optimization**: Memory and timeout tuning

### Estimated Monthly Costs (Production)

| Service | Estimated Cost |
|---------|---------------|
| ECS Fargate | $50-100 |
| RDS PostgreSQL | $50-150 |
| ElastiCache Redis | $25-50 |
| Lambda | $10-30 |
| DynamoDB | $5-15 |
| S3 & CloudFront | $20-50 |
| API Gateway | $10-20 |
| **Total** | **$170-415** |

*Note: Costs vary based on usage and scale*

## Disaster Recovery

### Backup Strategy

- **RDS**: Automated daily backups (7-day retention)
- **S3**: Cross-region replication for critical data
- **DynamoDB**: Point-in-time recovery enabled
- **Code**: Git repository with multiple remotes

### Recovery Objectives

- **RTO (Recovery Time Objective)**: < 1 hour
- **RPO (Recovery Point Objective)**: < 24 hours

### Failover Process

1. Detect failure via CloudWatch alarms
2. Promote RDS read replica (if database failure)
3. Update Route 53 DNS records
4. Deploy replacement infrastructure via CDK
5. Restore from latest backup
6. Validate service health

## Future Enhancements

### Planned Improvements

1. **Multi-Region Deployment**: Active-active configuration
2. **Kubernetes Migration**: EKS for container orchestration
3. **Service Mesh**: AWS App Mesh for microservice communication
4. **GraphQL API**: Federated GraphQL with AWS AppSync
5. **ML Pipeline**: SageMaker for custom AI models

### Roadmap

- **Q1 2025**: ✅ OAuth2 authentication implementation
- **Q2 2025**: Multi-region deployment
- **Q3 2025**: Kubernetes migration
- **Q4 2025**: Service mesh implementation
- **Q1 2026**: GraphQL API launch

## Related Documentation

- [AWS Deployment Strategy](./AWS_DEPLOYMENT_STRATEGY.md)
- [Security Architecture](./SECURITY.md)
- [API Documentation](./API_DOCUMENTATION.md)
- [Monitoring Guide](./MONITORING.md)

---

*Last Updated: January 2025*
*Version: 1.0.0*