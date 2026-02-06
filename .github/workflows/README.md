# CI/CD Workflows Documentation

## Overview

This directory contains GitHub Actions workflows for the Postolio monorepo, implementing a sophisticated CI/CD pipeline with microservices support, intelligent change detection, and automated deployments.

## Workflow Files

### 🚀 deploy.yml - Main Deployment Pipeline

**Trigger:** Manual dispatch (`workflow_dispatch`) only

**Key Features:**

- **Manual Deploys From UI:** Run from the GitHub Actions UI with an explicit `ref` (branch/tag/SHA)
- **Environment Selection:** Choose `dev`, `staging`, or `prod` via workflow input
- **Docker Layer Caching:** Uses GitHub Actions cache for faster builds
- **CDK Integration:** Deploys infrastructure as code without manual installation

**Jobs:**

1. `detect-changes` - Plans the deploy (environment, stacks, images, resolved commit SHA)
2. `build-images` - Builds and pushes Docker images to ECR (or no-ops)
3. `deploy-stacks` - Deploys CDK stacks (sequentially)
4. `deploy-frontend` - Builds and deploys the React app to S3/CloudFront
5. `deployment-summary` - Generates deployment report

### ✅ pr-checks.yml - Pull Request Validation

**Trigger:** Pull request events

**Jobs:**

1. `detect-changes` - Identifies changed packages
2. `code-quality` - Linting, type checking, formatting
3. `unit-tests` - Tests with coverage reporting
4. `build-validation` - Ensures packages build successfully
5. `security-scan` - Trivy vulnerability scanning
6. `cdk-diff` - Shows infrastructure changes
7. `pr-summary` - Comments PR with check results

### 🧹 cleanup.yml - Resource Cleanup

**Trigger:** Daily at 2 AM UTC or manual

**Cleanup Tasks:**

1. **ECR Images:** Removes images older than retention period
2. **Lambda Versions:** Keeps only last 10 versions
3. **CloudWatch Logs:** Deletes old/empty log streams
4. **Dry Run Mode:** Test cleanup without deletion

### 🧯 cleanup-failed-stacks.yml - Cleanup Failed CloudFormation Stacks

**Trigger:** Manual dispatch only

**Use Cases:**

- Delete stacks stuck in failed states (`ROLLBACK_COMPLETE`, `CREATE_FAILED`, `UPDATE_ROLLBACK_COMPLETE`)
- Cleanup a single stack by name or all failed stacks for an environment

## Environment Configuration

### GitHub Environments

Configure these environments in GitHub Settings:

- `dev` - Development environment
- `staging` - Staging environment
- `prod` - Production environment (requires approval)

### Required Secrets

```yaml
# AWS Credentials
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_ACCOUNT_ID

# API Keys
OPENAI_API_KEY
GOOGLE_GENERATIVE_AI_API_KEY
FACEBOOK_APP_SECRET
GOOGLE_CLIENT_SECRET

# Test Credentials (for E2E)
TEST_USER_EMAIL
TEST_USER_PASSWORD

# Optional
CODECOV_TOKEN
TURBO_TOKEN
```

### Required Variables

```yaml
# AWS Configuration
AWS_REGION: us-east-1

# Domain Configuration
DOMAIN_NAME: postolio.example
CORS_ORIGIN: https://postolio.example
VITE_API_URL: https://postolio.example

# OAuth Configuration
VITE_GOOGLE_CLIENT_ID: your-google-client-id
VITE_FACEBOOK_APP_ID: your-facebook-app-id

# Monitoring
ALERT_EMAIL: alerts@postolio.example
ENABLE_MONITORING: true

# Optional
TURBO_TEAM: your-turbo-team
LOG_LEVEL: info
DEFAULT_IMAGE_PROVIDER: gemini-2.5-flash
IMAGE_FALLBACK_ORDER: gemini-2.5-flash,dalle-3,gemini-3-pro
FB_OAUTH_DEBUG: false
```

> The Assets CDN domain defaults to `cdn.<apex-domain>` using the same hosted zone and certificate that power the app domain. Override via CDK context (`assetsCdnDomain`, `assetsCdnHostedZoneId`, etc.) only if you need a different hostname or DNS zone.

## Deployment Strategies

### Manual Deployment

```bash
# Deploy a specific ref to staging
gh workflow run deploy.yml -f ref=main -f environment=staging

# Deploy specific stacks (comma-separated or "all")
gh workflow run deploy.yml -f ref=1a2b3c4d -f environment=dev -f stacks="api,web"
```

## Performance Optimizations

### 1. Turbo Cache

- Remote caching with Turbo for faster builds
- Shared across all workflow runs
- Configure with `TURBO_TOKEN` and `TURBO_TEAM`

### 2. Docker Layer Caching

- Uses GitHub Actions cache
- Separate cache scopes per service
- BuildKit inline cache for maximum efficiency

### 3. Parallel Execution

- Microservices deploy concurrently (max 3)
- Independent job execution where possible
- Matrix strategy for similar operations

### 4. Intelligent Skipping

- Only builds/deploys changed services
- Skips unchanged packages in tests
- Uses `paths-filter` for accurate detection

## Monitoring & Alerts

### Deployment Notifications

- PR comments with check summaries
- Deployment reports in job summaries
- Production deployments create GitHub issues

### Health Checks

- Automatic health verification after deployments
- Rollback triggers health checks
- Service stabilization waiting

### Failure Handling

- Automatic rollback on deployment failure (prod only)
- Issue creation for failed rollbacks
- Slack/email notifications (configure in GitHub)

## Best Practices

### 1. Testing Strategy

- Unit tests run on every PR
- E2E tests run post-deployment (non-prod)
- Security scanning on every PR

### 2. Version Management

- Semantic versioning for releases
- Git SHA for Docker tags
- Lambda version aliases for rollback

### 3. Security

- Secrets stored in GitHub Secrets
- AWS IAM roles for service accounts
- Vulnerability scanning with Trivy

### 4. Cost Optimization

- Cleanup old resources automatically
- Conditional deployments save compute
- Efficient caching reduces build time

## Troubleshooting

### Common Issues

**1. CDK Bootstrap Required**

```bash
# Run locally if bootstrap fails
aws cdk bootstrap aws://ACCOUNT-ID/REGION
```

**2. ECR Repository Not Found**

```bash
# Create ECR repositories manually
aws ecr create-repository --repository-name postolio-api
aws ecr create-repository --repository-name postolio-web
```

**3. Lambda Deployment Fails**

```bash
# Check function exists
aws lambda get-function --function-name postolio-dev-service-name

# Deploy via CDK if missing
cd packages/infra/cdk
pnpm cdk deploy service-name-dev
```

**4. Change Detection Not Working**

- Ensure `fetch-depth: 0` in checkout
- Check base branch is correct
- Verify path filters match your structure

## Local Testing

### Test Workflows Locally

```bash
# Install act
brew install act

# Test deployment workflow
act -j deploy --secret-file .env.secrets

# Test with specific event
act pull_request -e event.json
```

### Validate Workflow Syntax

```bash
# GitHub CLI validation
gh workflow list
gh workflow view deploy.yml

# Validate all workflows
for workflow in .github/workflows/*.yml; do
  echo "Validating $workflow"
  gh workflow view $(basename $workflow)
done
```

## Contributing

### Adding a New Service

1. Add path to change detection in `deploy.yml`
2. Add service to deployment matrix
3. Create Dockerfile in service directory
4. Update CDK stack for Lambda/ECS deployment
5. Add to cleanup workflow if needed

### Modifying Workflows

1. Test changes in feature branch
2. Use `workflow_dispatch` for testing
3. Monitor first production deployment
4. Update this documentation

## Support

For issues or questions:

1. Check workflow run logs in GitHub Actions
2. Review CloudWatch logs for service logs
3. Create issue with `ci/cd` label
4. Contact DevOps team for infrastructure issues
