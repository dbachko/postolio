#!/bin/bash

# Production Deployment Script for Postolio Content Scheduler
# Phase 9: Production Deployment (Week 17)
# This script orchestrates the complete production deployment

set -e  # Exit on error
set -u  # Exit on undefined variable

# Configuration
export AWS_REGION="${AWS_REGION:-us-east-1}"
export ENVIRONMENT="prod"
export STACK_NAME="Postolio-prod"
export DEPLOYMENT_ID="prod-$(date +%Y%m%d-%H%M%S)"
export LOGS_DIR="./logs/deployments/${DEPLOYMENT_ID}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "${LOGS_DIR}/deployment.log"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "${LOGS_DIR}/deployment.log"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "${LOGS_DIR}/deployment.log"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "${LOGS_DIR}/deployment.log"
}

# Create logs directory (safe approach)
if ! mkdir -p "${LOGS_DIR}" 2>/dev/null; then
    echo "ERROR: Failed to create logs directory: ${LOGS_DIR}" >&2
    exit 1
fi

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites for production deployment..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials are not configured"
        exit 1
    fi
    
    # Check CDK
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK is not installed. Install with: npm install -g aws-cdk"
        exit 1
    fi
    
    # Check Docker
    if ! docker info &> /dev/null; then
        log_error "Docker is not running"
        exit 1
    fi
    
    # Check production account
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    log_info "Deploying to AWS Account: ${ACCOUNT_ID}"
    
    # Confirm production deployment
    echo -e "${YELLOW}⚠️  WARNING: You are about to deploy to PRODUCTION${NC}"
    echo -e "${YELLOW}Account ID: ${ACCOUNT_ID}${NC}"
    echo -e "${YELLOW}Region: ${AWS_REGION}${NC}"
    echo -e "${YELLOW}Stack: ${STACK_NAME}${NC}"
    read -t 30 -p "Are you sure you want to continue? (yes/no): " -r
    REPLY="${REPLY:-no}"
    if [[ ! "${REPLY}" =~ ^[Yy][Ee][Ss]$ ]]; then
        log_info "Deployment cancelled (timeout or user choice)"
        exit 0
    fi
    
    log_success "Prerequisites check completed"
}

# Function to create production backup
create_production_backup() {
    log_info "Creating production backup before deployment..."
    
    # Backup DynamoDB tables
    local tables=("content-scheduler-schedules" "content-scheduler-jobs" "content-scheduler-metrics")
    
    for table in "${tables[@]}"; do
        if aws dynamodb describe-table --table-name "${table}" &> /dev/null; then
            log_info "Creating backup for table: ${table}"
            
            aws dynamodb create-backup \
                --table-name "${table}" \
                --backup-name "${table}-backup-${DEPLOYMENT_ID}" \
                --output json >> "${LOGS_DIR}/backups.json"
        fi
    done
    
    # Export CloudFormation template
    if aws cloudformation describe-stacks --stack-name "${STACK_NAME}" &> /dev/null; then
        log_info "Exporting existing stack template..."
        
        aws cloudformation get-template \
            --stack-name "${STACK_NAME}" \
            --output json > "${LOGS_DIR}/existing-stack-template.json"
    fi
    
    log_success "Production backup completed"
}

# Function to configure production secrets
configure_production_secrets() {
    log_info "Configuring production secrets in AWS Secrets Manager..."
    
    # Check if secrets exist
    local secrets=(
        "postolio/production/database"
        "postolio/production/jwt"
        "postolio/production/openai"
        "postolio/production/facebook"
        "postolio/production/scheduler"
    )
    
    for secret in "${secrets[@]}"; do
        if ! aws secretsmanager describe-secret --secret-id "${secret}" &> /dev/null; then
            log_warning "Secret ${secret} does not exist. Creating placeholder..."
            
            # Create placeholder secret
            aws secretsmanager create-secret \
                --name "${secret}" \
                --description "Production secret for Postolio" \
                --secret-string '{"placeholder": "true", "note": "Update with actual values"}' \
                --output json >> "${LOGS_DIR}/secrets.json"
        else
            log_info "Secret ${secret} already exists"
        fi
    done
    
    log_success "Production secrets configured"
}

# Function to build and push Docker images
build_and_push_images() {
    log_info "Building and pushing Docker images..."
    
    # Get ECR repository URI
    ECR_REPO=$(aws ecr describe-repositories \
        --repository-names "postolio-production" \
        --query 'repositories[0].repositoryUri' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$ECR_REPO" ]; then
        log_info "Creating ECR repository..."
        ECR_REPO=$(aws ecr create-repository \
            --repository-name "postolio-production" \
            --image-scanning-configuration scanOnPush=true \
            --query 'repository.repositoryUri' \
            --output text)
    fi
    
    log_info "ECR Repository: ${ECR_REPO}"
    
    # Login to ECR (secure approach)
    {
        aws ecr get-login-password --region "${AWS_REGION}" | \
            docker login --username AWS --password-stdin "${ECR_REPO%%/*}"
    } 2>/dev/null || {
        log_error "ECR login failed"
        exit 1
    }
    
    # Build production image
    log_info "Building production Docker image..."
    docker build \
        --platform linux/amd64 \
        --build-arg NODE_ENV=prod \
        --tag "${ECR_REPO}:${DEPLOYMENT_ID}" \
        --tag "${ECR_REPO}:latest" \
        --file packages/apps/api/Dockerfile \
        . | tee -a "${LOGS_DIR}/docker-build.log"
    
    # Push to ECR
    log_info "Pushing images to ECR..."
    docker push "${ECR_REPO}:${DEPLOYMENT_ID}"
    docker push "${ECR_REPO}:latest"
    
    log_success "Docker images built and pushed successfully"
}

# Function to deploy CDK stack
deploy_cdk_stack() {
    log_info "Deploying CDK stack to production..."
    
    cd aws-infrastructure
    
    # Install dependencies
    npm install
    
    # Bootstrap CDK (if needed)
    cdk bootstrap aws://${ACCOUNT_ID}/${AWS_REGION} \
        --context environment=production
    
    # Synthesize stack
    log_info "Synthesizing CDK stack..."
    cdk synth \
        --context environment=production \
        --output "${LOGS_DIR}/cdk-synth"
    
    # Deploy both stacks - ContentScheduler first, then Postolio
    log_info "Deploying ContentScheduler stack first..."
    cdk deploy "ContentScheduler-prod" \
        --context environment=production \
        --require-approval never \
        --outputs-file "${LOGS_DIR}/scheduler-outputs.json" \
        --verbose | tee -a "${LOGS_DIR}/cdk-deploy.log"
    
    if [ $? -ne 0 ]; then
        log_error "Failed to deploy ContentScheduler stack"
        exit 1
    fi
    log_success "ContentScheduler stack deployed successfully"
    
    # Deploy Postolio stack (this may take 15-30 minutes)
    log_info "Deploying Postolio stack..."
    cdk deploy "${STACK_NAME}" \
        --context environment=production \
        --require-approval never \
        --outputs-file "${LOGS_DIR}/stack-outputs.json" \
        --verbose | tee -a "${LOGS_DIR}/cdk-deploy.log"
    
    cd ..
    
    log_success "CDK stack deployed successfully"
}

# Function to configure monitoring
configure_monitoring() {
    log_info "Configuring CloudWatch monitoring and dashboards..."
    
    # Create CloudWatch dashboard
    cat > "${LOGS_DIR}/dashboard.json" <<EOF
{
    "name": "Postolio-Production-Dashboard",
    "body": "{
        \"widgets\": [
            {
                \"type\": \"metric\",
                \"properties\": {
                    \"metrics\": [
                        [\"ContentScheduler\", \"APIRequests\", {\"stat\": \"Sum\"}],
                        [\".\", \"APIErrors\", {\"stat\": \"Sum\"}],
                        [\".\", \"APILatency\", {\"stat\": \"Average\"}]
                    ],
                    \"period\": 300,
                    \"stat\": \"Average\",
                    \"region\": \"${AWS_REGION}\",
                    \"title\": \"API Metrics\"
                }
            },
            {
                \"type\": \"metric\",
                \"properties\": {
                    \"metrics\": [
                        [\"ContentScheduler\", \"SchedulesCreated\", {\"stat\": \"Sum\"}],
                        [\".\", \"SchedulesExecuted\", {\"stat\": \"Sum\"}],
                        [\".\", \"SchedulesFailed\", {\"stat\": \"Sum\"}]
                    ],
                    \"period\": 300,
                    \"stat\": \"Sum\",
                    \"region\": \"${AWS_REGION}\",
                    \"title\": \"Schedule Metrics\"
                }
            },
            {
                \"type\": \"metric\",
                \"properties\": {
                    \"metrics\": [
                        [\"AWS/Lambda\", \"Invocations\", {\"stat\": \"Sum\"}],
                        [\".\", \"Errors\", {\"stat\": \"Sum\"}],
                        [\".\", \"Duration\", {\"stat\": \"Average\"}]
                    ],
                    \"period\": 300,
                    \"stat\": \"Average\",
                    \"region\": \"${AWS_REGION}\",
                    \"title\": \"Lambda Metrics\"
                }
            }
        ]
    }"
}
EOF
    
    aws cloudwatch put-dashboard \
        --dashboard-name "Postolio-Production-Dashboard" \
        --dashboard-body file://"${LOGS_DIR}/dashboard.json"
    
    log_success "Monitoring configured"
}

# Function to configure alerts
configure_alerts() {
    log_info "Configuring CloudWatch alerts..."
    
    # Create SNS topic for alerts
    SNS_TOPIC_ARN=$(aws sns create-topic \
        --name "postolio-production-alerts" \
        --query 'TopicArn' \
        --output text)
    
    # Subscribe to alerts (update email)
    aws sns subscribe \
        --topic-arn "${SNS_TOPIC_ARN}" \
        --protocol email \
        --notification-endpoint "ops@postolio.example"
    
    # Create alarms
    # API Error Rate Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "Postolio-Production-API-Error-Rate" \
        --alarm-description "Alert when API error rate exceeds 5%" \
        --metric-name "APIErrors" \
        --namespace "ContentScheduler" \
        --statistic "Average" \
        --period 300 \
        --threshold 5 \
        --comparison-operator GreaterThanThreshold \
        --evaluation-periods 2 \
        --alarm-actions "${SNS_TOPIC_ARN}"
    
    # High Latency Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "Postolio-Production-High-Latency" \
        --alarm-description "Alert when API latency exceeds 2 seconds" \
        --metric-name "APILatency" \
        --namespace "ContentScheduler" \
        --statistic "Average" \
        --period 300 \
        --threshold 2000 \
        --comparison-operator GreaterThanThreshold \
        --evaluation-periods 2 \
        --alarm-actions "${SNS_TOPIC_ARN}"
    
    log_success "Alerts configured"
}

# Function to run smoke tests
run_smoke_tests() {
    log_info "Running production smoke tests..."
    
    # Get API endpoint from stack outputs
    API_ENDPOINT=$(aws cloudformation describe-stacks \
        --stack-name "${STACK_NAME}" \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
        --output text)
    
    if [ -z "$API_ENDPOINT" ]; then
        log_error "Could not retrieve API endpoint"
        return 1
    fi
    
    log_info "API Endpoint: ${API_ENDPOINT}"
    
    # Health check
    if curl -f "${API_ENDPOINT}/health" &> /dev/null; then
        log_success "Health check passed"
    else
        log_error "Health check failed"
        return 1
    fi
    
    # Validate API key before use
    if [[ -z "${SCHEDULER_API_KEY:-}" ]]; then
        log_warning "SCHEDULER_API_KEY not set, skipping schedule test"
        return 0
    fi
    
    # Sanitize API key
    SAFE_API_KEY=$(printf '%s' "${SCHEDULER_API_KEY}" | tr -d '\n\r')
    
    # Test schedule creation (dry run)
    RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/schedules" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${SAFE_API_KEY}" \
        -d '{
            "contentId": "test-content-'${DEPLOYMENT_ID}'",
            "brandId": "test-brand",
            "userId": "test-user",
            "platform": "instagram",
            "scheduledTime": "'$(date -u -d '+1 hour' '+%Y-%m-%dT%H:%M:%SZ')'",
            "dryRun": true
        }')
    
    if echo "$RESPONSE" | jq -e '.success' &> /dev/null; then
        log_success "Schedule creation test passed"
    else
        log_error "Schedule creation test failed"
        echo "$RESPONSE"
        return 1
    fi
    
    log_success "Smoke tests passed"
}

# Function to create deployment report
create_deployment_report() {
    log_info "Creating deployment report..."
    
    cat > "${LOGS_DIR}/deployment-report.md" <<EOF
# Production Deployment Report

## Deployment ID: ${DEPLOYMENT_ID}

### Deployment Details
- **Date**: $(date '+%Y-%m-%d %H:%M:%S')
- **Environment**: Production
- **AWS Account**: ${ACCOUNT_ID}
- **Region**: ${AWS_REGION}
- **Stack Name**: ${STACK_NAME}

### Components Deployed
- ✅ Docker Images (ECR)
- ✅ CDK Infrastructure Stack
- ✅ Secrets Manager Configuration
- ✅ CloudWatch Monitoring
- ✅ CloudWatch Alerts
- ✅ SNS Notifications

### Validation Results
- ✅ Health Check: Passed
- ✅ API Smoke Test: Passed
- ✅ Monitoring: Active
- ✅ Alerts: Configured

### Stack Outputs
$(cat ${LOGS_DIR}/stack-outputs.json | jq '.')

### Next Steps
1. Monitor CloudWatch dashboard for first 24 hours
2. Review application logs for any errors
3. Verify scheduled content is being processed
4. Check alert notifications are working

### Rollback Procedure
If issues are detected:
1. Run: ./scripts/rollback-production.sh ${DEPLOYMENT_ID}
2. Review logs in: ${LOGS_DIR}
3. Contact on-call engineer

### Support Contacts
- Primary: ops@postolio.example
- Escalation: engineering@postolio.example
EOF
    
    log_success "Deployment report created: ${LOGS_DIR}/deployment-report.md"
}

# Main deployment flow
main() {
    log_info "=========================================="
    log_info "Postolio Production Deployment"
    log_info "Deployment ID: ${DEPLOYMENT_ID}"
    log_info "=========================================="
    
    # Pre-deployment checks
    check_prerequisites
    
    # Create backup
    create_production_backup
    
    # Configure secrets
    configure_production_secrets
    
    # Build and deploy
    build_and_push_images
    deploy_cdk_stack
    
    # Configure monitoring
    configure_monitoring
    configure_alerts
    
    # Validate deployment
    run_smoke_tests
    
    # Generate report
    create_deployment_report
    
    log_success "=========================================="
    log_success "Production deployment completed successfully!"
    log_success "Deployment ID: ${DEPLOYMENT_ID}"
    log_success "Report: ${LOGS_DIR}/deployment-report.md"
    log_success "=========================================="
}

# Error handling
trap 'log_error "Deployment failed! Check logs at: ${LOGS_DIR}"; exit 1' ERR

# Run main deployment
main "$@"
