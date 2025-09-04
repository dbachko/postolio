#!/bin/bash

# Simple Production Secrets Configuration Script
# Manages the 3 key API secrets for Postolio

set -e  # Exit on error

# Configuration
export AWS_REGION="${AWS_REGION:-us-east-1}"
export ENVIRONMENT="production"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Secret names
OPENAI_SECRET="postolio/production/openai"
GOOGLE_SECRET="postolio/production/google"
FACEBOOK_SECRET="postolio/production/facebook"

# Function to check prerequisites
check_prerequisites() {
    echo -e "${BLUE}[INFO]${NC} Checking prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}[ERROR]${NC} AWS CLI is not installed"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}[ERROR]${NC} AWS credentials are not configured"
        exit 1
    fi
    
    # Check jq for JSON processing
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}[ERROR]${NC} jq is not installed. Install with: brew install jq"
        exit 1
    fi
    
    echo -e "${GREEN}[SUCCESS]${NC} Prerequisites met"
}

# Function to list all secrets
list_secrets() {
    echo -e "\n${BLUE}=== Current Secrets ===${NC}"
    
    # OpenAI
    echo -e "\n${YELLOW}OpenAI API:${NC}"
    if aws secretsmanager describe-secret --secret-id "${OPENAI_SECRET}" &> /dev/null; then
        # Fetch the secret value
        secret_json=$(aws secretsmanager get-secret-value \
            --secret-id "${OPENAI_SECRET}" \
            --query SecretString \
            --output text 2>/dev/null)
        
        # Extract the API key from JSON
        if [ -n "$secret_json" ]; then
            value=$(echo "$secret_json" | jq -r '.apiKey' 2>/dev/null)
        else
            value=""
        fi
        
        # Check if value exists and is not null/empty
        if [ -n "$value" ] && [ "$value" != "null" ]; then
            echo "  Status: ✓ Configured"
            echo "  Value: ${value:0:10}..." # Show first 10 chars only
        else
            echo "  Status: ✗ Not configured"
        fi
    else
        echo "  Status: ✗ Secret doesn't exist"
    fi
    
    # Google
    echo -e "\n${YELLOW}Google Client Secret:${NC}"
    if aws secretsmanager describe-secret --secret-id "${GOOGLE_SECRET}" &> /dev/null; then
        # Fetch the secret value
        secret_json=$(aws secretsmanager get-secret-value \
            --secret-id "${GOOGLE_SECRET}" \
            --query SecretString \
            --output text 2>/dev/null)
        
        # Extract the client secret from JSON
        if [ -n "$secret_json" ]; then
            value=$(echo "$secret_json" | jq -r '.clientSecret' 2>/dev/null)
        else
            value=""
        fi
        
        # Check if value exists and is not null/empty
        if [ -n "$value" ] && [ "$value" != "null" ]; then
            echo "  Status: ✓ Configured"
            echo "  Value: ${value:0:10}..." # Show first 10 chars only
        else
            echo "  Status: ✗ Not configured"
        fi
    else
        echo "  Status: ✗ Secret doesn't exist"
    fi
    
    # Facebook
    echo -e "\n${YELLOW}Facebook App Secret:${NC}"
    if aws secretsmanager describe-secret --secret-id "${FACEBOOK_SECRET}" &> /dev/null; then
        # Fetch the secret value
        secret_json=$(aws secretsmanager get-secret-value \
            --secret-id "${FACEBOOK_SECRET}" \
            --query SecretString \
            --output text 2>/dev/null)
        
        # Extract the app secret from JSON
        if [ -n "$secret_json" ]; then
            value=$(echo "$secret_json" | jq -r '.appSecret' 2>/dev/null)
        else
            value=""
        fi
        
        # Check if value exists and is not null/empty
        if [ -n "$value" ] && [ "$value" != "null" ]; then
            echo "  Status: ✓ Configured"
            echo "  Value: ${value:0:10}..." # Show first 10 chars only
        else
            echo "  Status: ✗ Not configured"
        fi
    else
        echo "  Status: ✗ Secret doesn't exist"
    fi
    
    echo ""
}

# Function to update OpenAI API key
update_openai() {
    echo -e "\n${YELLOW}Update OpenAI API Key${NC}"
    echo -n "Enter OpenAI API Key (starts with sk-): "
    read -s openai_key
    echo  # New line after hidden input
    
    if [ -z "$openai_key" ]; then
        echo -e "${RED}[ERROR]${NC} API key cannot be empty"
        return 1
    fi
    
    # Create JSON with the API key
    local secret_json='{
        "apiKey": "'${openai_key}'",
        "model": "gpt-4-turbo-preview",
        "imageModel": "dall-e-3"
    }'
    
    # Check if secret exists
    if aws secretsmanager describe-secret --secret-id "${OPENAI_SECRET}" &> /dev/null; then
        # Update existing secret
        aws secretsmanager update-secret \
            --secret-id "${OPENAI_SECRET}" \
            --secret-string "${secret_json}" \
            --output json > /dev/null
        echo -e "${GREEN}[SUCCESS]${NC} OpenAI API key updated"
    else
        # Create new secret
        aws secretsmanager create-secret \
            --name "${OPENAI_SECRET}" \
            --description "OpenAI API configuration" \
            --secret-string "${secret_json}" \
            --tags "Key=Environment,Value=${ENVIRONMENT}" "Key=Application,Value=Postolio" \
            --output json > /dev/null
        echo -e "${GREEN}[SUCCESS]${NC} OpenAI API key created"
    fi
}

# Function to update Google Client Secret
update_google() {
    echo -e "\n${YELLOW}Update Google Client Secret${NC}"
    echo -n "Enter Google Client Secret: "
    read -s google_secret
    echo  # New line after hidden input
    
    if [ -z "$google_secret" ]; then
        echo -e "${RED}[ERROR]${NC} Client secret cannot be empty"
        return 1
    fi
    
    # Create JSON with the client secret
    local secret_json='{
        "clientId": "",
        "clientSecret": "'${google_secret}'",
        "redirectUri": "https://postolio.example/auth/google/callback"
    }'
    
    # Check if secret exists
    if aws secretsmanager describe-secret --secret-id "${GOOGLE_SECRET}" &> /dev/null; then
        # Update existing secret
        aws secretsmanager update-secret \
            --secret-id "${GOOGLE_SECRET}" \
            --secret-string "${secret_json}" \
            --output json > /dev/null
        echo -e "${GREEN}[SUCCESS]${NC} Google client secret updated"
    else
        # Create new secret
        aws secretsmanager create-secret \
            --name "${GOOGLE_SECRET}" \
            --description "Google OAuth configuration" \
            --secret-string "${secret_json}" \
            --tags "Key=Environment,Value=${ENVIRONMENT}" "Key=Application,Value=Postolio" \
            --output json > /dev/null
        echo -e "${GREEN}[SUCCESS]${NC} Google client secret created"
    fi
}

# Function to update Facebook App Secret
update_facebook() {
    echo -e "\n${YELLOW}Update Facebook App Secret${NC}"
    echo -n "Enter Facebook App Secret: "
    read -s fb_secret
    echo  # New line after hidden input
    
    if [ -z "$fb_secret" ]; then
        echo -e "${RED}[ERROR]${NC} App secret cannot be empty"
        return 1
    fi
    
    # Create JSON with the app secret
    local secret_json='{
        "appId": "",
        "appSecret": "'${fb_secret}'",
        "redirectUri": "https://postolio.example/auth/instagram/callback"
    }'
    
    # Check if secret exists
    if aws secretsmanager describe-secret --secret-id "${FACEBOOK_SECRET}" &> /dev/null; then
        # Update existing secret
        aws secretsmanager update-secret \
            --secret-id "${FACEBOOK_SECRET}" \
            --secret-string "${secret_json}" \
            --output json > /dev/null
        echo -e "${GREEN}[SUCCESS]${NC} Facebook app secret updated"
    else
        # Create new secret
        aws secretsmanager create-secret \
            --name "${FACEBOOK_SECRET}" \
            --description "Facebook/Instagram API configuration" \
            --secret-string "${secret_json}" \
            --tags "Key=Environment,Value=${ENVIRONMENT}" "Key=Application,Value=Postolio" \
            --output json > /dev/null
        echo -e "${GREEN}[SUCCESS]${NC} Facebook app secret created"
    fi
}

# Function to show menu
show_menu() {
    echo -e "\n${BLUE}=== Production Secrets Manager ===${NC}"
    echo "1) List all secrets"
    echo "2) Update OpenAI API Key"
    echo "3) Update Google Client Secret"
    echo "4) Update Facebook App Secret"
    echo "5) Update all secrets"
    echo "q) Quit"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1)
            list_secrets
            ;;
        2)
            update_openai
            ;;
        3)
            update_google
            ;;
        4)
            update_facebook
            ;;
        5)
            update_openai
            update_google
            update_facebook
            echo -e "\n${GREEN}[SUCCESS]${NC} All secrets updated"
            ;;
        q|Q)
            echo "Exiting..."
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            ;;
    esac
}

# Main execution
main() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}   Production Secrets Configuration    ${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo -e "Environment: ${YELLOW}${ENVIRONMENT}${NC}"
    echo -e "Region: ${YELLOW}${AWS_REGION}${NC}"
    
    # Check prerequisites
    check_prerequisites
    
    # Interactive menu loop
    while true; do
        show_menu
    done
}

# Run if executed directly (not sourced)
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi