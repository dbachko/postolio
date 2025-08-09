#!/bin/bash

# AWS Infrastructure Deployment Scripts for AI Agency

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
        exit 1
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

# Bootstrap CDK if needed
bootstrap_cdk() {
    echo -e "${YELLOW}Checking CDK bootstrap...${NC}"
    cd "$PROJECT_ROOT/aws-infrastructure"
    
    # Get AWS account and region
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    
    # Check if bootstrap stack exists
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
        echo -e "${YELLOW}Bootstrapping CDK for account $AWS_ACCOUNT in region $AWS_REGION...${NC}"
        npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION
    else
        echo -e "${GREEN}✅ CDK already bootstrapped${NC}"
    fi
}

# Create ECR repository if it doesn't exist
setup_ecr() {
    echo -e "${YELLOW}Setting up ECR repository...${NC}"
    
    REPO_NAME="ai-agency"
    
    if ! aws ecr describe-repositories --repository-names $REPO_NAME --region $AWS_REGION &> /dev/null; then
        echo -e "${YELLOW}Creating ECR repository: $REPO_NAME${NC}"
        aws ecr create-repository --repository-name $REPO_NAME --region $AWS_REGION
        
        # Set lifecycle policy to manage image retention
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
            --region $AWS_REGION
    else
        echo -e "${GREEN}✅ ECR repository already exists${NC}"
    fi
}

# Build and push Docker image
build_and_push_image() {
    echo -e "${YELLOW}Building and pushing Docker image...${NC}"
    cd "$PROJECT_ROOT"
    
    # Get ECR login token
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com
    
    # Build image
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/ai-agency:latest"
    
    echo -e "${YELLOW}Building image: $IMAGE_URI${NC}"
    docker build -t ai-agency:latest .
    docker tag ai-agency:latest $IMAGE_URI
    
    # Push image
    echo -e "${YELLOW}Pushing image to ECR...${NC}"
    docker push $IMAGE_URI
    
    echo -e "${GREEN}✅ Image pushed successfully${NC}"
}

# Deploy infrastructure
deploy_infrastructure() {
    echo -e "${YELLOW}Deploying infrastructure...${NC}"
    cd "$PROJECT_ROOT/aws-infrastructure"
    
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
    
    # Deploy the stack
    npx cdk deploy AiAgency-$ENVIRONMENT \
        --context environment=$ENVIRONMENT \
        --context account=$(aws sts get-caller-identity --query Account --output text) \
        --context region=$AWS_REGION \
        $DOMAIN_ARGS \
        --require-approval never
    
    echo -e "${GREEN}✅ Infrastructure deployed successfully${NC}"
}

# Deploy frontend
deploy_frontend() {
    echo -e "${YELLOW}Deploying frontend...${NC}"
    cd "$PROJECT_ROOT/frontend"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    
    # Get the load balancer DNS name from the stack
    LOAD_BALANCER_DNS=$(aws cloudformation describe-stacks \
        --stack-name AiAgency-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    # Create production environment file
    echo "VITE_API_URL=https://$LOAD_BALANCER_DNS" > .env.production
    
    # Build frontend
    npm run build
    
    # Get S3 bucket name from the stack
    BUCKET_NAME=$(aws cloudformation describe-stacks \
        --stack-name AiAgency-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    # Upload to S3
    echo -e "${YELLOW}Uploading frontend to S3 bucket: $BUCKET_NAME${NC}"
    aws s3 sync dist s3://$BUCKET_NAME --delete --region $AWS_REGION
    
    # Invalidate CloudFront cache
    DISTRIBUTION_ID=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?Comment=='AiAgency-$ENVIRONMENT/FrontendDistribution'].Id" \
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
        --stack-name AiAgency-$ENVIRONMENT \
        --query 'Stacks[0].Outputs' \
        --output table \
        --region $AWS_REGION)
    
    echo "$OUTPUTS"
    
    # Get application URL
    APP_URL=$(aws cloudformation describe-stacks \
        --stack-name AiAgency-$ENVIRONMENT \
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
                --stack-name AiAgency-$ENVIRONMENT \
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
        --stack-name AiAgency-$ENVIRONMENT \
        --query 'Stacks[0].Outputs[?OutputKey==`AppSecretsArn`].OutputValue' \
        --output text \
        --region $AWS_REGION)
    
    echo "Please update the following secrets in AWS Secrets Manager:"
    echo "Secret ARN: $SECRET_ARN"
    echo ""
    echo "Required secrets:"
    echo "- openaiApiKey: Your OpenAI API key"
    echo "- facebookAppId: Your Facebook/Meta App ID"
    echo "- facebookAppSecret: Your Facebook/Meta App Secret"
    echo ""
    echo "Database connection will be automatically configured from RDS credentials."
    echo ""
    echo "You can update these using the AWS Console or AWS CLI:"
    echo "aws secretsmanager update-secret --secret-id $SECRET_ARN --secret-string '{\"openaiApiKey\":\"YOUR_KEY\",\"facebookAppId\":\"YOUR_APP_ID\",\"facebookAppSecret\":\"YOUR_APP_SECRET\"}'"
}

# Main deployment function
main() {
    echo -e "${GREEN}🏗️  AI Agency AWS Deployment${NC}"
    echo "Environment: $ENVIRONMENT"
    echo "Region: $AWS_REGION"
    echo

    check_requirements
    setup_infrastructure
    bootstrap_cdk
    setup_ecr
    build_and_push_image
    deploy_infrastructure
    deploy_frontend
    show_deployment_info
    update_secrets
    
    echo
    echo -e "${GREEN}✨ Deployment complete! Your AI Agency is now running on AWS.${NC}"
}

# Handle script arguments
case "${2:-deploy}" in
    "deploy")
        main
        ;;
    "destroy")
        echo -e "${YELLOW}⚠️  Destroying infrastructure for environment: $ENVIRONMENT${NC}"
        echo "This will permanently delete all resources. Are you sure? (yes/no)"
        read -r confirmation
        if [ "$confirmation" = "yes" ]; then
            cd "$PROJECT_ROOT/aws-infrastructure"
            npx cdk destroy AiAgency-$ENVIRONMENT --force
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
        echo "Actions: deploy|destroy|update-secrets (default: deploy)"
        exit 1
        ;;
esac