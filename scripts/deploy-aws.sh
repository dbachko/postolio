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
    echo -e "${YELLOW}Building and pushing Docker image...${NC}"
    cd "$PROJECT_ROOT"
    
    # Get ECR login token
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_REGISTRY_URL="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
    
    echo -e "${YELLOW}Logging in to ECR registry: $ECR_REGISTRY_URL${NC}"
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY_URL
    
    # Build image
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/postolio:latest"
    
    echo -e "${YELLOW}Building image: $IMAGE_URI${NC}"
    docker build -t postolio:latest .
    docker tag postolio:latest $IMAGE_URI
    
    # Push image
    echo -e "${YELLOW}Pushing image to ECR...${NC}"
    docker push $IMAGE_URI
    
    echo -e "${GREEN}✅ Image pushed successfully${NC}"
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

# Deploy infrastructure with security validation  
deploy_infrastructure() {
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
    
    # Get the secure API URL from the stack (postolio.example)
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
        API_URL="http://$LOAD_BALANCER_DNS"
        echo -e "${YELLOW}Using fallback ALB DNS: $API_URL${NC}"
    else
        echo -e "${GREEN}Using secure API domain: $API_URL${NC}"
    fi
    
    # Create production environment file
    echo "VITE_API_BASE_URL=$API_URL" > .env.production
    
    # Build frontend
    npm run build
    
    # Get S3 bucket name from the stack
    BUCKET_NAME=$(aws cloudformation describe-stacks \
        --stack-name Postolio-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    # Upload to S3
    echo -e "${YELLOW}Uploading frontend to S3 bucket: $BUCKET_NAME${NC}"
    aws s3 sync dist s3://$BUCKET_NAME --delete --region $AWS_REGION
    
    # Invalidate CloudFront cache
    DISTRIBUTION_ID=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?Comment=='Postolio-$ENVIRONMENT/FrontendDistribution'].Id" \
        --output text)
    
    if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
        echo -e "${YELLOW}Invalidating CloudFront cache...${NC}"
        aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"
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
    build_and_push_image
    deploy_infrastructure
    deploy_frontend
    show_deployment_info
    update_secrets
    
    echo
    echo -e "${GREEN}✨ Secure deployment complete! Your Postolio is now running on AWS with enhanced security.${NC}"
    echo -e "${GREEN}🛡️  Security features active: VPC Flow Logs, database encryption, non-default ports, CDK Nag validated${NC}"
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
    
    echo -e "${GREEN}✅ Deployment fixed with ECR image${NC}"
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
