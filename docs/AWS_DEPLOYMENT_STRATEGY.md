# AWS Deployment Strategy for AI Agency

This document outlines the complete AWS deployment strategy for the AI Agency application, including infrastructure architecture, deployment process, and operational considerations.

## Architecture Overview

The AI Agency application is deployed on AWS using a containerized microservices architecture with the following components:

### AWS Services Used

- **ECS Fargate**: Serverless container orchestration for the backend API
- **RDS PostgreSQL**: Managed relational database
- **ElastiCache Redis**: In-memory caching and session storage
- **Application Load Balancer (ALB)**: Load balancing and SSL termination
- **S3**: Static website hosting for the frontend
- **CloudFront**: CDN for global content delivery
- **Secrets Manager**: Secure storage of API keys and sensitive configuration
- **CloudWatch**: Monitoring, logging, and alerting
- **ECR**: Container registry for Docker images
- **VPC**: Network isolation and security

### Architecture Diagram

```
Internet
    ↓
CloudFront (CDN)
    ↓
S3 (Frontend) ←→ ALB ←→ ECS Fargate (Backend)
                           ↓
                    RDS PostgreSQL + ElastiCache Redis
```

## Infrastructure as Code

The infrastructure is defined using AWS CDK (Cloud Development Kit) in TypeScript, providing:

- **Version control**: Infrastructure changes are tracked in git
- **Reproducibility**: Identical environments across dev/staging/prod
- **Type safety**: TypeScript provides compile-time error checking
- **Modularity**: Reusable constructs and stacks

### Key Infrastructure Components

#### 1. Networking (VPC)
- **Public Subnets**: ALB and NAT gateways
- **Private Subnets**: ECS tasks with internet access via NAT
- **Isolated Subnets**: Databases without internet access
- **Security Groups**: Granular network access control

#### 2. Container Platform (ECS Fargate)
- **Serverless**: No EC2 instances to manage
- **Auto-scaling**: CPU and memory-based scaling
- **Health checks**: Automatic replacement of unhealthy tasks
- **Load balancing**: Traffic distribution across multiple tasks

#### 3. Database Layer
- **RDS PostgreSQL**: Multi-AZ for high availability in production
- **ElastiCache Redis**: Single-node for cost optimization in dev
- **Backup retention**: 7 days in production, 1 day in development
- **Security**: Database access only from ECS security group

#### 4. Frontend Hosting
- **S3 Static Website**: Cost-effective hosting for React SPA
- **CloudFront**: Global CDN with edge caching
- **Custom error pages**: SPA routing support
- **Gzip compression**: Reduced bandwidth and faster loading

## Deployment Process

### 1. Automated CI/CD Pipeline

The deployment uses GitHub Actions with the following stages:

```yaml
Test → Build → Deploy Infrastructure → Deploy Frontend → Notify
```

#### Test Stage
- Unit and integration tests
- Linting and type checking
- Database migrations in test environment

#### Build Stage
- Backend TypeScript compilation
- Frontend React build
- Docker image creation and push to ECR

#### Deploy Infrastructure Stage
- CDK stack deployment
- Database migrations
- Environment configuration

#### Deploy Frontend Stage
- Frontend build with production API URLs
- S3 upload with CloudFront invalidation

### 2. Manual Deployment

For manual deployments or local testing:

```bash
# Deploy to development environment
./scripts/deploy-aws.sh dev

# Deploy to production environment
./scripts/deploy-aws.sh prod

# Destroy infrastructure
./scripts/deploy-aws.sh prod destroy

# Update secrets only
./scripts/deploy-aws.sh prod update-secrets
```

## GitHub Actions CI/CD Setup

To enable the automated deployment pipeline, you need to configure AWS credentials in your GitHub repository secrets. The pipeline requires specific IAM permissions to deploy infrastructure and manage AWS resources.

### 1. Create IAM User for CI/CD

Create a dedicated IAM user with programmatic access for the GitHub Actions pipeline:

1. **Go to IAM Console**: https://console.aws.amazon.com/iam/
2. **Create User**:
   - User name: `ai-agency-github-actions`
   - Select "Programmatic access"
3. **Attach Permissions**:
   - Create and attach the following IAM policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "sts:AssumeRole",
                "iam:*",
                "ec2:*",
                "ecs:*",
                "ecr:*",
                "rds:*",
                "elasticache:*",
                "elasticloadbalancing:*",
                "cloudformation:*",
                "s3:*",
                "cloudfront:*",
                "secretsmanager:*",
                "logs:*",
                "application-autoscaling:*",
                "ssm:*"
            ],
            "Resource": "*"
        }
    ]
}
```

4. **Save Credentials**: Copy the Access Key ID and Secret Access Key

### 2. Configure GitHub Secrets

In your GitHub repository, go to **Settings > Secrets and variables > Actions** and add the following secrets:

| Secret Name | Description | How to Find |
|-------------|-------------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key | From IAM user creation step above |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key | From IAM user creation step above |
| `AWS_ACCOUNT_ID` | Your AWS account ID | Go to AWS Console > Account menu (top right) > Account |

### 3. Verify Setup

To verify your credentials are working:

1. **Push to main branch** - This triggers the deployment workflow
2. **Check Actions tab** - Monitor the workflow progress
3. **Review logs** - If there are issues, check the action logs for details

### 4. Security Best Practices

- **Principle of Least Privilege**: The IAM policy above grants broad permissions. For production, consider creating more restrictive policies based on your specific needs.
- **Key Rotation**: Regularly rotate the IAM user's access keys
- **Monitoring**: Enable CloudTrail to monitor API usage
- **Environment Separation**: Consider using separate AWS accounts for dev/staging/prod

### 5. Alternative: OIDC Provider (Recommended for Production)

For enhanced security, consider using GitHub's OIDC provider instead of long-lived credentials:

1. **Create OIDC Identity Provider** in AWS IAM
2. **Create IAM Role** with trust relationship to GitHub
3. **Update GitHub Actions** to use `aws-actions/configure-aws-credentials@v4` with `role-to-assume`

See [AWS documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html) for detailed OIDC setup.

### Common Issues

**"Credentials could not be loaded" Error**:
- Verify all three secrets are set in GitHub repository settings
- Check that the IAM user has the correct permissions
- Ensure there are no typos in the secret values
- Confirm the AWS account ID is correct (12-digit number)

**"Access Denied" Errors**:
- Review the IAM policy and add missing permissions
- Check if the region specified in the workflow matches your AWS setup
- Verify that the IAM user has permissions for the specific AWS services being used

## Environment Configuration

### Development Environment
- **Scaling**: Single task, no auto-scaling
- **Database**: t3.micro instance, 1-day backup retention
- **Cache**: Single Redis node
- **Costs**: ~$50-80/month

### Production Environment
- **Scaling**: 2-10 tasks with auto-scaling
- **Database**: Multi-AZ, 7-day backup retention
- **Cache**: Redis cluster with failover
- **Costs**: ~$200-500/month depending on traffic

### Environment Variables

#### Required Secrets (stored in AWS Secrets Manager)
```bash
DATABASE_URL          # Auto-generated from RDS
JWT_SECRET           # Auto-generated
OPENAI_API_KEY       # Must be manually set
FACEBOOK_APP_ID      # Must be manually set
FACEBOOK_APP_SECRET  # Must be manually set
```

#### Environment Configuration
```bash
NODE_ENV=production
PORT=3000
REDIS_URL            # Auto-configured from ElastiCache
INSTAGRAM_REDIRECT_URI  # Auto-configured with CloudFront domain
```

## Security Considerations

### Network Security
- **VPC isolation**: Database in private subnets
- **Security groups**: Principle of least privilege
- **NAT gateways**: Outbound internet access for updates

### Application Security
- **Secrets management**: No hardcoded credentials
- **JWT authentication**: Secure user sessions
- **HTTPS everywhere**: SSL/TLS for all traffic
- **CORS configuration**: Restricted cross-origin requests

### Access Control
- **IAM roles**: Task-specific permissions
- **Secret access**: Only ECS tasks can read secrets
- **Database access**: Restricted to ECS security group

## Monitoring and Observability

### Application Monitoring
- **CloudWatch Logs**: Centralized logging
- **Custom metrics**: Application-specific KPIs
- **Health checks**: Endpoint monitoring
- **Error tracking**: Failed request alerting

### Infrastructure Monitoring
- **Resource utilization**: CPU, memory, disk
- **Auto-scaling events**: Capacity changes
- **Database performance**: Query analysis
- **Cost monitoring**: Budget alerts

### Recommended Alerts
1. **High error rates** (>5% in 5 minutes)
2. **Database connection failures**
3. **High response times** (>2 seconds)
4. **Auto-scaling events**
5. **Cost budget exceeded**

## Backup and Disaster Recovery

### Database Backups
- **Automated snapshots**: Daily backups with retention
- **Point-in-time recovery**: Up to backup retention period
- **Cross-region backups**: For production environments

### Application Recovery
- **Multi-AZ deployment**: Automatic failover
- **Auto-scaling**: Replace failed instances
- **Immutable deployments**: Easy rollback capability

### Recovery Procedures
1. **Database recovery**: Restore from snapshot
2. **Application rollback**: Deploy previous container image
3. **Complete disaster**: Deploy to new region

## Cost Optimization

### Development Environment
- **Spot instances**: For non-critical workloads
- **Single AZ**: Reduce cross-AZ charges
- **Smaller instance types**: Right-size for dev workloads

### Production Environment
- **Reserved instances**: For predictable workloads
- **Auto-scaling**: Match capacity to demand
- **CloudFront caching**: Reduce origin requests

### Cost Monitoring
- **Budget alerts**: Prevent unexpected charges
- **Cost allocation tags**: Track resource usage
- **Regular reviews**: Optimize based on usage patterns

## Deployment Checklist

### Pre-Deployment
- [ ] AWS CLI configured with appropriate permissions
- [ ] Docker installed and running
- [ ] Node.js 20+ installed
- [ ] Repository cloned and dependencies installed

### Initial Setup
- [ ] CDK bootstrapped in target region
- [ ] ECR repository created
- [ ] Environment-specific configuration reviewed

### Deployment
- [ ] Infrastructure deployed successfully
- [ ] Database migrations completed
- [ ] Frontend deployed to S3/CloudFront
- [ ] Application secrets configured
- [ ] Health checks passing

### Post-Deployment
- [ ] Monitoring and alerting configured
- [ ] Backup procedures tested
- [ ] Domain name configured (if using custom domain)
- [ ] SSL certificate validated
- [ ] Performance testing completed

## Troubleshooting Guide

### Common Issues

#### Deployment Failures
1. **CDK bootstrap missing**: Run `cdk bootstrap`
2. **Insufficient permissions**: Check IAM roles
3. **Resource limits**: Verify AWS service quotas

#### Application Issues
1. **Database connection**: Check security groups
2. **Secret access**: Verify IAM permissions
3. **Health check failures**: Review application logs

#### Performance Issues
1. **High latency**: Check CloudWatch metrics
2. **Database slow queries**: Enable query insights
3. **Memory issues**: Adjust task definitions

### Useful Commands

```bash
# View application logs
aws logs tail /aws/ecs/ai-agency --follow

# Check ECS service status
aws ecs describe-services --cluster AiAgency-prod --services AiAgencyService

# View CloudFormation stack events
aws cloudformation describe-stack-events --stack-name AiAgency-prod

# Connect to database (with bastion host)
psql postgresql://username:password@db-endpoint:5432/aiagency
```

## Future Improvements

### Scalability Enhancements
- **Database read replicas**: Improve read performance
- **CDN optimization**: Advanced caching strategies
- **Container optimization**: Multi-stage builds, smaller images

### Security Enhancements
- **WAF integration**: Web application firewall
- **VPC endpoints**: Private AWS service access
- **Secrets rotation**: Automatic credential rotation

### Operational Improvements
- **Blue/green deployments**: Zero-downtime deployments
- **Canary releases**: Gradual feature rollouts
- **Infrastructure testing**: Automated compliance checks

### Cost Optimization
- **Spot instances**: For batch processing
- **S3 intelligent tiering**: Automatic storage optimization
- **CloudWatch insights**: Advanced log analysis

## Support and Maintenance

### Regular Tasks
- **Security updates**: Keep dependencies current
- **Performance reviews**: Monitor and optimize
- **Cost analysis**: Monthly cost reviews
- **Backup testing**: Verify recovery procedures

### Emergency Procedures
- **Incident response**: Clear escalation paths
- **Rollback procedures**: Quick recovery steps
- **Communication plan**: Stakeholder notifications

For detailed implementation instructions, see the deployment scripts in the `scripts/` directory and infrastructure code in `aws-infrastructure/`.