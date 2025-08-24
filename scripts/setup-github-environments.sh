#!/bin/bash

# Script to help set up GitHub Environment Variables for Postolio
# This script guides you through creating environments and setting variables

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🔧 GitHub Environment Variables Setup for Postolio${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ GitHub CLI (gh) is not installed${NC}"
    echo ""
    echo "Please install it first:"
    echo "  macOS: brew install gh"
    echo "  Linux: See https://github.com/cli/cli#installation"
    echo ""
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}🔐 Please authenticate with GitHub first${NC}"
    gh auth login
fi

# Get repository information
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
if [ -z "$REPO" ]; then
    echo -e "${RED}❌ Could not determine repository. Make sure you're in a git repository.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Repository: $REPO${NC}"
echo ""

# Function to create environment and set variables
setup_environment() {
    local ENV_NAME=$1
    local API_URL=$2
    local DOMAIN=$3
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Setting up $ENV_NAME environment${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Create environment (this requires repo admin access)
    echo "Creating environment: $ENV_NAME"
    gh api \
        --method PUT \
        -H "Accept: application/vnd.github+json" \
        "/repos/$REPO/environments/$ENV_NAME" \
        -f wait_timer=0 \
        -f reviewers='[]' \
        -f deployment_branch_policy='{"protected_branches":false,"custom_branch_policies":true}' \
        2>/dev/null || echo "Environment may already exist or you need admin access"
    
    # Function to set a variable
    set_variable() {
        local VAR_NAME=$1
        local VAR_VALUE=$2
        
        if [ -n "$VAR_VALUE" ]; then
            echo "  Setting $VAR_NAME"
            gh api \
                --method POST \
                -H "Accept: application/vnd.github+json" \
                "/repos/$REPO/environments/$ENV_NAME/variables" \
                -f name="$VAR_NAME" \
                -f value="$VAR_VALUE" \
                2>/dev/null || \
            gh api \
                --method PATCH \
                -H "Accept: application/vnd.github+json" \
                "/repos/$REPO/environments/$ENV_NAME/variables/$VAR_NAME" \
                -f value="$VAR_VALUE" \
                2>/dev/null || echo "    ⚠️  Could not set $VAR_NAME"
        fi
    }
    
    # Core configuration
    set_variable "ENVIRONMENT" "$ENV_NAME"
    set_variable "VITE_API_URL" "$API_URL"
    set_variable "DOMAIN_NAME" "$DOMAIN"
    set_variable "NODE_ENV" "production"
    set_variable "AWS_REGION" "us-east-1"
    
    # OAuth Configuration (prompt for values)
    echo ""
    echo -e "${YELLOW}OAuth Configuration for $ENV_NAME:${NC}"
    
    read -p "Enter Google OAuth Client ID (or press Enter to skip): " GOOGLE_CLIENT_ID
    set_variable "VITE_GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_ID"
    
    read -p "Enter Facebook App ID (or press Enter to skip): " FACEBOOK_APP_ID
    set_variable "VITE_FACEBOOK_APP_ID" "$FACEBOOK_APP_ID"
    
    # Feature flags
    echo ""
    echo -e "${YELLOW}Feature Flags for $ENV_NAME:${NC}"
    
    if [ "$ENV_NAME" = "prod" ]; then
        set_variable "VITE_FEATURE_VIDEO_SUPPORT" "false"
        set_variable "VITE_FEATURE_AI_SUGGESTIONS" "true"
        set_variable "LOG_LEVEL" "error"
        set_variable "ENABLE_MONITORING" "true"
    elif [ "$ENV_NAME" = "staging" ]; then
        set_variable "VITE_FEATURE_VIDEO_SUPPORT" "true"
        set_variable "VITE_FEATURE_AI_SUGGESTIONS" "true"
        set_variable "LOG_LEVEL" "info"
        set_variable "ENABLE_MONITORING" "true"
    else
        set_variable "VITE_FEATURE_VIDEO_SUPPORT" "true"
        set_variable "VITE_FEATURE_AI_SUGGESTIONS" "true"
        set_variable "LOG_LEVEL" "debug"
        set_variable "ENABLE_MONITORING" "false"
    fi
    
    # Analytics (optional)
    echo ""
    read -p "Enter Sentry DSN (or press Enter to skip): " SENTRY_DSN
    set_variable "VITE_SENTRY_DSN" "$SENTRY_DSN"
    
    read -p "Enter Google Analytics ID (or press Enter to skip): " GA_ID
    set_variable "VITE_GA_TRACKING_ID" "$GA_ID"
    
    echo -e "${GREEN}✅ $ENV_NAME environment configured${NC}"
    echo ""
}

# Main setup flow
echo -e "${CYAN}This script will help you set up GitHub Environment Variables for:${NC}"
echo "  • Development (dev)"
echo "  • Staging"
echo "  • Production (prod)"
echo ""
echo -e "${YELLOW}Note: You need repository admin access to create environments.${NC}"
echo -e "${YELLOW}Regular contributors can ask an admin to run this script.${NC}"
echo ""

read -p "Do you want to continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 0
fi

# Setup each environment
echo ""
setup_environment "dev" "https://postolio.example" "postolio.example"
setup_environment "staging" "https://postolio.example" "postolio.example"
setup_environment "prod" "https://postolio.example" "postolio.example"

# Display summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ GitHub Environments Setup Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Verify environments in GitHub:"
echo "   https://github.com/$REPO/settings/environments"
echo ""
echo "2. Add GitHub Secrets (sensitive values):"
echo "   https://github.com/$REPO/settings/secrets/actions"
echo "   - AWS_ACCESS_KEY_ID"
echo "   - AWS_SECRET_ACCESS_KEY"
echo ""
echo "3. Update AWS Secrets Manager (remove public values):"
echo "   aws secretsmanager update-secret --secret-id Postolio-dev/AppSecrets"
echo ""
echo "4. Deploy using the new workflow:"
echo "   git push origin main"
echo ""
echo -e "${CYAN}For more details, see: docs/ENVIRONMENT_VARIABLES.md${NC}"