#!/bin/bash

# AWS Infrastructure Deployment Scripts for Postolio

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration and argument parsing
ENVIRONMENT="dev"
FORCE_INFRA_DEPLOY=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            echo "Usage: $0 [ENVIRONMENT] [OPTIONS]"
            echo ""
            echo "ENVIRONMENT:"
            echo "  dev                 Deploy to development environment (default)"
            echo "  prod                Deploy to production environment"
            echo "  staging             Deploy to staging environment"
            echo ""
            echo "OPTIONS:"
            echo "  --force-infra       Force infrastructure deployment even if no changes detected"
            echo "  --help, -h          Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                  Deploy to dev with smart change detection"
            echo "  $0 prod             Deploy to production with smart change detection"
            echo "  $0 dev --force-infra Force full deployment to dev"
            echo ""
            exit 0
            ;;
        --force-infra)
            FORCE_INFRA_DEPLOY=true
            shift
            ;;
        prod|dev|staging)
            ENVIRONMENT=$1
            shift
            ;;
        destroy)
            # Keep destroy argument for existing logic
            shift
            ;;
        *)
            # First positional argument is environment if not already set
            if [ "$ENVIRONMENT" = "dev" ] && [[ ! "$1" =~ ^-- ]]; then
                ENVIRONMENT=$1
            fi
            shift
            ;;
    esac
done

AWS_REGION=${AWS_REGION:-us-east-1}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Note: --force-infra flag kept for backwards compatibility but no longer needed
# Infrastructure now always deploys with unique image tags

echo -e "${GREEN}🚀 Starting AWS deployment for environment: $ENVIRONMENT${NC}"

# Validate requirements
check_requirements() {
    echo -e "${YELLOW}Checking requirements...${NC}"
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}❌ AWS CLI is not installed. Please install it first.${NC}"
        exit 1
    fi
    
    # Check if AWS credentials are configured
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}❌ AWS credentials not configured. Please run 'aws configure'.${NC}"
        echo
        echo "You'll need:"
        echo "  - AWS Access Key ID"
        echo "  - AWS Secret Access Key"
        echo "  - Default region (recommended: us-east-1)"
        echo "  - Default output format (recommended: json)"
        echo
        echo "For help: ./scripts/validate-aws-setup.sh"
        exit 1
    else
        # Show current AWS context
        AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
        USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
        echo -e "${GREEN}✅ Using AWS Account: $AWS_ACCOUNT${NC}"
        echo "User/Role: $USER_ARN"
    fi
    
    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        echo -e "${YELLOW}⚠️  CDK not found globally. Installing locally...${NC}"
        cd "$PROJECT_ROOT/aws-infrastructure"
        npm install
    fi
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        echo -e "${RED}❌ Docker is not running. Please start Docker.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ All requirements met${NC}"
}

# Helper function to get CloudFormation stack output value
get_stack_output() {
    local stack_name="$1"
    local output_key="$2"
    local default_value="${3:-}"
    
    local value=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "")
    
    if [ -z "$value" ] || [ "$value" = "None" ]; then
        echo "$default_value"
    else
        echo "$value"
    fi
}

# Get ECS cluster name from stack outputs or fallback to resource query
get_ecs_cluster_name() {
    local stack_name="Postolio-$ENVIRONMENT"
    local cluster_name=$(get_stack_output "$stack_name" "EcsClusterName")
    
    if [ -z "$cluster_name" ]; then
        # Fallback to resource query for older stacks without the output
        cluster_name=$(aws cloudformation describe-stacks \
            --stack-name "$stack_name" \
            --query 'Stacks[0].Resources[?ResourceType==`AWS::ECS::Cluster`].PhysicalResourceId' \
            --output text \
            --region $AWS_REGION 2>/dev/null | head -1)
    fi
    
    echo "$cluster_name"
}

# Get ECS service name from stack outputs or fallback to resource query
get_ecs_service_name() {
    local stack_name="Postolio-$ENVIRONMENT"
    local service_name=$(get_stack_output "$stack_name" "EcsServiceName")
    
    if [ -z "$service_name" ]; then
        # Fallback to resource query for older stacks without the output
        service_name=$(aws cloudformation describe-stacks \
            --stack-name "$stack_name" \
            --query 'Stacks[0].Resources[?ResourceType==`AWS::ECS::Service`].PhysicalResourceId' \
            --output text \
            --region $AWS_REGION 2>/dev/null | head -1)
    fi
    
    echo "$service_name"
}

# Setup infrastructure dependencies
setup_infrastructure() {
    echo -e "${YELLOW}Setting up infrastructure dependencies...${NC}"
    cd "$PROJECT_ROOT/aws-infrastructure"
    
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    
    echo -e "${GREEN}✅ Infrastructure dependencies ready${NC}"
}

# Validate bootstrap permissions
validate_bootstrap_permissions() {
    echo -e "${YELLOW}Validating CDK bootstrap permissions...${NC}"
    
    # Quick validation - just check if we can get caller identity and list stacks
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}❌ Cannot get caller identity - check AWS credentials${NC}"
        return 1
    fi
    
    # Test basic CloudFormation access
    if ! aws cloudformation list-stacks --max-items 1 --region $AWS_REGION &> /dev/null; then
        echo -e "${YELLOW}⚠️  Limited CloudFormation permissions detected${NC}"
        echo "Attempting bootstrap anyway - it may succeed with current credentials"
    fi
    
    echo -e "${GREEN}✅ Basic permissions validated - proceeding with bootstrap${NC}"
    return 0
}

# Bootstrap CDK with enhanced error handling
bootstrap_cdk() {
    echo -e "${YELLOW}Checking CDK bootstrap...${NC}"
    cd "$PROJECT_ROOT/aws-infrastructure"
    
    # Get AWS account and region
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    
    # Use dedicated check script for consistency
    if ! "$PROJECT_ROOT/scripts/check-cdk-bootstrap.sh" "$AWS_ACCOUNT" "$AWS_REGION"; then
        echo -e "${GREEN}✅ CDK already bootstrapped - skipping${NC}"
        return 0
    fi
    
    # Bootstrap is needed
    echo -e "${YELLOW}CDK bootstrap required for account $AWS_ACCOUNT in region $AWS_REGION${NC}"
    
    # Validate permissions before attempting bootstrap
    if ! validate_bootstrap_permissions; then
        echo -e "${RED}❌ CDK bootstrap failed: Insufficient permissions${NC}"
        echo
        echo -e "${YELLOW}Solutions:${NC}"
        echo "1. Ask your AWS administrator to add the required permissions to your IAM user"
        echo "2. Use an IAM role with broader permissions: aws sts assume-role ..."
        echo "3. Ask an administrator to run the bootstrap command:"
        echo "   cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION"
        echo "4. Use AWS CloudShell (if available) which may have broader default permissions"
        echo "5. Use the dedicated bootstrap script: ./scripts/bootstrap-cdk.sh"
        echo
        echo "For detailed permissions, see: docs/AWS_DEPLOYMENT_STRATEGY.md"
        echo
        echo -e "${YELLOW}Alternative: Manual Bootstrap${NC}"
        echo "If you have access to the AWS Console:"
        echo "1. Go to CloudFormation service"
        echo "2. Create a new stack using CDKToolkit template"
        echo "3. Use this S3 template URL:"
        echo "   https://s3.us-west-2.amazonaws.com/cdk-assets-us-east-1/toolkit-bootstrap-template.json"
        echo
        return 1
    fi
    
    echo -e "${YELLOW}Bootstrapping CDK for account $AWS_ACCOUNT in region $AWS_REGION...${NC}"
    echo "This may take 2-5 minutes..."
    
    # Attempt bootstrap with better error handling
    if ! npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION; then
        echo -e "${RED}❌ CDK bootstrap failed${NC}"
        echo
        echo -e "${YELLOW}Common solutions:${NC}"
        echo "1. Check your IAM permissions (see validate_bootstrap_permissions output above)"
        echo "2. Verify you're using the correct AWS account and region"
        echo "3. Check if there's a service limit preventing resource creation"
        echo "4. Try running with verbose output: npx cdk bootstrap --verbose aws://$AWS_ACCOUNT/$AWS_REGION"
        echo
        echo "If the error mentions 'AccessDenied' for CreateChangeSet:"
        echo "  Your IAM user needs cloudformation:CreateChangeSet permission"
        echo
        echo "For help with IAM permissions, see:"
        echo "  docs/AWS_DEPLOYMENT_STRATEGY.md (section: IAM User for CI/CD)"
        echo
        return 1
    fi
    
    echo -e "${GREEN}✅ CDK bootstrap completed successfully${NC}"
}

# Ensure ECR repository exists (CDK manages it, but we need to check)
setup_ecr() {
    echo -e "${YELLOW}Checking ECR repository status...${NC}"
    
    REPO_NAME="postolio"
    
    # Check if repository exists - if not, CDK will create it
    if ! aws ecr describe-repositories --repository-names $REPO_NAME --region $AWS_REGION &> /dev/null; then
        echo -e "${YELLOW}ECR repository will be created by CDK deployment${NC}"
    else
        echo -e "${GREEN}✅ ECR repository already exists${NC}"
        
        # Update lifecycle policy if repository exists
        aws ecr put-lifecycle-configuration \
            --repository-name $REPO_NAME \
            --lifecycle-policy-text '{
                "rules": [
                    {
                        "rulePriority": 1,
                        "description": "Keep last 10 images",
                        "selection": {
                            "tagStatus": "any",
                            "countType": "imageCountMoreThan",
                            "countNumber": 10
                        },
                        "action": {
                            "type": "expire"
                        }
                    }
                ]
            }' \
            --region $AWS_REGION &> /dev/null || true
    fi
}

# Build and push Docker image
build_and_push_image() {
    echo -e "${YELLOW}Building and pushing Docker image with unique tag...${NC}"
    cd "$PROJECT_ROOT"
    
    # Get ECR login token
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_REGISTRY_URL="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
    
    echo -e "${YELLOW}Logging in to ECR registry: $ECR_REGISTRY_URL${NC}"
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY_URL
    
    # Build image with commit-based tag for better tracking
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    
    # Get git commit SHA for unique tagging (fallback to timestamp if not git repo)
    if command -v git &> /dev/null && git rev-parse --git-dir > /dev/null 2>&1; then
        GIT_SHA=$(git rev-parse --short HEAD)
        IMAGE_TAG="$GIT_SHA-$(date +%s)"
    else
        IMAGE_TAG="manual-$(date +%s)"
    fi
    
    IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/postolio:$IMAGE_TAG"
    IMAGE_URI_LATEST="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/postolio:latest"
    
    echo -e "${YELLOW}Building image with tag: $IMAGE_TAG${NC}"
    echo -e "${YELLOW}Image URI: $IMAGE_URI${NC}"
    
    # Fetch OAuth credentials from AWS Secrets Manager for Docker build
    echo -e "${YELLOW}Fetching OAuth credentials for Docker build...${NC}"
    SECRET_NAME="postolio/app-secrets/$ENVIRONMENT"
    
    # Get the full secret JSON
    SECRET_JSON=$(aws secretsmanager get-secret-value \
        --secret-id "$SECRET_NAME" \
        --query 'SecretString' \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "{}")
    
    # Function to extract a value from the secrets JSON
    extract_json_value() {
        local json="$1"
        local key="$2"
        echo "$json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('$key', ''))" 2>/dev/null || echo ""
    }
    
    # Extract OAuth credentials
    GOOGLE_CLIENT_ID=$(extract_json_value "$SECRET_JSON" "googleClientId")
    FACEBOOK_APP_ID=$(extract_json_value "$SECRET_JSON" "facebookAppId")
    
    # Build with OAuth credentials if available
    BUILD_ARGS=""
    if [ -n "$GOOGLE_CLIENT_ID" ]; then
        echo -e "${GREEN}✅ Google Client ID found${NC}"
        BUILD_ARGS="$BUILD_ARGS --build-arg VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
    else
        echo -e "${YELLOW}⚠️  Google Client ID not found${NC}"
    fi
    
    if [ -n "$FACEBOOK_APP_ID" ]; then
        echo -e "${GREEN}✅ Facebook App ID found${NC}"
        BUILD_ARGS="$BUILD_ARGS --build-arg VITE_FACEBOOK_APP_ID=$FACEBOOK_APP_ID"
    else
        echo -e "${YELLOW}⚠️  Facebook App ID not found${NC}"
    fi
    
    # Build Docker image with available credentials
    echo -e "${YELLOW}Building Docker image with OAuth credentials...${NC}"
    docker build \
        $BUILD_ARGS \
        --build-arg VITE_API_URL="https://postolio.example" \
        -t "postolio:$IMAGE_TAG" .
    
    docker tag "postolio:$IMAGE_TAG" $IMAGE_URI
    docker tag "postolio:$IMAGE_TAG" $IMAGE_URI_LATEST
    
    # Push both specific tag and latest for tracking and compatibility
    echo -e "${YELLOW}Pushing images to ECR...${NC}"
    docker push $IMAGE_URI
    docker push $IMAGE_URI_LATEST
    
    echo -e "${GREEN}✅ Images pushed successfully${NC}"
    echo "  - Specific tag: $IMAGE_TAG"
    echo "  - Latest tag: latest"
}

# Redeploy CDK with ECR image
redeploy_with_ecr_image() {
    echo -e "${YELLOW}Redeploying CDK stack to use ECR image...${NC}"
    cd "$PROJECT_ROOT/aws-infrastructure"
    
    # Temporary modification: change image source to ECR
    echo -e "${YELLOW}Updating CDK stack to use ECR image with tag: $IMAGE_TAG...${NC}"
    
    # Deploy both ContentScheduler and Postolio stacks
    # ContentScheduler must be deployed first as Postolio depends on it
    echo -e "${YELLOW}Deploying ContentScheduler stack first...${NC}"
    npx cdk deploy ContentScheduler-$ENVIRONMENT \
        --require-approval never \
        --region $AWS_REGION
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to deploy ContentScheduler stack${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ ContentScheduler stack deployed successfully${NC}"
    
    # Deploy Postolio stack with ECR image using the specific tag to ensure new deployment
    # User secrets are passed as context from environment variables
    echo -e "${YELLOW}Deploying Postolio stack...${NC}"
    npx cdk deploy Postolio-$ENVIRONMENT \
        --require-approval never \
        --context useEcrImage=true \
        --context imageTag="$IMAGE_TAG" \
        --context openaiApiKey="${OPENAI_API_KEY:-}" \
        --context googleClientSecret="${GOOGLE_CLIENT_SECRET:-}" \
        --context facebookAppSecret="${FACEBOOK_APP_SECRET:-}" \
        --region $AWS_REGION
        
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ CDK stack redeployed with ECR image${NC}"
        
        # Force ECS service to deploy the new image
        echo -e "${YELLOW}Forcing ECS service deployment...${NC}"
        CLUSTER_NAME=$(get_ecs_cluster_name)
        SERVICE_NAME=$(get_ecs_service_name)
        
        if [ -n "$CLUSTER_NAME" ] && [ -n "$SERVICE_NAME" ]; then
            echo "Forcing new deployment for cluster: $CLUSTER_NAME, service: $SERVICE_NAME"
            aws ecs update-service --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" --force-new-deployment --region $AWS_REGION
            echo -e "${GREEN}✅ ECS service deployment triggered successfully${NC}"
            
            # Wait for ECS service to stabilize and verify deployment
            echo -e "${YELLOW}Waiting for ECS service to stabilize...${NC}"
            if aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --region $AWS_REGION 2>/dev/null; then
                echo -e "${GREEN}✅ ECS service stabilized${NC}"
                
                # Verify deployment is using the correct image tag
                TASK_DEF_ARN=$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --query 'services[0].taskDefinition' --output text --region $AWS_REGION)
                if [ -n "$TASK_DEF_ARN" ] && [ "$TASK_DEF_ARN" != "None" ]; then
                    DEPLOYED_IMAGE=$(aws ecs describe-task-definition --task-definition "$TASK_DEF_ARN" --query 'taskDefinition.containerDefinitions[0].image' --output text --region $AWS_REGION)
                    echo -e "${GREEN}✅ Deployed with image: $DEPLOYED_IMAGE${NC}"
                fi
            else
                echo -e "${YELLOW}⚠️ Service is still stabilizing. Check ECS console for status.${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️ Could not determine ECS cluster or service names, skipping force deployment${NC}"
            echo "Note: The CDK deploy should have already triggered the deployment with the new image tag"
        fi
    else
        echo -e "${RED}❌ CDK redeployment failed${NC}"
        exit 1
    fi
}

# Note: detect_docker_image_changes removed - now using unique image tags for every deployment

# Check if this is the first deployment (no deployment tags exist)
is_first_deployment() {
    ! git tag -l "deploy-$ENVIRONMENT-*" | head -1 > /dev/null 2>&1
}

# Note: Smart change detection removed - now using unique image tags for every deployment

# Note: force_ecs_service_update removed - ECS updates now handled in redeploy_with_ecr_image and deploy_infrastructure functions

# Deploy infrastructure with security validation
deploy_infrastructure() {
    echo -e "${YELLOW}Deploying infrastructure with unique image tag: $IMAGE_TAG...${NC}"
    cd "$PROJECT_ROOT/aws-infrastructure"
    
    # Build and validate infrastructure first
    echo -e "${YELLOW}🔍 Running security validation with CDK Nag...${NC}"
    npm run build
    
    # Synthesize to validate security checks
    if ! npx cdk synth --quiet > /dev/null 2>&1; then
        echo -e "${RED}❌ CDK security validation failed${NC}"
        echo "Running synthesis with error output:"
        npx cdk synth
        exit 1
    fi
    
    echo -e "${GREEN}✅ Security validation passed - all AWS Well-Architected checks OK${NC}"
    
    # Get domain configuration from environment variables
    DOMAIN_ARGS=""
    if [ -n "$DOMAIN_NAME" ]; then
        DOMAIN_ARGS="--context domainName=$DOMAIN_NAME"
        if [ -n "$HOSTED_ZONE_ID" ]; then
            DOMAIN_ARGS="$DOMAIN_ARGS --context hostedZoneId=$HOSTED_ZONE_ID"
            echo -e "${YELLOW}Deploying with custom domain: $DOMAIN_NAME (Route 53 managed)${NC}"
        elif [ "$USE_EXTERNAL_DNS" = "true" ]; then
            DOMAIN_ARGS="$DOMAIN_ARGS --context useExternalDns=true"
            echo -e "${YELLOW}Deploying with custom domain: $DOMAIN_NAME (External DNS provider)${NC}"
        else
            echo -e "${RED}❌ DOMAIN_NAME specified but neither HOSTED_ZONE_ID nor USE_EXTERNAL_DNS is set${NC}"
            echo "For Route 53: set HOSTED_ZONE_ID"
            echo "For external DNS: set USE_EXTERNAL_DNS=true"
            exit 1
        fi
    fi
    
    # Deploy both ContentScheduler and Postolio stacks
    # ContentScheduler must be deployed first as Postolio depends on it
    echo -e "${YELLOW}Deploying ContentScheduler stack first...${NC}"
    npx cdk deploy ContentScheduler-$ENVIRONMENT \
        --context environment=$ENVIRONMENT \
        --context account=$(aws sts get-caller-identity --query Account --output text) \
        --context region=$AWS_REGION \
        --require-approval never
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to deploy ContentScheduler stack${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ ContentScheduler stack deployed successfully${NC}"
    
    # Deploy Postolio stack with ECR image using specific tag
    # User secrets are passed as context from environment variables
    echo -e "${YELLOW}Deploying Postolio stack...${NC}"
    npx cdk deploy Postolio-$ENVIRONMENT \
        --context environment=$ENVIRONMENT \
        --context account=$(aws sts get-caller-identity --query Account --output text) \
        --context region=$AWS_REGION \
        --context useEcrImage=true \
        --context imageTag="$IMAGE_TAG" \
        --context openaiApiKey="${OPENAI_API_KEY:-}" \
        --context googleClientSecret="${GOOGLE_CLIENT_SECRET:-}" \
        --context facebookAppSecret="${FACEBOOK_APP_SECRET:-}" \
        $DOMAIN_ARGS \
        --require-approval never
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Secure infrastructure deployed successfully${NC}"
        echo -e "${GREEN}🛡️  All security features enabled: VPC Flow Logs, encryption at rest, non-default ports${NC}"
        
        # Force ECS service to deploy the new image
        echo -e "${YELLOW}Forcing ECS service deployment...${NC}"
        CLUSTER_NAME=$(get_ecs_cluster_name)
        SERVICE_NAME=$(get_ecs_service_name)
        
        if [ -n "$CLUSTER_NAME" ] && [ -n "$SERVICE_NAME" ]; then
            echo "Forcing new deployment for cluster: $CLUSTER_NAME, service: $SERVICE_NAME"
            aws ecs update-service --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" --force-new-deployment --region $AWS_REGION
            echo -e "${GREEN}✅ ECS service deployment triggered successfully${NC}"
            
            # Wait for ECS service to stabilize and verify deployment
            echo -e "${YELLOW}Waiting for ECS service to stabilize...${NC}"
            if aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --region $AWS_REGION 2>/dev/null; then
                echo -e "${GREEN}✅ ECS service stabilized${NC}"
                
                # Verify deployment is using the correct image tag
                TASK_DEF_ARN=$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --query 'services[0].taskDefinition' --output text --region $AWS_REGION)
                if [ -n "$TASK_DEF_ARN" ] && [ "$TASK_DEF_ARN" != "None" ]; then
                    DEPLOYED_IMAGE=$(aws ecs describe-task-definition --task-definition "$TASK_DEF_ARN" --query 'taskDefinition.containerDefinitions[0].image' --output text --region $AWS_REGION)
                    echo -e "${GREEN}✅ Deployed with image: $DEPLOYED_IMAGE${NC}"
                fi
            else
                echo -e "${YELLOW}⚠️ Service is still stabilizing. Check ECS console for status.${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️ Could not determine ECS cluster or service names, skipping force deployment${NC}"
            echo "Note: The CDK deploy should have already triggered the deployment with the new image tag"
        fi
    else
        echo -e "${RED}❌ Infrastructure deployment failed${NC}"
        exit 1
    fi
}

# Deploy frontend
deploy_frontend() {
    echo -e "${YELLOW}Deploying frontend...${NC}"
    cd "$PROJECT_ROOT/frontend"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    
    # Use unified domain architecture - frontend and backend share postolio.example
    # Check if custom domain is configured
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    if [ -z "$API_URL" ] || [ "$API_URL" = "None" ]; then
        # Fallback to ALB DNS for environments without custom domain
        LOAD_BALANCER_DNS=$(aws cloudformation describe-stacks \
            --stack-name Postolio-$ENVIRONMENT \
            --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
            --output text \
            --region $AWS_REGION)
        API_URL="https://$LOAD_BALANCER_DNS"
        echo -e "${YELLOW}Using fallback ALB DNS: $API_URL${NC}"
    else
        # For unified domain, use https://postolio.example
        API_URL="https://postolio.example"
        echo -e "${GREEN}Using unified domain: $API_URL${NC}"
    fi
    
    # Fetch OAuth credentials from AWS Secrets Manager
    echo -e "${YELLOW}Fetching OAuth credentials from AWS Secrets Manager...${NC}"
    SECRET_NAME="postolio/app-secrets/$ENVIRONMENT"
    
    # Get the full secret JSON
    SECRET_JSON=$(aws secretsmanager get-secret-value \
        --secret-id "$SECRET_NAME" \
        --query 'SecretString' \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "{}")
    
    # Function to extract a value from the secrets JSON
    extract_json_value() {
        local json="$1"
        local key="$2"
        echo "$json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('$key', ''))" 2>/dev/null || echo ""
    }
    
    # Extract Google Client ID
    GOOGLE_CLIENT_ID=$(extract_json_value "$SECRET_JSON" "googleClientId")
    
    if [ -z "$GOOGLE_CLIENT_ID" ]; then
        echo -e "${YELLOW}⚠️  Google Client ID not found in Secrets Manager, Google Sign-In will be disabled${NC}"
    else
        echo -e "${GREEN}✅ Google Client ID retrieved successfully${NC}"
    fi
    
    # Extract Facebook App ID
    FACEBOOK_APP_ID=$(extract_json_value "$SECRET_JSON" "facebookAppId")
    
    if [ -z "$FACEBOOK_APP_ID" ]; then
        echo -e "${YELLOW}⚠️  Facebook App ID not found in Secrets Manager, Facebook Sign-In will be disabled${NC}"
    else
        echo -e "${GREEN}✅ Facebook App ID retrieved successfully${NC}"
    fi
    
    # Create production environment file
    echo "VITE_API_BASE_URL=$API_URL" > .env.production
    
    # Add Google Client ID if available
    if [ -n "$GOOGLE_CLIENT_ID" ]; then
        echo "VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" >> .env.production
    fi
    
    # Add Facebook App ID if available
    if [ -n "$FACEBOOK_APP_ID" ]; then
        echo "VITE_FACEBOOK_APP_ID=$FACEBOOK_APP_ID" >> .env.production
    fi
    
    # Build frontend
    echo -e "${YELLOW}Building frontend with environment variables...${NC}"
    if ! npm run build; then
        echo -e "${RED}❌ Frontend build failed${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Frontend built successfully${NC}"
    
    # Verify dist folder exists
    if [ ! -d "dist" ]; then
        echo -e "${RED}❌ Build output directory 'dist' not found${NC}"
        exit 1
    fi
    
    # Get S3 bucket name from the stack
    BUCKET_NAME=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" = "None" ]; then
        echo -e "${RED}❌ Frontend S3 bucket not found in stack outputs${NC}"
        exit 1
    fi
    
    # Upload to S3
    echo -e "${YELLOW}Uploading frontend to S3 bucket: $BUCKET_NAME${NC}"
    if ! aws s3 sync dist s3://$BUCKET_NAME --delete --region $AWS_REGION; then
        echo -e "${RED}❌ Failed to upload frontend to S3${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Frontend uploaded to S3${NC}"
    
    # Invalidate CloudFront cache - get distribution ID from stack outputs
    DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
        echo -e "${YELLOW}Invalidating CloudFront cache (Distribution: $DISTRIBUTION_ID)...${NC}"
        aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*" > /dev/null
        echo -e "${GREEN}✅ CloudFront cache invalidated${NC}"
    else
        echo -e "${YELLOW}⚠️  CloudFront distribution not found, skipping cache invalidation${NC}"
    fi
    
    echo -e "${GREEN}✅ Frontend deployed successfully${NC}"
}

# Display deployment information
show_deployment_info() {
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
    echo
    echo -e "${YELLOW}Deployment Information:${NC}"
    
    # Get stack outputs
    OUTPUTS=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs' \
        --output table \
        --region $AWS_REGION)
    
    echo "$OUTPUTS"
    
    # Get application URL
    APP_URL=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`ApplicationURL`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    if [ -n "$APP_URL" ] && [ "$APP_URL" != "None" ]; then
        echo
        echo -e "${GREEN}🌐 Application URL: $APP_URL${NC}"
    fi
    
    echo
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "1. Update the application secrets in AWS Secrets Manager"
    if [ -n "$DOMAIN_NAME" ]; then
        if [ -n "$HOSTED_ZONE_ID" ]; then
            echo "2. Verify DNS propagation for $DOMAIN_NAME"
            echo "3. Verify SSL certificate validation"
        elif [ "$USE_EXTERNAL_DNS" = "true" ]; then
            echo "2. Configure DNS record with your DNS provider:"
            CLOUDFRONT_DOMAIN=$(aws cloudformation describe-stacks \
                --stack-name Postolio-$ENVIRONMENT \
                --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionDomain`].OutputValue' \
                --output text \
                --region $AWS_REGION)
            if [ -n "$CLOUDFRONT_DOMAIN" ] && [ "$CLOUDFRONT_DOMAIN" != "None" ]; then
                echo "   Create CNAME: $DOMAIN_NAME -> $CLOUDFRONT_DOMAIN"
            fi
            echo "3. Verify SSL certificate validation via email"
            echo "4. Wait for DNS propagation (up to 48 hours)"
        fi
    else
        echo "2. Configure your custom domain name (optional)"
    fi
    echo "$([ -n "$DOMAIN_NAME" ] && [ -n "$HOSTED_ZONE_ID" ] && echo "4" || [ -n "$DOMAIN_NAME" ] && [ "$USE_EXTERNAL_DNS" = "true" ] && echo "5" || echo "3"). Set up monitoring and alerting"
    echo "$([ -n "$DOMAIN_NAME" ] && [ -n "$HOSTED_ZONE_ID" ] && echo "5" || [ -n "$DOMAIN_NAME" ] && [ "$USE_EXTERNAL_DNS" = "true" ] && echo "6" || echo "4"). Configure backup and disaster recovery"
}

# Update secrets
update_secrets() {
    echo -e "${YELLOW}Secret Configuration Information${NC}"
    echo ""
    echo -e "${GREEN}✅ Infrastructure secrets are automatically configured:${NC}"
    echo "   - JWT_SECRET: Auto-generated from stack ID"
    echo "   - REDIS_URL: Configured from ElastiCache endpoint"
    echo "   - PUBLISHER_API_KEY: Auto-generated for Lambda"
    echo "   - DB_USERNAME/DB_PASSWORD: Managed by RDS"
    echo ""
    echo -e "${YELLOW}⚠️  User secrets must be provided as environment variables:${NC}"
    echo ""
    if [ -z "$OPENAI_API_KEY" ]; then
        echo -e "${RED}❌ OPENAI_API_KEY not set${NC}"
        echo "   export OPENAI_API_KEY='your-openai-api-key'"
    else
        echo -e "${GREEN}✅ OPENAI_API_KEY is set${NC}"
    fi
    
    if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
        echo -e "${YELLOW}⚠️  GOOGLE_CLIENT_SECRET not set (optional)${NC}"
        echo "   export GOOGLE_CLIENT_SECRET='your-google-client-secret'"
    else
        echo -e "${GREEN}✅ GOOGLE_CLIENT_SECRET is set${NC}"
    fi
    
    if [ -z "$FACEBOOK_APP_SECRET" ]; then
        echo -e "${YELLOW}⚠️  FACEBOOK_APP_SECRET not set (optional)${NC}"
        echo "   export FACEBOOK_APP_SECRET='your-facebook-app-secret'"
    else
        echo -e "${GREEN}✅ FACEBOOK_APP_SECRET is set${NC}"
    fi
    
    echo ""
    echo "To set secrets for deployment:"
    echo "1. Export environment variables before running this script:"
    echo "   export OPENAI_API_KEY='sk-...'"
    echo "   export GOOGLE_CLIENT_SECRET='...'"
    echo "   export FACEBOOK_APP_SECRET='...'"
    echo "   ./scripts/deploy-aws.sh $ENVIRONMENT"
    echo ""
    echo "2. Or create a .env file and source it:"
    echo "   source .env"
    echo "   ./scripts/deploy-aws.sh $ENVIRONMENT"
}

# Deploy ECR repository only first
deploy_ecr_repository() {
    echo -e "${YELLOW}Creating ECR repository if needed...${NC}"
    
    REPO_NAME="postolio"
    
    # Check if repository exists - if not, create it manually
    if ! aws ecr describe-repositories --repository-names $REPO_NAME --region $AWS_REGION &> /dev/null; then
        echo -e "${YELLOW}Creating ECR repository...${NC}"
        aws ecr create-repository --repository-name $REPO_NAME --region $AWS_REGION
        
        # Set lifecycle policy
        aws ecr put-lifecycle-configuration \
            --repository-name $REPO_NAME \
            --lifecycle-policy-text '{
                "rules": [
                    {
                        "rulePriority": 1,
                        "description": "Keep last 10 images",
                        "selection": {
                            "tagStatus": "any",
                            "countType": "imageCountMoreThan",
                            "countNumber": 10
                        },
                        "action": {
                            "type": "expire"
                        }
                    }
                ]
            }' \
            --region $AWS_REGION &> /dev/null
    else
        echo -e "${GREEN}✅ ECR repository already exists${NC}"
    fi
}

# Main deployment function
main() {
    echo -e "${GREEN}🏗️  Postolio AWS Deployment${NC}"
    echo "Environment: $ENVIRONMENT"
    echo "Region: $AWS_REGION"
    echo

    check_requirements
    setup_infrastructure
    bootstrap_cdk
    deploy_ecr_repository
    build_and_push_image
    deploy_infrastructure
    deploy_frontend
    show_deployment_info
    update_secrets
    tag_deployment
    
    echo
    echo -e "${GREEN}✨ Deployment complete! Your Postolio is now running on AWS with enhanced security.${NC}"
    echo -e "${GREEN}🛡️  Security features: VPC Flow Logs, database encryption, non-default ports, CDK Nag validated${NC}"
    echo -e "${GREEN}⚡ Using unique image tags for reliable backend deployments${NC}"
}

# Fix current deployment by building image and updating ECS service
fix_deployment() {
    echo -e "${GREEN}🔧 Fixing current deployment with ECR image${NC}"
    echo "Environment: $ENVIRONMENT"
    echo "Region: $AWS_REGION"
    echo

    check_requirements
    build_and_push_image
    redeploy_with_ecr_image
    
    echo -e "${GREEN}✅ Deployment fixed with ECR image and ECS service updated${NC}"
}

# Tag deployment for future change detection
tag_deployment() {
    if command -v git &> /dev/null && git rev-parse --git-dir > /dev/null 2>&1; then
        DEPLOY_TAG="deploy-$ENVIRONMENT-$(date +%Y%m%d-%H%M%S)"
        git tag "$DEPLOY_TAG" 2>/dev/null || true
        echo -e "${GREEN}📌 Tagged deployment: $DEPLOY_TAG${NC}"
    fi
}

# Handle script arguments
case "${2:-deploy}" in
    "deploy")
        main
        ;;
    "fix")
        fix_deployment
        ;;
    "destroy")
        echo -e "${YELLOW}⚠️  Destroying infrastructure for environment: $ENVIRONMENT${NC}"
        echo "This will permanently delete all resources. Are you sure? (yes/no)"
        read -r confirmation
        if [ "$confirmation" = "yes" ]; then
            cd "$PROJECT_ROOT/aws-infrastructure"
            npx cdk destroy Postolio-$ENVIRONMENT --force
            echo -e "${GREEN}✅ Infrastructure destroyed${NC}"
        else
            echo "Destruction cancelled."
        fi
        ;;
    "update-secrets")
        update_secrets
        ;;
    *)
        echo "Usage: $0 [environment] [action]"
        echo "Environment: dev|staging|prod (default: dev)"
        echo "Actions: deploy|fix|destroy|update-secrets (default: deploy)"
        exit 1
        ;;
esac
