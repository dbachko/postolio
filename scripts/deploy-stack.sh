#!/bin/bash

# Local Stack Deployment Script
# This script deploys individual CDK stacks locally using environment variables from .env file
# It mirrors the CI/CD deployment process from GitHub Actions

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CDK_DIR="$PROJECT_ROOT/packages/infra/cdk"

# Default values
ENVIRONMENT="dev"
STACK_NAME=""
ENV_FILE="$PROJECT_ROOT/.env"
IMAGE_TAG="api-${ENVIRONMENT}-latest"

# Help text
show_help() {
    cat << EOF
Local Stack Deployment Script

Usage: $0 [OPTIONS] <stack>

Stacks:
  foundation      - ECR Registry and Foundation infrastructure
  auth            - Token Service (OAuth and JWT management)
  scheduling      - Schedule Management services
  brand-analysis  - Brand Analysis services (profiles/jobs + lambdas)
  publishing      - Publisher and retry handlers
  api             - Backend API (ECS Fargate)
  analytics       - Analytics ingestion worker (ECS Fargate)
  asset-library   - Asset Library microservice (ECS + RDS + CDN)
  web             - Frontend (S3 + CloudFront)
  all             - Deploy all stacks in dependency order

Options:
  -e, --env ENV          Environment (dev|staging|prod) [default: dev]
  -f, --env-file FILE    Path to .env file [default: .env]
  -t, --image-tag TAG    Docker image tag [default: api-{env}-latest]
  -h, --help             Show this help message

Environment Variables (from .env file):
  Required for API stack:
    OPENAI_API_KEY              - OpenAI API key for AI features
    GOOGLE_CLIENT_ID            - Google OAuth client ID
    GOOGLE_CLIENT_SECRET        - Google OAuth client secret
    FACEBOOK_APP_ID             - Facebook/Instagram App ID
    FACEBOOK_APP_SECRET         - Facebook/Instagram App Secret
    INSTAGRAM_APP_ID            - Instagram App ID (usually same as Facebook)
    INSTAGRAM_APP_SECRET        - Instagram App Secret
    INSTAGRAM_REDIRECT_URI      - Instagram OAuth redirect URI
    LINKEDIN_CLIENT_ID          - LinkedIn OAuth client ID
    LINKEDIN_CLIENT_SECRET      - LinkedIn OAuth client secret
    TIKTOK_CLIENT_KEY           - TikTok client key
    TIKTOK_CLIENT_SECRET        - TikTok client secret

  Optional:
    NODE_ENV                    - Node environment [default: dev]
    LOG_LEVEL                   - Logging level [default: debug]
    ENABLE_MONITORING           - Enable monitoring [default: true]
    DOMAIN_NAME                 - Custom domain name
    VITE_API_URL                - CORS origin for API

Examples:
  # Deploy foundation stack
  $0 foundation

  # Deploy API stack with custom environment
  $0 -e staging api

  # Deploy all stacks
  $0 all

  # Deploy API stack with custom .env file
  $0 -f .env.production api

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -f|--env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        -t|--image-tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        foundation|auth|scheduling|brand-analysis|publishing|api|analytics|asset-library|web|all)
            STACK_NAME="$1"
            shift
            ;;
        *)
            echo -e "${RED}Error: Unknown option or stack: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Validate stack name
if [[ -z "$STACK_NAME" ]]; then
    echo -e "${RED}Error: Stack name is required${NC}"
    show_help
    exit 1
fi

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    echo -e "${RED}Error: Invalid environment: $ENVIRONMENT${NC}"
    echo -e "Valid options: dev, staging, prod"
    exit 1
fi

# Check if .env file exists
if [[ ! -f "$ENV_FILE" ]]; then
    echo -e "${YELLOW}Warning: .env file not found at: $ENV_FILE${NC}"
    echo -e "Creating from .env.example..."
    if [[ -f "$PROJECT_ROOT/.env.example" ]]; then
        cp "$PROJECT_ROOT/.env.example" "$ENV_FILE"
        echo -e "${YELLOW}Please edit $ENV_FILE with your actual values before deploying${NC}"
        exit 1
    else
        echo -e "${RED}Error: .env.example not found${NC}"
        exit 1
    fi
fi

# Load environment variables from .env file
echo -e "${BLUE}Loading environment variables from: $ENV_FILE${NC}"
set -a  # automatically export all variables
source "$ENV_FILE"
set +a

# Verify required AWS credentials
if [[ -z "$AWS_REGION" ]]; then
    AWS_REGION="us-east-1"
    echo -e "${YELLOW}Warning: AWS_REGION not set, using default: us-east-1${NC}"
fi

# Function to deploy a single stack
deploy_stack() {
    local stack="$1"
    local cdk_stack_name

    # Map friendly stack name to CDK stack name
    case "$stack" in
        foundation)
            cdk_stack_name="Postolio-Foundation-$ENVIRONMENT"
            ;;
        auth)
            cdk_stack_name="Postolio-Auth-$ENVIRONMENT"
            ;;
        scheduling)
            cdk_stack_name="Postolio-Scheduling-$ENVIRONMENT"
            ;;
        brand-analysis)
            cdk_stack_name="Postolio-BrandAnalysis-$ENVIRONMENT"
            ;;
        publishing)
            cdk_stack_name="Postolio-Publishing-$ENVIRONMENT"
            ;;
        api)
            cdk_stack_name="Postolio-API-$ENVIRONMENT"
            ;;
        analytics)
            cdk_stack_name="Postolio-Analytics-$ENVIRONMENT"
            ;;
        asset-library)
            cdk_stack_name="Postolio-AssetLibrary-$ENVIRONMENT"
            ;;
        web)
            cdk_stack_name="Postolio-Web-$ENVIRONMENT"
            ;;
        *)
            echo -e "${RED}Unknown stack: $stack${NC}"
            exit 1
            ;;
    esac

    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}Deploying: $cdk_stack_name${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Build dependencies based on stack
    # Adjust default image tag for analytics if not overridden
    if [[ "$stack" == "analytics" && "$IMAGE_TAG" == "api-${ENVIRONMENT}-latest" ]]; then
        IMAGE_TAG="analytics-${ENVIRONMENT}-latest"
    fi

    case "$stack" in
        auth|scheduling|publishing|brand-analysis)
            echo -e "${BLUE}Building shared libraries...${NC}"
            pnpm --filter=@postolio/database build || true
            pnpm --filter=@postolio/errors build || true
            pnpm --filter=@postolio/aws build
            ;;
        api)
            echo -e "${BLUE}Building API and dependencies...${NC}"
            pnpm --filter=@postolio/database build || true
            pnpm --filter=@postolio/errors build || true
            pnpm --filter=@postolio/csrf-client build || true
            pnpm --filter=api build
            ;;
        analytics)
            echo -e "${BLUE}Building Analytics Ingestor and dependencies...${NC}"
            pnpm --filter=@postolio/database build || true
            pnpm --filter=@postolio/connectors build || true
            pnpm --filter=@postolio/errors build || true
            pnpm --filter=@postolio/analytics-ingestor build
            ;;
        asset-library)
            echo -e "${BLUE}Preparing Asset Library dependencies...${NC}"
            pnpm --filter=@postolio/database-assets build || true
            pnpm --filter=@postolio/errors build || true
            ;;
        web)
            echo -e "${BLUE}Building frontend dependencies...${NC}"
            pnpm --filter=@postolio/csrf-client build || true
            pnpm --filter=@postolio/errors build || true
            pnpm --filter=@postolio/database build || true
            ;;
    esac

    # Prepare CDK context parameters
    local context_params=(
        --context "environment=$ENVIRONMENT"
        --context "imageTag=$IMAGE_TAG"
    )

    # Limit synth to selected stack to avoid unnecessary context lookups
    if [[ "$STACK_NAME" != "all" ]]; then
        context_params+=(--context "onlyStack=$stack")
    fi

    # Add optional context parameters if they exist
    [[ -n "$DOMAIN_NAME" ]] && context_params+=(--context "domainName=$DOMAIN_NAME")
    [[ -n "$VITE_API_URL" ]] && context_params+=(--context "corsOrigin=$VITE_API_URL")
    [[ -n "$NODE_ENV" ]] && context_params+=(--context "nodeEnv=$NODE_ENV")
    [[ -n "$LOG_LEVEL" ]] && context_params+=(--context "logLevel=$LOG_LEVEL")
    [[ -n "$ENABLE_MONITORING" ]] && context_params+=(--context "enableMonitoring=$ENABLE_MONITORING")

    # Add OAuth and API keys (required for api stack)
    [[ -n "$OPENAI_API_KEY" ]] && context_params+=(--context "openaiApiKey=$OPENAI_API_KEY")
    [[ -n "$GOOGLE_CLIENT_ID" ]] && context_params+=(--context "googleClientId=$GOOGLE_CLIENT_ID")
    [[ -n "$GOOGLE_CLIENT_SECRET" ]] && context_params+=(--context "googleClientSecret=$GOOGLE_CLIENT_SECRET")
    [[ -n "$FACEBOOK_APP_ID" ]] && context_params+=(--context "facebookAppId=$FACEBOOK_APP_ID")
    [[ -n "$FACEBOOK_APP_SECRET" ]] && context_params+=(--context "facebookAppSecret=$FACEBOOK_APP_SECRET")
    [[ -n "$INSTAGRAM_APP_ID" ]] && context_params+=(--context "instagramAppId=$INSTAGRAM_APP_ID")
    [[ -n "$INSTAGRAM_APP_SECRET" ]] && context_params+=(--context "instagramAppSecret=$INSTAGRAM_APP_SECRET")
    [[ -n "$INSTAGRAM_REDIRECT_URI" ]] && context_params+=(--context "instagramRedirectUri=$INSTAGRAM_REDIRECT_URI")
    [[ -n "$LINKEDIN_CLIENT_ID" ]] && context_params+=(--context "linkedinClientId=$LINKEDIN_CLIENT_ID")
    [[ -n "$LINKEDIN_CLIENT_SECRET" ]] && context_params+=(--context "linkedinClientSecret=$LINKEDIN_CLIENT_SECRET")
    [[ -n "$TIKTOK_CLIENT_KEY" ]] && context_params+=(--context "tiktokClientKey=$TIKTOK_CLIENT_KEY")
    [[ -n "$TIKTOK_CLIENT_SECRET" ]] && context_params+=(--context "tiktokClientSecret=$TIKTOK_CLIENT_SECRET")
    # Optional analytics bootstrap/context knobs
    [[ -n "$RATE_LIMIT_PER_HOUR" ]] && context_params+=(--context "rateLimitPerHour=$RATE_LIMIT_PER_HOUR")

    # Check stack status before deployment
    local stack_status
    stack_status=$(aws cloudformation describe-stacks --stack-name "$cdk_stack_name" --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DOES_NOT_EXIST")

    if [[ "$stack_status" == "ROLLBACK_COMPLETE" ]]; then
        echo -e "${YELLOW}⚠️  Stack is in ROLLBACK_COMPLETE state${NC}"
        echo -e "${YELLOW}To fix this, delete the stack first:${NC}"
        echo -e "${YELLOW}  aws cloudformation delete-stack --stack-name $cdk_stack_name${NC}"
        read -p "Delete stack and continue? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            aws cloudformation delete-stack --stack-name "$cdk_stack_name"
            echo -e "${BLUE}Waiting for stack deletion...${NC}"
            aws cloudformation wait stack-delete-complete --stack-name "$cdk_stack_name"
        else
            echo -e "${RED}Deployment cancelled${NC}"
            exit 1
        fi
    fi

    # Deploy the stack
    cd "$CDK_DIR"

    echo -e "${BLUE}Deploying $cdk_stack_name...${NC}"
    pnpm cdk deploy "$cdk_stack_name" \
        --app "npx tsx bin/app.ts" \
        --require-approval never \
        "${context_params[@]}" \
        --verbose

    if [[ $? -eq 0 ]]; then
        echo -e "${GREEN}✅ Successfully deployed: $cdk_stack_name${NC}"
    else
        echo -e "${RED}❌ Failed to deploy: $cdk_stack_name${NC}"
        exit 1
    fi

    cd "$PROJECT_ROOT"
}

# Main deployment logic
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Postolio Stack Deployment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Environment:  $ENVIRONMENT${NC}"
echo -e "${BLUE}Stack(s):     $STACK_NAME${NC}"
echo -e "${BLUE}Image Tag:    $IMAGE_TAG${NC}"
echo -e "${BLUE}CDK Directory: $CDK_DIR${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Check if pnpm is available
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}Error: pnpm is not installed${NC}"
    echo -e "Install with: npm install -g pnpm"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not configured${NC}"
    echo -e "Run: aws configure"
    exit 1
fi

# Optional deploy freeze (pause)
# If DEPLOY_FREEZE=true, or SSM parameter /postolio/{env}/deploy/freeze == 'true', skip deployment
FREEZE_FLAG=${DEPLOY_FREEZE:-}
if [[ -z "$FREEZE_FLAG" ]]; then
  FREEZE_SSM=$(aws ssm get-parameter --name "/postolio/$ENVIRONMENT/deploy/freeze" --query 'Parameter.Value' --output text 2>/dev/null || echo "false")
  FREEZE_FLAG=$FREEZE_SSM
fi

# Normalize to lowercase in a portable way (macOS bash is 3.x)
FREEZE_NORM=$(printf '%s' "$FREEZE_FLAG" | tr '[:upper:]' '[:lower:]')
if [[ "$FREEZE_NORM" == "true" || "$FREEZE_NORM" == "1" ]]; then
  echo -e "${YELLOW}⚠️  Deployment is paused (freeze flag detected). Skipping deploy.${NC}"
  echo -e "${YELLOW}Unset DEPLOY_FREEZE or SSM parameter /postolio/$ENVIRONMENT/deploy/freeze to resume.${NC}"
  exit 0
fi

# Deploy stack(s)
if [[ "$STACK_NAME" == "all" ]]; then
    # Deploy all stacks in dependency order
    STACKS=("foundation" "auth" "scheduling" "brand-analysis" "publishing" "api" "asset-library" "web")
    for stack in "${STACKS[@]}"; do
        deploy_stack "$stack"
        echo
    done
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ All stacks deployed successfully!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
else
    # Deploy single stack
    deploy_stack "$STACK_NAME"
fi
