# Environment Variables Architecture

## Overview

Postolio uses a hybrid approach for managing configuration:
- **GitHub Environment Variables**: Public configuration and environment-specific settings
- **AWS Secrets Manager**: Actual secrets and sensitive credentials

## GitHub Environment Variables (Public Configuration)

These are configured in GitHub → Settings → Environments → [dev/staging/prod]:

### Frontend Variables (Public)
| Variable | Description | Example | Environment-Specific |
|----------|-------------|---------|---------------------|
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client ID (public) | `123456789.apps.googleusercontent.com` | Yes |
| `VITE_FACEBOOK_APP_ID` | Facebook App ID (public) | `123456789` | Yes |
| `VITE_API_URL` | API endpoint URL | `https://postolio.example` | Yes |
| `VITE_SENTRY_DSN` | Sentry error tracking (public) | `https://key@sentry.io/project` | Yes |
| `VITE_GA_TRACKING_ID` | Google Analytics ID | `G-XXXXXXXXXX` | Yes |
| `VITE_FEATURE_VIDEO_SUPPORT` | Feature flag for video | `true` / `false` | Yes |
| `VITE_FEATURE_AI_SUGGESTIONS` | Feature flag for AI | `true` / `false` | Yes |
| `VITE_CDN_URL` | CDN endpoint for assets | `https://postolio.example` | Yes |

### Infrastructure Variables
| Variable | Description | Example | Environment-Specific |
|----------|-------------|---------|---------------------|
| `DOMAIN_NAME` | Primary domain | `postolio.example` | Yes |
| `ENVIRONMENT` | Environment name | `dev` / `staging` / `prod` | Yes |
| `AWS_REGION` | AWS region | `us-east-1` | No |
| `AWS_ACCOUNT_ID` | AWS account ID | `123456789012` | No |
| `ECR_REPOSITORY` | ECR repo name | `postolio` | No |
| `NODE_ENV` | Node environment | `production` | Yes |
| `LOG_LEVEL` | Logging verbosity | `info` / `debug` / `error` | Yes |
| `ENABLE_MONITORING` | Enable APM/monitoring | `true` / `false` | Yes |

### Backend Configuration (Non-Secret)
| Variable | Description | Example | Environment-Specific |
|----------|-------------|---------|---------------------|
| `REDIS_PORT` | Redis port | `6380` | No |
| `DATABASE_PORT` | PostgreSQL port | `5433` | No |
| `MAX_FILE_SIZE` | Max upload size | `10485760` (10MB) | Yes |
| `RATE_LIMIT_WINDOW` | Rate limit window (ms) | `60000` | Yes |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `100` | Yes |
| `CORS_ORIGIN` | CORS allowed origins | `https://postolio.example` | Yes |
| `SESSION_DURATION` | Session timeout (ms) | `86400000` (24h) | Yes |

## AWS Secrets Manager (Actual Secrets)

These remain in AWS Secrets Manager as they are sensitive:

### Authentication Secrets
- `JWT_SECRET` - JWT signing secret
- `REFRESH_TOKEN_SECRET` - Refresh token secret
- `SESSION_SECRET` - Session encryption secret

### OAuth Secrets (Backend Only)
- `GOOGLE_CLIENT_SECRET` - Google OAuth secret (never exposed to frontend)
- `FACEBOOK_APP_SECRET` - Facebook app secret (never exposed to frontend)

### Database Credentials
- `DATABASE_URL` - Full connection string with password
- `DATABASE_PASSWORD` - Database password
- `REDIS_AUTH` - Redis authentication password

### API Keys (Secret)
- `OPENAI_API_KEY` - OpenAI API key
- `STRIPE_SECRET_KEY` - Payment processing
- `SENDGRID_API_KEY` - Email service
- `AWS_SES_ACCESS_KEY` - Email sending
- `MIDJOURNEY_TOKEN` - Image generation

### Service Credentials
- `SENTRY_AUTH_TOKEN` - Sentry deployment token
- `DATADOG_API_KEY` - Monitoring service
- `SCHEDULER_CLIENT_SECRET` - Microservice auth

## Environment Setup Guide

### 1. Create GitHub Environments

```bash
# In GitHub UI: Settings → Environments
# Create three environments: dev, staging, prod
```

### 2. Configure Environment Variables

For each environment, add variables:

```bash
# Development Environment
VITE_GOOGLE_CLIENT_ID=dev-client-id.apps.googleusercontent.com
VITE_FACEBOOK_APP_ID=dev-app-id
VITE_API_URL=https://postolio.example
DOMAIN_NAME=postolio.example
ENVIRONMENT=dev
LOG_LEVEL=debug
ENABLE_MONITORING=false

# Staging Environment  
VITE_GOOGLE_CLIENT_ID=staging-client-id.apps.googleusercontent.com
VITE_FACEBOOK_APP_ID=staging-app-id
VITE_API_URL=https://postolio.example
DOMAIN_NAME=postolio.example
ENVIRONMENT=staging
LOG_LEVEL=info
ENABLE_MONITORING=true

# Production Environment
VITE_GOOGLE_CLIENT_ID=prod-client-id.apps.googleusercontent.com
VITE_FACEBOOK_APP_ID=prod-app-id
VITE_API_URL=https://postolio.example
DOMAIN_NAME=postolio.example
ENVIRONMENT=prod
LOG_LEVEL=error
ENABLE_MONITORING=true
```

### 3. Configure AWS Secrets Manager

Keep only actual secrets:

```bash
# Update secrets to remove public values
aws secretsmanager update-secret \
  --secret-id "Postolio-dev/AppSecrets" \
  --secret-string '{
    "jwtSecret": "actual-secret-value",
    "databasePassword": "actual-password",
    "openaiApiKey": "sk-actual-key",
    "googleClientSecret": "actual-oauth-secret",
    "facebookAppSecret": "actual-app-secret"
  }'
```

## CI/CD Integration

### GitHub Actions Workflow

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.ref == 'refs/heads/main' && 'dev' || 
                     github.ref == 'refs/heads/staging' && 'staging' || 
                     github.ref == 'refs/heads/production' && 'prod' }}
    
    steps:
      - name: Build Frontend
        run: |
          # Variables are automatically available from environment
          cat > .env.production <<EOF
          VITE_GOOGLE_CLIENT_ID=${{ vars.VITE_GOOGLE_CLIENT_ID }}
          VITE_FACEBOOK_APP_ID=${{ vars.VITE_FACEBOOK_APP_ID }}
          VITE_API_URL=${{ vars.VITE_API_URL }}
          VITE_SENTRY_DSN=${{ vars.VITE_SENTRY_DSN }}
          EOF
          
      - name: Deploy Infrastructure
        env:
          DOMAIN_NAME: ${{ vars.DOMAIN_NAME }}
          ENVIRONMENT: ${{ vars.ENVIRONMENT }}
```

## Benefits of This Approach

1. **Clear Separation**: Public config vs actual secrets
2. **Performance**: No AWS API calls for public values
3. **Visibility**: Easy to see/change config in GitHub UI
4. **Version Control**: Config changes tracked in GitHub
5. **Environment Parity**: Easy to compare environments
6. **Security**: Secrets never exposed in logs or UI
7. **Cost**: Fewer AWS Secrets Manager API calls
8. **Developer Experience**: Simpler local development

## Migration Checklist

- [ ] Create GitHub environments (dev, staging, prod)
- [ ] Add all public variables to GitHub environments
- [ ] Remove public variables from AWS Secrets Manager
- [ ] Update CI/CD workflow to use `vars.*` syntax
- [ ] Update CDK stack to remove OAuth placeholders
- [ ] Update local development documentation
- [ ] Test deployment in each environment