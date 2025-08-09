# AWS Deployment Strategy for Postolio

This document outlines the complete AWS deployment strategy for the Postolio application, including infrastructure architecture, deployment process, and operational considerations.

## Architecture Overview

The Postolio application is deployed on AWS using a containerized microservices architecture with the following components:

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

## Custom Domain Configuration (postolio.example)

The infrastructure supports custom domain configuration for production deployment. For the postolio.example domain:

### Prerequisites
1. **Domain ownership**: Ensure you own the postolio.example domain
2. **Route 53 hosted zone**: Create a hosted zone for postolio.example in Route 53
3. **DNS delegation**: Point your domain's nameservers to Route 53

### Domain Setup Steps

#### 1. Create Route 53 Hosted Zone
```bash
# Create hosted zone (if not exists)
aws route53 create-hosted-zone \
    --name postolio.example \
    --caller-reference "postol-io-$(date +%s)"

# Get the hosted zone ID
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
    --dns-name postolio.example \
    --query 'HostedZones[0].Id' \
    --output text | sed 's|/hostedzone/||')

echo "Hosted Zone ID: $HOSTED_ZONE_ID"
```

#### 2. Deploy with Custom Domain
```bash
# Set environment variables
export DOMAIN_NAME="postolio.example"
export HOSTED_ZONE_ID="YOUR_HOSTED_ZONE_ID"

# Deploy production environment
./scripts/deploy-aws.sh prod
```

#### 3. DNS Propagation
- SSL certificate will be automatically requested via ACM
- DNS validation records will be automatically created
- Certificate validation may take 5-30 minutes
- Full DNS propagation can take up to 48 hours

### Configuration Details

The custom domain setup includes:
- **ACM SSL Certificate**: Automatically provisioned and validated
- **Route 53 A Record**: Points postolio.example to CloudFront
- **CloudFront Custom Domain**: Configured with SSL certificate
- **Instagram Redirect URI**: Updated to use custom domain

### Verification

After deployment:
```bash
# Check SSL certificate status
aws acm list-certificates --region us-east-1 \
    --query 'CertificateSummaryList[?DomainName==`postolio.example`]'

# Test domain resolution
nslookup postolio.example

# Test HTTPS connection
curl -I https://postolio.example
```

### External DNS Provider Setup (Non-Route 53)

If your domain is **NOT** hosted on Route 53 (e.g., Cloudflare, Namecheap, GoDaddy, etc.), you can still use custom domains with the following setup:

#### Prerequisites
1. **Domain ownership**: You must own the domain (e.g., postolio.example)
2. **DNS provider access**: Ability to create DNS records with your provider
3. **Email access**: Access to admin@/webmaster@ emails for SSL validation

#### Deployment Steps

1. **Deploy with External DNS Flag**:
```bash
# Set your custom domain
export DOMAIN_NAME="postolio.example"

# Deploy using external DNS script
./scripts/deploy-external-dns.sh prod
```

2. **SSL Certificate Validation**:
   - AWS will send validation emails to:
     - `admin@postolio.example`
     - `webmaster@postolio.example`
   - Click the validation link in the email
   - Certificate will be provisioned automatically

3. **Create DNS Record**:
After deployment, create this DNS record with your provider:
```
Type: CNAME
Name: postolio.example
Value: [CloudFront distribution domain from deployment output]
TTL: 300 (or your provider's minimum)
```

4. **Wait for Propagation**:
   - DNS changes can take 5 minutes to 48 hours
   - Use `nslookup postolio.example` to verify

#### External DNS Deployment Options

```bash
# Quick deployment with external DNS
export DOMAIN_NAME="postolio.example"
./scripts/deploy-external-dns.sh prod

# Manual deployment with external DNS flag
export DOMAIN_NAME="postolio.example"
export USE_EXTERNAL_DNS=true
./scripts/deploy-aws.sh prod
```

#### Supported External DNS Providers
- Cloudflare
- Namecheap
- GoDaddy
- Network Solutions
- Any DNS provider that supports CNAME records

#### Verification Commands
```bash
# Check DNS resolution
nslookup postolio.example

# Test HTTPS connection
curl -I https://postolio.example

# Check certificate
openssl s_client -connect postolio.example:443 -servername postolio.example
```

### Default CloudFront Domain Fallback

If custom domain is not configured, the application will use the default CloudFront domain:
- Format: `d1234567890abc.cloudfront.net`
- Automatically configured and ready to use
- Full HTTPS support included

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
   - User name: `postolio-github-actions`
   - Select "Programmatic access"
3. **Attach Permissions**:
   - Create and attach the following secure IAM policy that passes AWS validation:

> [!NOTE]
> This policy has been designed to address AWS security validation warnings by:
> - Removing wildcard actions like `iam:*`, `ec2:*`, etc.
> - Implementing explicit PassRole permissions with service conditions
> - Scoping resources where possible to prevent overly permissive access
> - Following the principle of least privilege
> - Using correct AWS IAM action names (e.g., `s3:DeleteBucketCors` instead of `s3:DeleteBucketCORS`)
> - Replacing deprecated CloudFront Origin Access Identity actions with Origin Access Control actions

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CloudFormationAccess",
            "Effect": "Allow",
            "Action": [
                "cloudformation:CreateStack",
                "cloudformation:UpdateStack",
                "cloudformation:DeleteStack",
                "cloudformation:DescribeStacks",
                "cloudformation:DescribeStackEvents",
                "cloudformation:DescribeStackResources",
                "cloudformation:GetTemplate",
                "cloudformation:ListStacks",
                "cloudformation:ValidateTemplate"
            ],
            "Resource": "*"
        },
        {
            "Sid": "IAMRoleAccess",
            "Effect": "Allow",
            "Action": [
                "iam:CreateRole",
                "iam:DeleteRole",
                "iam:GetRole",
                "iam:UpdateRole",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "iam:PutRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:GetRolePolicy",
                "iam:TagRole",
                "iam:UntagRole"
            ],
            "Resource": "arn:aws:iam::*:role/Postolio*"
        },
        {
            "Sid": "IAMPassRoleSpecific",
            "Effect": "Allow",
            "Action": [
                "iam:PassRole"
            ],
            "Resource": "arn:aws:iam::*:role/Postolio*",
            "Condition": {
                "StringEquals": {
                    "iam:PassedToService": [
                        "ecs-tasks.amazonaws.com",
                        "application-autoscaling.amazonaws.com"
                    ]
                }
            }
        },
        {
            "Sid": "ECSAccess",
            "Effect": "Allow",
            "Action": [
                "ecs:CreateCluster",
                "ecs:DeleteCluster",
                "ecs:DescribeClusters",
                "ecs:CreateService",
                "ecs:DeleteService",
                "ecs:DescribeServices",
                "ecs:UpdateService",
                "ecs:RegisterTaskDefinition",
                "ecs:DeregisterTaskDefinition",
                "ecs:DescribeTaskDefinition",
                "ecs:ListTasks",
                "ecs:DescribeTasks",
                "ecs:TagResource",
                "ecs:UntagResource"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ECRAccess",
            "Effect": "Allow",
            "Action": [
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:CreateRepository",
                "ecr:DeleteRepository",
                "ecr:DescribeRepositories",
                "ecr:GetAuthorizationToken",
                "ecr:GetDownloadUrlForLayer",
                "ecr:GetRepositoryPolicy",
                "ecr:InitiateLayerUpload",
                "ecr:PutImage",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload"
            ],
            "Resource": "*"
        },
        {
            "Sid": "VPCAndNetworking",
            "Effect": "Allow",
            "Action": [
                "ec2:CreateVpc",
                "ec2:DeleteVpc",
                "ec2:DescribeVpcs",
                "ec2:CreateSubnet",
                "ec2:DeleteSubnet",
                "ec2:DescribeSubnets",
                "ec2:CreateSecurityGroup",
                "ec2:DeleteSecurityGroup",
                "ec2:DescribeSecurityGroups",
                "ec2:AuthorizeSecurityGroupIngress",
                "ec2:AuthorizeSecurityGroupEgress",
                "ec2:RevokeSecurityGroupIngress",
                "ec2:RevokeSecurityGroupEgress",
                "ec2:CreateInternetGateway",
                "ec2:DeleteInternetGateway",
                "ec2:AttachInternetGateway",
                "ec2:DetachInternetGateway",
                "ec2:DescribeInternetGateways",
                "ec2:CreateNatGateway",
                "ec2:DeleteNatGateway",
                "ec2:DescribeNatGateways",
                "ec2:CreateRouteTable",
                "ec2:DeleteRouteTable",
                "ec2:DescribeRouteTables",
                "ec2:CreateRoute",
                "ec2:DeleteRoute",
                "ec2:AssociateRouteTable",
                "ec2:DisassociateRouteTable",
                "ec2:AllocateAddress",
                "ec2:ReleaseAddress",
                "ec2:DescribeAddresses",
                "ec2:DescribeAvailabilityZones",
                "ec2:CreateTags",
                "ec2:DescribeTags"
            ],
            "Resource": "*"
        },
        {
            "Sid": "RDSAccess",
            "Effect": "Allow",
            "Action": [
                "rds:CreateDBInstance",
                "rds:DeleteDBInstance",
                "rds:DescribeDBInstances",
                "rds:ModifyDBInstance",
                "rds:CreateDBSubnetGroup",
                "rds:DeleteDBSubnetGroup",
                "rds:DescribeDBSubnetGroups",
                "rds:AddTagsToResource",
                "rds:RemoveTagsFromResource",
                "rds:ListTagsForResource"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ElastiCacheAccess",
            "Effect": "Allow",
            "Action": [
                "elasticache:CreateCacheCluster",
                "elasticache:DeleteCacheCluster",
                "elasticache:DescribeCacheClusters",
                "elasticache:ModifyCacheCluster",
                "elasticache:CreateCacheSubnetGroup",
                "elasticache:DeleteCacheSubnetGroup",
                "elasticache:DescribeCacheSubnetGroups",
                "elasticache:AddTagsToResource",
                "elasticache:RemoveTagsFromResource",
                "elasticache:ListTagsForResource"
            ],
            "Resource": "*"
        },
        {
            "Sid": "LoadBalancerAccess",
            "Effect": "Allow",
            "Action": [
                "elasticloadbalancing:CreateLoadBalancer",
                "elasticloadbalancing:DeleteLoadBalancer",
                "elasticloadbalancing:DescribeLoadBalancers",
                "elasticloadbalancing:ModifyLoadBalancerAttributes",
                "elasticloadbalancing:CreateTargetGroup",
                "elasticloadbalancing:DeleteTargetGroup",
                "elasticloadbalancing:DescribeTargetGroups",
                "elasticloadbalancing:ModifyTargetGroupAttributes",
                "elasticloadbalancing:CreateListener",
                "elasticloadbalancing:DeleteListener",
                "elasticloadbalancing:DescribeListeners",
                "elasticloadbalancing:AddTags",
                "elasticloadbalancing:RemoveTags"
            ],
            "Resource": "*"
        },
        {
            "Sid": "S3Access",
            "Effect": "Allow",
            "Action": [
                "s3:CreateBucket",
                "s3:DeleteBucket",
                "s3:GetBucketLocation",
                "s3:GetBucketPolicy",
                "s3:PutBucketPolicy",
                "s3:DeleteBucketPolicy",
                "s3:GetBucketVersioning",
                "s3:PutBucketVersioning",
                "s3:GetBucketWebsite",
                "s3:PutBucketWebsite",
                "s3:DeleteBucketWebsite",
                "s3:GetBucketCors",
                "s3:PutBucketCors",
                "s3:DeleteBucketCors",
                "s3:PutBucketTagging",
                "s3:GetBucketTagging",
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:ListBucket",
                "s3:PutBucketNotification"
            ],
            "Resource": [
                "arn:aws:s3:::postolio-*",
                "arn:aws:s3:::postolio-*/*",
                "arn:aws:s3:::cdk-*",
                "arn:aws:s3:::cdk-*/*"
            ]
        },
        {
            "Sid": "CloudFrontAccess",
            "Effect": "Allow",
            "Action": [
                "cloudfront:CreateDistribution",
                "cloudfront:UpdateDistribution",
                "cloudfront:DeleteDistribution",
                "cloudfront:GetDistribution",
                "cloudfront:GetDistributionConfig",
                "cloudfront:ListDistributions",
                "cloudfront:CreateOriginAccessControl",
                "cloudfront:DeleteOriginAccessControl",
                "cloudfront:GetOriginAccessControl",
                "cloudfront:ListOriginAccessControls",
                "cloudfront:CreateInvalidation",
                "cloudfront:GetInvalidation",
                "cloudfront:ListInvalidations",
                "cloudfront:TagResource",
                "cloudfront:UntagResource"
            ],
            "Resource": "*"
        },
        {
            "Sid": "SecretsManagerAccess",
            "Effect": "Allow",
            "Action": [
                "secretsmanager:CreateSecret",
                "secretsmanager:DeleteSecret",
                "secretsmanager:DescribeSecret",
                "secretsmanager:GetSecretValue",
                "secretsmanager:PutSecretValue",
                "secretsmanager:UpdateSecret",
                "secretsmanager:TagResource",
                "secretsmanager:UntagResource"
            ],
            "Resource": "arn:aws:secretsmanager:*:*:secret:postolio-*"
        },
        {
            "Sid": "CloudWatchLogsAccess",
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:DeleteLogGroup",
                "logs:DescribeLogGroups",
                "logs:CreateLogStream",
                "logs:DeleteLogStream",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents",
                "logs:PutRetentionPolicy",
                "logs:TagLogGroup",
                "logs:UntagLogGroup"
            ],
            "Resource": "arn:aws:logs:*:*:log-group:/aws/ecs/postolio*"
        },
        {
            "Sid": "AutoScalingAccess",
            "Effect": "Allow",
            "Action": [
                "application-autoscaling:RegisterScalableTarget",
                "application-autoscaling:DeregisterScalableTarget",
                "application-autoscaling:DescribeScalableTargets",
                "application-autoscaling:PutScalingPolicy",
                "application-autoscaling:DeleteScalingPolicy",
                "application-autoscaling:DescribeScalingPolicies"
            ],
            "Resource": "*"
        },
        {
            "Sid": "SSMAccess",
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameter",
                "ssm:GetParameters",
                "ssm:PutParameter",
                "ssm:DeleteParameter",
                "ssm:DescribeParameters"
            ],
            "Resource": "arn:aws:ssm:*:*:parameter/cdk-bootstrap/*"
        },
        {
            "Sid": "STSAccess",
            "Effect": "Allow",
            "Action": [
                "sts:AssumeRole"
            ],
            "Resource": "arn:aws:iam::*:role/cdk-*"
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

The IAM policy above follows AWS security best practices and addresses validation warnings:

- **Principle of Least Privilege**: Each statement grants only the minimum permissions required for specific services
- **Resource Scoping**: Where possible, permissions are restricted to specific resource patterns (e.g., `postolio-*` for S3 buckets and secrets)
- **Explicit IAM PassRole**: PassRole permissions are explicitly scoped to Postolio roles with service conditions to prevent overly permissive access
- **Service Binding**: IAM roles can only be passed to specific AWS services (`ecs-tasks.amazonaws.com`, `application-autoscaling.amazonaws.com`)
- **No Wildcard Actions**: Replaced `iam:*`, `ec2:*`, etc. with specific action lists to avoid security validation warnings
- **Key Rotation**: Regularly rotate the IAM user's access keys
- **Monitoring**: Enable CloudTrail to monitor API usage
- **Environment Separation**: Consider using separate AWS accounts for dev/staging/prod

#### Security Improvements in This Policy

- ✅ **No wildcards in IAM actions**: Replaced `iam:*` with specific IAM actions
- ✅ **Scoped PassRole permissions**: PassRole limited to Postolio roles with service conditions
- ✅ **Resource constraints**: S3, Secrets Manager, and CloudWatch Logs limited to Postolio resources
- ✅ **Service-specific permissions**: Each AWS service has tailored permissions instead of broad wildcards
- ✅ **CDK bootstrap support**: Includes necessary permissions for CDK deployment without over-privileging

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
aws logs tail /aws/ecs/postolio --follow

# Check ECS service status
aws ecs describe-services --cluster Postolio-prod --services PostolioService

# View CloudFormation stack events
aws cloudformation describe-stack-events --stack-name Postolio-prod

# Connect to database (with bastion host)
psql postgresql://username:password@db-endpoint:5432/postolio
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
