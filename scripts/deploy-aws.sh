#!/bin/bash

# AWS Infrastructure Deployment Scripts for Postolio

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-dev}
AWS_REGION=${AWS_REGION:-us-east-1}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

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
    
    # Check if bootstrap stack exists - try multiple ways to detect it
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null && \
       ! aws s3api head-bucket --bucket "cdk-hnb659fds-assets-$AWS_ACCOUNT-$AWS_REGION" &> /dev/null; then
        echo -e "${YELLOW}CDK is not bootstrapped for account $AWS_ACCOUNT in region $AWS_REGION${NC}"
        
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
    else
        echo -e "${GREEN}✅ CDK already bootstrapped${NC}"
    fi
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
    # Skip if no backend changes detected
    if [ "$BACKEND_CHANGED" = false ]; then
        echo -e "${GREEN}⏭️  Skipping Docker build - no backend changes detected${NC}"
        echo "This saves significant build time and ECR storage!"
        return 0
    fi
    
    echo -e "${YELLOW}Building and pushing Docker image...${NC}"
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
    
    docker build -t "postolio:$IMAGE_TAG" .
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
    echo -e "${YELLOW}Updating CDK stack to use ECR image...${NC}"
    
    # Deploy with ECR image
    npx cdk deploy Postolio-$ENVIRONMENT \
        --require-approval never \
        --context useEcrImage=true \
        --region $AWS_REGION
        
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ CDK stack redeployed with ECR image${NC}"
    else
        echo -e "${RED}❌ CDK redeployment failed${NC}"
        exit 1
    fi
}

# Smart Docker image change detection using ECR and source code
detect_docker_image_changes() {
    echo -e "${YELLOW}🔍 Checking if Docker image update is needed...${NC}"
    
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    
    # Step 1: Check if source code changed (quick check)
    # Use the latest deployment tag for this environment if available
    LAST_DEPLOY_COMMIT=""
    if git tag -l "deploy-$ENVIRONMENT-*" | tail -1 > /dev/null 2>&1; then
        LAST_DEPLOY_TAG=$(git tag -l "deploy-$ENVIRONMENT-*" | sort | tail -1)
        LAST_DEPLOY_COMMIT=$(git rev-list -n 1 "$LAST_DEPLOY_TAG" 2>/dev/null || echo "")
        echo -e "${GREEN}ℹ️  Comparing with last deployment: $LAST_DEPLOY_TAG${NC}"
    fi
    
    # Fallback to simple HEAD~1 comparison if no deployment tags
    if [ -z "$LAST_DEPLOY_COMMIT" ] || ! git rev-parse --verify "$LAST_DEPLOY_COMMIT" >/dev/null 2>&1; then
        LAST_DEPLOY_COMMIT="HEAD~1"
        echo -e "${YELLOW}ℹ️  No deployment tags found, comparing with previous commit${NC}"
    fi
    BACKEND_FILES=$(git diff --name-only $LAST_DEPLOY_COMMIT HEAD | grep -E "^(src/|prisma/|package\.json|package-lock\.json|Dockerfile|\.env\.example)$" || true)
    
    if [ -n "$BACKEND_FILES" ]; then
        echo -e "${YELLOW}📦 Backend source code changed - new image build required${NC}"
        echo "Changed files:"
        echo "$BACKEND_FILES" | sed 's/^/  - /' | head -3
        [ $(echo "$BACKEND_FILES" | wc -l) -gt 3 ] && echo "  - ... and $(( $(echo "$BACKEND_FILES" | wc -l) - 3 )) more files"
        BACKEND_CHANGED=true
        return
    fi
    
    # Step 2: If no source changes, check if ECS is running the latest ECR image
    echo -e "${GREEN}✅ No source code changes detected${NC}"
    echo -e "${YELLOW}🔍 Checking if ECS is running latest ECR image...${NC}"
    
    # Get current :latest image SHA from ECR
    LATEST_ECR_SHA=""
    if aws ecr describe-images --repository-name postolio --image-ids imageTag=latest --region $AWS_REGION >/dev/null 2>&1; then
        LATEST_ECR_SHA=$(aws ecr describe-images \
            --repository-name postolio \
            --image-ids imageTag=latest \
            --query 'imageDetails[0].imageDigest' \
            --output text \
            --region $AWS_REGION 2>/dev/null || echo "")
    fi
    
    # Get currently running image SHA from ECS service
    CLUSTER_NAME="Postolio-$ENVIRONMENT-PostolioCluster"
    SERVICE_NAME="Postolio-$ENVIRONMENT-PostolioService"
    RUNNING_ECR_SHA=""
    
    if aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --region $AWS_REGION >/dev/null 2>&1; then
        # Get the task definition ARN from the service
        TASK_DEF_ARN=$(aws ecs describe-services \
            --cluster "$CLUSTER_NAME" \
            --services "$SERVICE_NAME" \
            --query 'services[0].taskDefinition' \
            --output text \
            --region $AWS_REGION 2>/dev/null || echo "")
        
        if [ -n "$TASK_DEF_ARN" ] && [ "$TASK_DEF_ARN" != "None" ]; then
            # Get the image URI from task definition
            RUNNING_IMAGE_URI=$(aws ecs describe-task-definition \
                --task-definition "$TASK_DEF_ARN" \
                --query 'taskDefinition.containerDefinitions[0].image' \
                --output text \
                --region $AWS_REGION 2>/dev/null || echo "")
            
            echo -e "${GREEN}ℹ️  Currently running image: $(basename "$RUNNING_IMAGE_URI")${NC}"
            
            # Extract SHA from the image URI if it contains @sha256:
            if [[ "$RUNNING_IMAGE_URI" == *"@sha256:"* ]]; then
                RUNNING_ECR_SHA="sha256:${RUNNING_IMAGE_URI#*@sha256:}"
            else
                echo -e "${YELLOW}ℹ️  Service is using tag-based image (not SHA)${NC}"
                # Check when the :latest tag was last updated vs when service was deployed
                BACKEND_CHANGED=false  # No source changes + tag-based = assume up to date
                return
            fi
        fi
    fi
    
    # Compare the SHAs
    if [ -z "$LATEST_ECR_SHA" ]; then
        echo -e "${YELLOW}⚠️  No :latest image found in ECR${NC}"
        BACKEND_CHANGED=false  # No source changes, no need to rebuild
    elif [ -z "$RUNNING_ECR_SHA" ]; then
        echo -e "${YELLOW}⚠️  Cannot determine running image SHA. Service may not exist yet.${NC}"
        BACKEND_CHANGED=false  # No source changes, assume deployment is needed for other reasons
    elif [ "$LATEST_ECR_SHA" = "$RUNNING_ECR_SHA" ]; then
        echo -e "${GREEN}✅ ECS is running the latest ECR image${NC}"
        echo "  Image SHA: ${LATEST_ECR_SHA:0:12}..."
        BACKEND_CHANGED=false
    else
        echo -e "${YELLOW}📦 ECS is running outdated image - update needed${NC}"
        echo "  Running SHA: ${RUNNING_ECR_SHA:0:12}..."
        echo "  Latest SHA:  ${LATEST_ECR_SHA:0:12}..."
        BACKEND_CHANGED=true  # Force update to latest image
    fi
}

# Smart change detection for conditional deployment  
detect_changes() {
    echo -e "${YELLOW}🔍 Detecting changes for smart deployment...${NC}"
    
    # Always check for frontend changes using git
    LAST_DEPLOY_COMMIT="HEAD~1"  # Simple: compare with previous commit
    FRONTEND_FILES=$(git diff --name-only $LAST_DEPLOY_COMMIT HEAD | grep -E "^frontend/" || true)
    if [ -n "$FRONTEND_FILES" ]; then
        FRONTEND_CHANGED=true
        echo -e "${GREEN}🎨 Frontend changes detected:${NC}"
        echo "$FRONTEND_FILES" | sed 's/^/  - /' | head -3
        [ $(echo "$FRONTEND_FILES" | wc -l) -gt 3 ] && echo "  - ... and $(( $(echo "$FRONTEND_FILES" | wc -l) - 3 )) more files"
    else
        FRONTEND_CHANGED=false
        echo -e "${GREEN}✅ No frontend changes detected${NC}"
    fi
    
    # Check infrastructure changes using git
    INFRA_FILES=$(git diff --name-only $LAST_DEPLOY_COMMIT HEAD | grep -E "^(aws-infrastructure/|scripts/deploy)" || true)
    if [ -n "$INFRA_FILES" ]; then
        INFRA_CHANGED=true
        echo -e "${GREEN}🏗️  Infrastructure changes detected:${NC}"
        echo "$INFRA_FILES" | sed 's/^/  - /'
    else
        INFRA_CHANGED=false
        echo -e "${GREEN}✅ No infrastructure changes detected${NC}"
    fi
    
    # Check backend changes using Docker image comparison (more reliable)
    detect_docker_image_changes
    
    echo
    echo -e "${YELLOW}📋 Smart Deployment Plan:${NC}"
    echo "  Backend deployment: $([ "$BACKEND_CHANGED" = true ] && echo -e "${YELLOW}YES${NC} (Docker image changed)" || echo -e "${GREEN}SKIP${NC} (Same image)")"
    echo "  Frontend deployment: $([ "$FRONTEND_CHANGED" = true ] && echo -e "${YELLOW}YES${NC} (Files changed)" || echo -e "${GREEN}SKIP${NC} (No changes)")"  
    echo "  Infrastructure deployment: $([ "$INFRA_CHANGED" = true ] && echo -e "${YELLOW}YES${NC} (Config changed)" || echo -e "${GREEN}SKIP${NC} (No changes)")"
    echo
}

# Force ECS service to use new Docker image (only when backend changed)
force_ecs_service_update() {
    # Skip if no backend changes detected
    if [ "$BACKEND_CHANGED" = false ]; then
        echo -e "${GREEN}⏭️  Skipping ECS service update - no backend changes detected${NC}"
        echo "This saves deployment time and avoids unnecessary container restarts!"
        return 0
    fi
    
    echo -e "${YELLOW}🔄 Forcing ECS service to use new Docker image...${NC}"
    
    # Get ECS cluster and service names
    CLUSTER_NAME="Postolio-$ENVIRONMENT-PostolioCluster"
    SERVICE_NAME="Postolio-$ENVIRONMENT-PostolioService"
    
    # Check if service exists
    if ! aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$SERVICE_NAME" \
        --region $AWS_REGION \
        --query 'services[0].serviceName' \
        --output text > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  ECS service not found yet. It may still be creating from CDK deployment.${NC}"
        echo "Service will automatically use the new image when it starts."
        return 0
    fi
    
    echo -e "${YELLOW}Updating ECS service: $SERVICE_NAME in cluster: $CLUSTER_NAME${NC}"
    
    # Force new deployment to pull latest image
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$SERVICE_NAME" \
        --force-new-deployment \
        --region $AWS_REGION > /dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ ECS service update initiated. New containers will start with latest image.${NC}"
        
        # Wait for deployment to stabilize (optional, but good for feedback)
        echo -e "${YELLOW}⏳ Waiting for deployment to stabilize (this may take 2-3 minutes)...${NC}"
        if aws ecs wait services-stable \
            --cluster "$CLUSTER_NAME" \
            --services "$SERVICE_NAME" \
            --region $AWS_REGION; then
            echo -e "${GREEN}✅ ECS service deployment completed successfully${NC}"
        else
            echo -e "${YELLOW}⚠️  Deployment in progress. Check ECS console for status.${NC}"
        fi
    else
        echo -e "${RED}❌ Failed to update ECS service. Check AWS console for details.${NC}"
        return 1
    fi
}

# Deploy infrastructure with security validation (only when infra changed)
deploy_infrastructure() {
    # Skip if no infrastructure changes detected (but always run on first deployment)
    if [ "$INFRA_CHANGED" = false ] && [ "$BACKEND_CHANGED" = false ]; then
        echo -e "${GREEN}⏭️  Skipping infrastructure deployment - no infrastructure or backend changes detected${NC}"
        echo "This saves CDK deployment time and reduces AWS API calls!"
        return 0
    fi
    
    if [ "$INFRA_CHANGED" = false ] && [ "$BACKEND_CHANGED" = true ]; then
        echo -e "${YELLOW}ℹ️  Infrastructure unchanged, but backend changed - running minimal CDK update${NC}"
    fi
    
    echo -e "${YELLOW}Deploying secure infrastructure with CDK Nag validation...${NC}"
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
    
    # Deploy the secure stack with ECR image
    npx cdk deploy Postolio-$ENVIRONMENT \
        --context environment=$ENVIRONMENT \
        --context account=$(aws sts get-caller-identity --query Account --output text) \
        --context region=$AWS_REGION \
        --context useEcrImage=true \
        $DOMAIN_ARGS \
        --require-approval never
    
    echo -e "${GREEN}✅ Secure infrastructure deployed successfully${NC}"
    echo -e "${GREEN}🛡️  All security features enabled: VPC Flow Logs, encryption at rest, non-default ports${NC}"
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
    
    # Create production environment file
    echo "VITE_API_BASE_URL=$API_URL" > .env.production
    
    # Build frontend
    echo -e "${YELLOW}Building frontend...${NC}"
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
    echo -e "${YELLOW}Updating application secrets...${NC}"
    
    SECRET_ARN=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`AppSecretsArn`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    echo "Please update the following secrets in AWS Secrets Manager:"
    echo "Secret ARN: $SECRET_ARN"
    echo ""
    echo "Required secrets (all environment variables are now stored in Secrets Manager):"
    echo "- openaiApiKey: Your OpenAI API key"
    echo "- facebookAppId: Your Facebook/Meta App ID"
    echo "- facebookAppSecret: Your Facebook/Meta App Secret"
    echo "- nodeEnv: production (already set)"
    echo "- port: 3000 (already set)"
    echo "- redisUrl: Redis connection URL (update with actual Redis endpoint after deployment)"
    echo "- instagramRedirectUri: Instagram OAuth callback (automatically configured)"
    echo ""
    echo "Database connection is automatically configured from RDS credentials."
    echo ""
    echo "Get the Redis endpoint for redisUrl:"
    echo "aws cloudformation describe-stacks --stack-name Postolio-$ENVIRONMENT --query 'Stacks[0].Outputs[?OutputKey==\`RedisEndpoint\`].OutputValue' --output text --region $AWS_REGION"
    echo ""
    echo "You can update secrets using the AWS Console or AWS CLI:"
    echo "aws secretsmanager update-secret --secret-id $SECRET_ARN --secret-string '{\"openaiApiKey\":\"YOUR_KEY\",\"facebookAppId\":\"YOUR_APP_ID\",\"facebookAppSecret\":\"YOUR_APP_SECRET\",\"redisUrl\":\"redis://REDIS_ENDPOINT:6380\"}'"
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
    detect_changes  # 🆕 Smart change detection
    build_and_push_image
    deploy_infrastructure
    force_ecs_service_update
    deploy_frontend
    show_deployment_info
    update_secrets
    tag_deployment
    
    echo
    echo -e "${GREEN}✨ Smart deployment complete! Your Postolio is now running on AWS with enhanced security.${NC}"
    echo -e "${GREEN}🛡️  Security features: VPC Flow Logs, database encryption, non-default ports, CDK Nag validated${NC}"
    echo -e "${GREEN}⚡ Optimizations: Smart change detection, conditional deployments, reduced downtime${NC}"
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
    force_ecs_service_update
    
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
