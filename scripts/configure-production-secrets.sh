#!/bin/bash

# Production Secrets Configuration Script
# Sets up all required secrets in AWS Secrets Manager for production deployment

set -e  # Exit on error
set -u  # Exit on undefined variable

# Configuration
export AWS_REGION="${AWS_REGION:-us-east-1}"
export ENVIRONMENT="production"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Function to generate secure passwords
generate_secure_password() {
    local length=${1:-32}
    openssl rand -base64 "$length" | tr -d "=+/" | cut -c1-"$length"
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
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
    
    # Check jq for JSON processing
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed. Install with: brew install jq"
        exit 1
    fi
    
    log_success "Prerequisites met"
}

# Function to create or update secret
create_or_update_secret() {
    local secret_name=$1
    local secret_value=$2
    local description=$3
    
    if aws secretsmanager describe-secret --secret-id "${secret_name}" &> /dev/null; then
        log_info "Updating existing secret: ${secret_name}"
        aws secretsmanager update-secret \
            --secret-id "${secret_name}" \
            --secret-string "${secret_value}" \
            --description "${description}" \
            --output json > /dev/null
    else
        log_info "Creating new secret: ${secret_name}"
        aws secretsmanager create-secret \
            --name "${secret_name}" \
            --description "${description}" \
            --secret-string "${secret_value}" \
            --tags "Key=Environment,Value=${ENVIRONMENT}" "Key=Application,Value=Postolio" \
            --output json > /dev/null
    fi
    
    log_success "Secret configured: ${secret_name}"
}

# Function to configure database secrets
configure_database_secrets() {
    log_info "Configuring database secrets..."
    
    # Production RDS configuration
    local db_password=$(generate_secure_password 32)
    local db_secret='{
        "engine": "postgres",
        "host": "postolio-prod.cluster-xxxxx.us-east-1.rds.amazonaws.com",
        "port": 5432,
        "database": "postolio",
        "username": "postolio_admin",
        "password": "'${db_password}'",
        "ssl": true,
        "connectionUrl": "postgresql://postolio_admin:password@postolio-prod.cluster-xxxxx.us-east-1.rds.amazonaws.com:5432/postolio?sslmode=require"
    }'
    
    create_or_update_secret \
        "postolio/production/database" \
        "${db_secret}" \
        "Production database connection credentials"
    
    # Redis configuration
    local redis_password=$(generate_secure_password 32)
    local redis_secret='{
        "host": "postolio-prod-redis.xxxxx.cache.amazonaws.com",
        "port": 6379,
        "password": "'${redis_password}'",
        "tls": true,
        "connectionUrl": "rediss://:password@postolio-prod-redis.xxxxx.cache.amazonaws.com:6379"
    }'
    
    create_or_update_secret \
        "postolio/production/redis" \
        "${redis_secret}" \
        "Production Redis connection credentials"
}

# Function to configure authentication secrets
configure_auth_secrets() {
    log_info "Configuring authentication secrets..."
    
    # JWT configuration
    local jwt_secret='{
        "secret": "'$(openssl rand -base64 64)'",
        "expiresIn": "7d",
        "refreshExpiresIn": "30d",
        "algorithm": "HS256"
    }'
    
    create_or_update_secret \
        "postolio/production/jwt" \
        "${jwt_secret}" \
        "Production JWT signing configuration"
}

# Function to configure API secrets
configure_api_secrets() {
    log_info "Configuring API secrets..."
    
    # OpenAI API configuration
    echo -n "Enter OpenAI API Key (or press Enter to skip): "
    read -s openai_key
    echo  # New line after hidden input
    if [ -n "${openai_key}" ]; then
        local openai_secret='{
            "apiKey": "'${openai_key}'",
            "organization": "",
            "model": "gpt-4-turbo-preview",
            "imageModel": "dall-e-3"
        }'
        
        create_or_update_secret \
            "postolio/production/openai" \
            "${openai_secret}" \
            "Production OpenAI API configuration"
    else
        log_warning "Skipping OpenAI configuration - update manually later"
    fi
    
    # Facebook/Instagram API configuration
    read -p "Enter Facebook App ID (or press Enter to skip): " fb_app_id
    echo -n "Enter Facebook App Secret (or press Enter to skip): "
    read -s fb_app_secret
    echo  # New line after hidden input
    
    if [ -n "${fb_app_id}" ] && [ -n "${fb_app_secret}" ]; then
        local facebook_secret='{
            "appId": "'${fb_app_id}'",
            "appSecret": "'${fb_app_secret}'",
            "clientToken": "",
            "redirectUri": "https://postolio.example/auth/instagram/callback"
        }'
        
        create_or_update_secret \
            "postolio/production/facebook" \
            "${facebook_secret}" \
            "Production Facebook/Instagram API configuration"
    else
        log_warning "Skipping Facebook configuration - update manually later"
    fi
}

# Function to configure scheduler secrets
configure_scheduler_secrets() {
    log_info "Configuring scheduler secrets..."
    
    # Generate API key for scheduler service
    local scheduler_api_key=$(openssl rand -base64 32)
    
    local scheduler_secret='{
        "apiKey": "'${scheduler_api_key}'",
        "apiUrl": "https://postolio.example",
        "maxRetries": 3,
        "retryDelay": 1000,
        "timeout": 30000
    }'
    
    create_or_update_secret \
        "postolio/production/scheduler" \
        "${scheduler_secret}" \
        "Production content scheduler configuration"
    
    # Store the API key separately for Lambda functions
    create_or_update_secret \
        "postolio/production/scheduler-api-key" \
        "${scheduler_api_key}" \
        "Content scheduler API key"
}

# Function to configure monitoring secrets
configure_monitoring_secrets() {
    log_info "Configuring monitoring secrets..."
    
    # DataDog integration (optional)
    local monitoring_secret='{
        "datadogApiKey": "",
        "datadogAppKey": "",
        "sentryDsn": "",
        "slackWebhook": "",
        "pagerdutyKey": ""
    }'
    
    create_or_update_secret \
        "postolio/production/monitoring" \
        "${monitoring_secret}" \
        "Production monitoring integrations"
}

# Function to configure platform credentials
configure_platform_secrets() {
    log_info "Configuring platform-specific secrets..."
    
    # TikTok API (future)
    local tiktok_secret='{
        "clientKey": "",
        "clientSecret": "",
        "redirectUri": "https://postolio.example/auth/tiktok/callback"
    }'
    
    create_or_update_secret \
        "postolio/production/tiktok" \
        "${tiktok_secret}" \
        "Production TikTok API configuration"
    
    # Twitter/X API (future)
    local twitter_secret='{
        "apiKey": "",
        "apiSecret": "",
        "bearerToken": "",
        "redirectUri": "https://postolio.example/auth/twitter/callback"
    }'
    
    create_or_update_secret \
        "postolio/production/twitter" \
        "${twitter_secret}" \
        "Production Twitter/X API configuration"
    
    # LinkedIn API (future)
    local linkedin_secret='{
        "clientId": "",
        "clientSecret": "",
        "redirectUri": "https://postolio.example/auth/linkedin/callback"
    }'
    
    create_or_update_secret \
        "postolio/production/linkedin" \
        "${linkedin_secret}" \
        "Production LinkedIn API configuration"
}

# Function to configure encryption keys
configure_encryption_keys() {
    log_info "Configuring encryption keys..."
    
    # Data encryption key
    local encryption_secret='{
        "dataKey": "'$(openssl rand -base64 32)'",
        "algorithm": "aes-256-gcm",
        "rotationSchedule": "90d"
    }'
    
    create_or_update_secret \
        "postolio/production/encryption" \
        "${encryption_secret}" \
        "Production data encryption configuration"
}

# Function to grant permissions to services
grant_permissions() {
    log_info "Granting permissions to AWS services..."
    
    # Get account ID
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    
    # Create resource policy for Lambda access
    local policy='{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Service": "lambda.amazonaws.com"
                },
                "Action": "secretsmanager:GetSecretValue",
                "Resource": "arn:aws:secretsmanager:'${AWS_REGION}':'${ACCOUNT_ID}':secret:postolio/production/*"
            },
            {
                "Effect": "Allow",
                "Principal": {
                    "Service": "ecs-tasks.amazonaws.com"
                },
                "Action": "secretsmanager:GetSecretValue",
                "Resource": "arn:aws:secretsmanager:'${AWS_REGION}':'${ACCOUNT_ID}':secret:postolio/production/*"
            }
        ]
    }'
    
    # Apply resource policy to each secret
    local secrets=$(aws secretsmanager list-secrets \
        --filters Key=name,Values=postolio/production/ \
        --query 'SecretList[].Name' \
        --output text)
    
    for secret in $secrets; do
        log_info "Granting access to: ${secret}"
        aws secretsmanager put-resource-policy \
            --secret-id "${secret}" \
            --resource-policy "${policy}" \
            --output json > /dev/null || true
    done
    
    log_success "Permissions granted"
}

# Function to validate secrets
validate_secrets() {
    log_info "Validating secrets configuration..."
    
    local required_secrets=(
        "postolio/production/database"
        "postolio/production/jwt"
        "postolio/production/scheduler"
    )
    
    local missing_secrets=()
    
    for secret in "${required_secrets[@]}"; do
        if ! aws secretsmanager describe-secret --secret-id "${secret}" &> /dev/null; then
            missing_secrets+=("${secret}")
        else
            log_success "✓ ${secret}"
        fi
    done
    
    if [ ${#missing_secrets[@]} -gt 0 ]; then
        log_error "Missing required secrets:"
        for secret in "${missing_secrets[@]}"; do
            echo "  - ${secret}"
        done
        return 1
    fi
    
    log_success "All required secrets configured"
}

# Function to export secrets for backup
export_secrets_list() {
    log_info "Exporting secrets list..."
    
    local export_file="production-secrets-$(date +%Y%m%d-%H%M%S).json"
    
    aws secretsmanager list-secrets \
        --filters Key=name,Values=postolio/production/ \
        --query 'SecretList[].{Name:Name,Description:Description,LastChangedDate:LastChangedDate}' \
        --output json > "${export_file}"
    
    log_success "Secrets list exported to: ${export_file}"
    log_warning "Note: This file contains secret names only, not values"
}

# Main execution
main() {
    log_info "=========================================="
    log_info "Production Secrets Configuration"
    log_info "Environment: ${ENVIRONMENT}"
    log_info "Region: ${AWS_REGION}"
    log_info "=========================================="
    
    # Check prerequisites
    check_prerequisites
    
    # Confirm production configuration
    echo -e "${YELLOW}⚠️  WARNING: Configuring PRODUCTION secrets${NC}"
    read -p "Continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        log_info "Configuration cancelled"
        exit 0
    fi
    
    # Configure all secret categories
    configure_database_secrets
    configure_auth_secrets
    configure_api_secrets
    configure_scheduler_secrets
    configure_monitoring_secrets
    configure_platform_secrets
    configure_encryption_keys
    
    # Grant permissions
    grant_permissions
    
    # Validate configuration
    validate_secrets
    
    # Export for documentation
    export_secrets_list
    
    log_success "=========================================="
    log_success "Production secrets configuration complete!"
    log_success "=========================================="
    
    echo ""
    log_info "Next steps:"
    echo "1. Update placeholder values in AWS Secrets Manager console"
    echo "2. Test secret access from Lambda functions"
    echo "3. Enable secret rotation where applicable"
    echo "4. Document secret values in secure password manager"
}

# Run main
main "$@"