# Frontend Secrets Management - OAuth Setup

## Problem Statement
The frontend requires OAuth credentials at **build time** to enable social authentication:
- `VITE_GOOGLE_CLIENT_ID` for Google OAuth
- `VITE_FACEBOOK_APP_ID` for Facebook OAuth

These environment variables must be embedded in the JavaScript bundle during the build process, not at runtime.

## Solution Architecture

### 1. AWS Secrets Manager Integration
OAuth credentials are stored securely in AWS Secrets Manager at:
- Secret Name: `postolio/app-secrets/{environment}`
- Keys:
  - `googleClientId` - Google OAuth Client ID
  - `facebookAppId` - Facebook App ID

### 2. Deployment Methods

#### A. S3/CloudFront Deployment (Primary)
The main deployment script (`deploy-aws.sh`) now:
1. Fetches OAuth credentials (Google Client ID & Facebook App ID) from AWS Secrets Manager
2. Creates a `.env.production` file with the secrets
3. Builds the frontend with the environment variables available
4. Deploys to S3/CloudFront

**Updated Code Location**: `scripts/deploy-aws.sh` lines 548-590

#### B. Docker Container Deployment (Alternative)
For containerized deployments:
1. Frontend Dockerfile accepts `VITE_GOOGLE_CLIENT_ID` and `VITE_FACEBOOK_APP_ID` as build arguments
2. Deployment script fetches the secrets and passes them via `--build-arg`

**Updated Files**:
- `frontend/Dockerfile` - Accepts build arguments
- `scripts/deploy-aws.sh` - Passes build arguments to Docker
- `scripts/build-frontend-docker.sh` - Standalone frontend Docker builder

### 3. Local Development Setup

#### Quick Setup Script
```bash
./scripts/setup-frontend-env.sh dev
```
This script:
- Fetches secrets from AWS Secrets Manager
- Creates `.env.dev` and `.env.local` files
- Configures Google OAuth for local development

#### Manual Setup
Create `frontend/.env.local`:
```env
VITE_API_BASE_URL=https://localhost:3000
VITE_GOOGLE_CLIENT_ID=your-google-client-id-here
VITE_FACEBOOK_APP_ID=your-facebook-app-id-here
```

## Implementation Details

### Frontend Dockerfile Changes
```dockerfile
# Accept build arguments
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_FACEBOOK_APP_ID
ARG VITE_API_URL

# Set as environment variables for build
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_FACEBOOK_APP_ID=$VITE_FACEBOOK_APP_ID
ENV VITE_API_URL=$VITE_API_URL

# Build with environment variables available
RUN npm run build
```

### Deployment Script Changes
```bash
# Fetch from AWS Secrets Manager
SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "postolio/app-secrets/$ENVIRONMENT" \
    --query 'SecretString' \
    --output text)

# Extract OAuth credentials
GOOGLE_CLIENT_ID=$(echo "$SECRET_JSON" | \
    python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('googleClientId', ''))")
FACEBOOK_APP_ID=$(echo "$SECRET_JSON" | \
    python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('facebookAppId', ''))")

# Add to .env.production
echo "VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" >> .env.production
echo "VITE_FACEBOOK_APP_ID=$FACEBOOK_APP_ID" >> .env.production

# Or pass to Docker build
docker build \
    --build-arg VITE_GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
    --build-arg VITE_FACEBOOK_APP_ID="$FACEBOOK_APP_ID" \
    ...
```

## Security Considerations

1. **Build-Time Only**: Secrets are only needed during build, not stored in the final artifacts
2. **AWS IAM Permissions**: Deployment user needs `secretsmanager:GetSecretValue` permission
3. **Graceful Degradation**: If secrets are not found, OAuth is disabled but app still works
4. **No Hardcoding**: Secrets are never hardcoded in source control

## Troubleshooting

### OAuth Sign-In Shows "Not Configured"
1. Check AWS Secrets Manager has OAuth credentials set:
   - `googleClientId` for Google Sign-In
   - `facebookAppId` for Facebook Sign-In
2. Verify IAM permissions for secrets access
3. Check build logs for secret fetching errors
4. Ensure `.env.production` was created before build with both OAuth credentials

### Docker Build Missing Variables
1. Verify Docker build command includes `--build-arg`
2. Check Dockerfile has `ARG` and `ENV` directives
3. Ensure secrets are fetched before Docker build

### Local Development Issues
1. Run `./scripts/setup-frontend-env.sh dev`
2. Check `.env.local` exists in `frontend/` directory
3. Restart dev server after environment changes

## Scripts Reference

- **`deploy-aws.sh`** - Main deployment script with OAuth secrets integration
- **`build-frontend-docker.sh`** - Build frontend Docker image with OAuth secrets
- **`setup-frontend-env.sh`** - Setup local development environment with OAuth credentials

## AWS Permissions Required

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:postolio/app-secrets/*"
    }
  ]
}
```

## Testing the Solution

1. **Verify Secrets Exist**:
```bash
# Check Google Client ID
aws secretsmanager get-secret-value \
  --secret-id "postolio/app-secrets/dev" \
  --query 'SecretString' \
  --output text | jq '.googleClientId'

# Check Facebook App ID
aws secretsmanager get-secret-value \
  --secret-id "postolio/app-secrets/dev" \
  --query 'SecretString' \
  --output text | jq '.facebookAppId'
```

2. **Test Local Setup**:
```bash
./scripts/setup-frontend-env.sh dev
cd frontend && npm run dev
# Check if Google and Facebook Sign-In buttons appear
```

3. **Test Production Build**:
```bash
./scripts/deploy-aws.sh prod
# Verify Google and Facebook Sign-In work on deployed site
```

## Future Improvements

1. Add support for other OAuth providers (Twitter, LinkedIn, etc.)
2. Create GitHub Actions workflow with secrets integration
3. Add secret rotation support with zero-downtime deployment
4. Implement secret caching to reduce AWS API calls
5. Add automated testing for OAuth configuration