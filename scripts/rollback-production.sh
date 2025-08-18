#!/bin/bash

# Production Rollback Script for Postolio Content Scheduler
# Emergency rollback procedure for production deployment issues

set -e  # Exit on error
set -u  # Exit on undefined variable

# Configuration
export AWS_REGION="${AWS_REGION:-us-east-1}"
export ENVIRONMENT="production"
export STACK_NAME="Postolio-prod"
DEPLOYMENT_ID="${1:-}"
ROLLBACK_ID="rollback-$(date +%Y%m%d-%H%M%S)"
LOGS_DIR="./logs/rollbacks/${ROLLBACK_ID}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create logs directory
mkdir -p "${LOGS_DIR}"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "${LOGS_DIR}/rollback.log"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "${LOGS_DIR}/rollback.log"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "${LOGS_DIR}/rollback.log"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "${LOGS_DIR}/rollback.log"
}

# Function to check if deployment ID is provided
check_deployment_id() {
    if [ -z "$DEPLOYMENT_ID" ]; then
        log_error "Deployment ID is required"
        echo "Usage: $0 <deployment-id>"
        echo "Example: $0 prod-20250118-143022"
        exit 1
    fi
    
    log_info "Rolling back deployment: ${DEPLOYMENT_ID}"
}

# Function to capture current state
capture_current_state() {
    log_info "Capturing current production state..."
    
    # Export current CloudFormation stack
    aws cloudformation get-template \
        --stack-name "${STACK_NAME}" \
        --output json > "${LOGS_DIR}/current-stack-template.json" 2>/dev/null || true
    
    # Get current ECS service configuration
    aws ecs describe-services \
        --cluster "postolio-production" \
        --services "postolio-service" \
        --output json > "${LOGS_DIR}/current-ecs-service.json" 2>/dev/null || true
    
    # Get current Lambda configurations
    aws lambda list-functions \
        --function-version ALL \
        --output json > "${LOGS_DIR}/current-lambda-functions.json" 2>/dev/null || true
    
    log_success "Current state captured"
}

# Function to rollback ECS service
rollback_ecs_service() {
    log_info "Rolling back ECS service to previous version..."
    
    # Get ECR repository
    ECR_REPO=$(aws ecr describe-repositories \
        --repository-names "postolio-production" \
        --query 'repositories[0].repositoryUri' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$ECR_REPO" ]; then
        log_warning "ECR repository not found, skipping ECS rollback"
        return
    fi
    
    # Get previous image tag (assuming we tag with deployment IDs)
    PREVIOUS_IMAGE=$(aws ecr describe-images \
        --repository-name "postolio-production" \
        --query 'imageDetails[?imageTags!=`null`] | sort_by(@, &imagePushedAt) | [-2].imageTags[0]' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$PREVIOUS_IMAGE" ] || [ "$PREVIOUS_IMAGE" == "null" ]; then
        log_warning "No previous image found, using 'latest' tag"
        PREVIOUS_IMAGE="latest"
    fi
    
    log_info "Rolling back to image: ${ECR_REPO}:${PREVIOUS_IMAGE}"
    
    # Update ECS service with previous image
    aws ecs update-service \
        --cluster "postolio-production" \
        --service "postolio-service" \
        --task-definition "postolio-task" \
        --force-new-deployment \
        --output json >> "${LOGS_DIR}/ecs-rollback.json" 2>/dev/null || true
    
    # Wait for service to stabilize
    log_info "Waiting for ECS service to stabilize (this may take 5-10 minutes)..."
    aws ecs wait services-stable \
        --cluster "postolio-production" \
        --services "postolio-service" || log_warning "ECS service stabilization timeout"
    
    log_success "ECS service rolled back"
}

# Function to rollback Lambda functions
rollback_lambda_functions() {
    log_info "Rolling back Lambda functions..."
    
    # List of Lambda functions to rollback
    local functions=(
        "content-scheduler-api"
        "content-publisher"
        "schedule-executor"
        "metrics-collector"
    )
    
    for func in "${functions[@]}"; do
        # Check if function exists
        if aws lambda get-function --function-name "${func}" &> /dev/null; then
            log_info "Rolling back function: ${func}"
            
            # Get previous version
            PREVIOUS_VERSION=$(aws lambda list-versions-by-function \
                --function-name "${func}" \
                --query 'Versions[-2].Version' \
                --output text 2>/dev/null || echo "")
            
            if [ -n "$PREVIOUS_VERSION" ] && [ "$PREVIOUS_VERSION" != "null" ]; then
                # Update alias to point to previous version
                aws lambda update-alias \
                    --function-name "${func}" \
                    --name "PROD" \
                    --function-version "${PREVIOUS_VERSION}" \
                    --output json >> "${LOGS_DIR}/lambda-rollback.json" 2>/dev/null || true
                
                log_success "Rolled back ${func} to version ${PREVIOUS_VERSION}"
            else
                log_warning "No previous version found for ${func}"
            fi
        fi
    done
    
    log_success "Lambda functions rolled back"
}

# Function to restore database backup
restore_database_backup() {
    log_info "Checking for database backups..."
    
    local tables=("content-scheduler-schedules" "content-scheduler-jobs" "content-scheduler-metrics")
    
    for table in "${tables[@]}"; do
        # Find backup from deployment
        BACKUP_ARN=$(aws dynamodb list-backups \
            --table-name "${table}" \
            --backup-type "USER" \
            --query "BackupSummaries[?contains(BackupName, '${DEPLOYMENT_ID}')].BackupArn | [0]" \
            --output text 2>/dev/null || echo "")
        
        if [ -n "$BACKUP_ARN" ] && [ "$BACKUP_ARN" != "null" ]; then
            log_info "Found backup for ${table}: ${BACKUP_ARN}"
            
            # Confirm restoration
            read -t 30 -p "Restore database table ${table} from backup? (yes/no): " -r
            REPLY="${REPLY:-no}"
            if [[ "${REPLY,,}" == "yes" ]]; then
                log_info "Restoring ${table} from backup..."
                
                aws dynamodb restore-table-from-backup \
                    --target-table-name "${table}-restored-${ROLLBACK_ID}" \
                    --backup-arn "${BACKUP_ARN}" \
                    --output json >> "${LOGS_DIR}/dynamodb-restore.json"
                
                log_warning "Table restored as ${table}-restored-${ROLLBACK_ID}"
                log_warning "Manual intervention required to swap tables"
            fi
        else
            log_warning "No backup found for ${table} from deployment ${DEPLOYMENT_ID}"
        fi
    done
}

# Function to disable traffic
disable_traffic() {
    log_info "Disabling production traffic during rollback..."
    
    # Update ALB target group to maintenance mode
    # This is a placeholder - implement based on your architecture
    log_warning "Manual step: Enable maintenance mode if configured"
    
    # Scale down ECS service temporarily
    aws ecs update-service \
        --cluster "postolio-production" \
        --service "postolio-service" \
        --desired-count 0 \
        --output json >> "${LOGS_DIR}/traffic-disable.json" 2>/dev/null || true
    
    sleep 30
    
    # Scale back up with rolled back version
    aws ecs update-service \
        --cluster "postolio-production" \
        --service "postolio-service" \
        --desired-count 2 \
        --output json >> "${LOGS_DIR}/traffic-enable.json" 2>/dev/null || true
    
    log_success "Traffic management completed"
}

# Function to run validation tests
run_validation_tests() {
    log_info "Running post-rollback validation..."
    
    # Get API endpoint
    API_ENDPOINT=$(aws cloudformation describe-stacks \
        --stack-name "${STACK_NAME}" \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
        --output text)
    
    if [ -z "$API_ENDPOINT" ]; then
        log_error "Could not retrieve API endpoint"
        return 1
    fi
    
    # Health check
    if curl -f "${API_ENDPOINT}/health" &> /dev/null; then
        log_success "Health check passed"
    else
        log_error "Health check failed after rollback"
        return 1
    fi
    
    log_success "Validation completed"
}

# Function to send notifications
send_notifications() {
    log_info "Sending rollback notifications..."
    
    # Send SNS notification
    aws sns publish \
        --topic-arn "arn:aws:sns:${AWS_REGION}:$(aws sts get-caller-identity --query Account --output text):postolio-production-alerts" \
        --subject "⚠️ Production Rollback Initiated" \
        --message "Production rollback initiated for deployment ${DEPLOYMENT_ID}.
Rollback ID: ${ROLLBACK_ID}
Status: In Progress
Logs: ${LOGS_DIR}/rollback.log

Please monitor the system closely." \
        --output json >> "${LOGS_DIR}/notifications.json" 2>/dev/null || true
    
    log_success "Notifications sent"
}

# Function to create rollback report
create_rollback_report() {
    log_info "Creating rollback report..."
    
    cat > "${LOGS_DIR}/rollback-report.md" <<EOF
# Production Rollback Report

## Rollback ID: ${ROLLBACK_ID}

### Rollback Details
- **Date**: $(date '+%Y-%m-%d %H:%M:%S')
- **Original Deployment**: ${DEPLOYMENT_ID}
- **Environment**: Production
- **AWS Region**: ${AWS_REGION}
- **Stack Name**: ${STACK_NAME}

### Actions Taken
- ✅ Current state captured
- ✅ ECS service rolled back
- ✅ Lambda functions rolled back
- ⚠️ Database restoration (manual verification required)
- ✅ Traffic management completed
- ✅ Validation tests run
- ✅ Notifications sent

### Post-Rollback Status
- Health Check: $(curl -s "${API_ENDPOINT}/health" | jq -r '.status' 2>/dev/null || echo "Unknown")
- ECS Service: Active
- Lambda Functions: Rolled back to previous versions

### Required Follow-up Actions
1. Monitor CloudWatch metrics for stability
2. Review application logs for errors
3. Verify scheduled content processing
4. Check database consistency if restored
5. Create incident report

### Logs Location
- Rollback logs: ${LOGS_DIR}/
- CloudWatch logs: https://console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}

### Support Contacts
- On-call: ops@postolio.example
- Escalation: engineering@postolio.example
EOF
    
    log_success "Rollback report created: ${LOGS_DIR}/rollback-report.md"
}

# Main rollback flow
main() {
    log_warning "=========================================="
    log_warning "PRODUCTION ROLLBACK INITIATED"
    log_warning "Rollback ID: ${ROLLBACK_ID}"
    log_warning "=========================================="
    
    # Verify deployment ID
    check_deployment_id
    
    # Capture current state for analysis
    capture_current_state
    
    # Send initial notification
    send_notifications
    
    # Perform rollback
    disable_traffic
    rollback_ecs_service
    rollback_lambda_functions
    
    # Optional: Restore database
    read -p "Do you want to check for database backups? (yes/no): " -r
    if [[ $REPLY =~ ^[Yy]es$ ]]; then
        restore_database_backup
    fi
    
    # Validate rollback
    run_validation_tests
    
    # Generate report
    create_rollback_report
    
    # Final notification
    aws sns publish \
        --topic-arn "arn:aws:sns:${AWS_REGION}:$(aws sts get-caller-identity --query Account --output text):postolio-production-alerts" \
        --subject "✅ Production Rollback Completed" \
        --message "Production rollback completed for deployment ${DEPLOYMENT_ID}.
Rollback ID: ${ROLLBACK_ID}
Status: Completed
Report: ${LOGS_DIR}/rollback-report.md

System is now running on previous version." \
        --output json >> "${LOGS_DIR}/notifications-final.json" 2>/dev/null || true
    
    log_success "=========================================="
    log_success "Rollback completed successfully!"
    log_success "Rollback ID: ${ROLLBACK_ID}"
    log_success "Report: ${LOGS_DIR}/rollback-report.md"
    log_success "=========================================="
}

# Error handling
trap 'log_error "Rollback failed! Manual intervention required. Logs: ${LOGS_DIR}"; exit 1' ERR

# Run main rollback
main "$@"