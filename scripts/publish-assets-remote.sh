#!/bin/bash

# Publish the Asset Library Module Federation remote to the Assets CDN
# - Builds @postolio/assets
# - Uploads dist/ to the Assets S3 bucket under /assets/
# - Invalidates the CloudFront cache for the /assets path

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ENVIRONMENT="dev"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--env)
      ENVIRONMENT="$2"; shift 2;;
    -h|--help)
      echo "Usage: $0 [-e dev|staging|prod]"; exit 0;;
    *) echo -e "${YELLOW}Ignoring unknown arg: $1${NC}"; shift;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_PKG="$REPO_ROOT/packages/apps/assets"
ASSETS_DIST="$ASSETS_PKG/dist"
ASSETS_PAYLOAD_DIR="$ASSETS_DIST/assets"
STACK_NAME="Postolio-AssetLibrary-$ENVIRONMENT"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo -e "${BLUE}Building @postolio/assets for MF remote...${NC}"
if ! command -v pnpm >/dev/null 2>&1; then
  echo -e "${RED}pnpm is required. Install: npm i -g pnpm${NC}"; exit 1
fi
pnpm --filter @postolio/assets build

if [[ ! -d "$ASSETS_PAYLOAD_DIR" ]]; then
  echo -e "${RED}Build output not found at $ASSETS_PAYLOAD_DIR${NC}"; exit 1
fi

get_ssm() {
  local name="$1"
  aws ssm get-parameter --name "$name" --region "$AWS_REGION" \
    --query 'Parameter.Value' --output text 2>/dev/null || true
}

get_cfn_output() {
  local key="$1"
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" --output text 2>/dev/null || true
}

echo -e "${BLUE}Resolving Assets bucket and CDN (via CloudFormation)...${NC}"
BUCKET_NAME="$(get_cfn_output "AssetsBucketNameOutput")"
CDN_DOMAIN="$(get_cfn_output "AssetsCdnDomainOutput")"
DIST_ID="$(get_cfn_output "AssetsCdnDistributionId")"
WEB_DIST_ID="$(get_ssm "/postolio/$ENVIRONMENT/web/distribution-id")"

if [[ -z "$BUCKET_NAME" || "$BUCKET_NAME" == "None" ]]; then
  echo -e "${RED}Could not resolve Assets bucket name from CloudFormation outputs. Ensure the stack $STACK_NAME is deployed.${NC}"
  exit 1
fi
if [[ -z "$CDN_DOMAIN" || "$CDN_DOMAIN" == "None" ]]; then
  # Fallback: derive CDN domain from stack resources
  CDN_DOMAIN="$(aws cloudformation list-stack-resources --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "StackResourceSummaries[?ResourceType=='AWS::CloudFront::Distribution'].PhysicalResourceId" \
    --output text 2>/dev/null || true)"
fi
if [[ -z "$DIST_ID" || "$DIST_ID" == "None" ]]; then
  # Fallback: derive distribution id from stack resources
  DIST_ID="$(aws cloudformation list-stack-resources --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "StackResourceSummaries[?ResourceType=='AWS::CloudFront::Distribution'].PhysicalResourceId" \
    --output text 2>/dev/null || true)"
fi

if [[ -z "$BUCKET_NAME" || "$BUCKET_NAME" == "None" ]]; then
  echo -e "${RED}Could not resolve Assets bucket name. Ensure the stack $STACK_NAME is deployed.${NC}"
  exit 1
fi

echo -e "${GREEN}Bucket: ${BUCKET_NAME}${NC}"
[[ -n "$CDN_DOMAIN" && "$CDN_DOMAIN" != "None" ]] && echo -e "${GREEN}CDN:    https://${CDN_DOMAIN}${NC}"
[[ -n "$DIST_ID" && "$DIST_ID" != "None" ]] && echo -e "${GREEN}DistID: ${DIST_ID}${NC}"

echo -e "${BLUE}Uploading remote to s3://${BUCKET_NAME}/assets/...${NC}"
aws s3 sync "$ASSETS_PAYLOAD_DIR" "s3://${BUCKET_NAME}/assets/" \
  --delete \
  --cache-control "public,max-age=300,stale-while-revalidate=86400" \
  --metadata-directive REPLACE

if [[ -n "$DIST_ID" && "$DIST_ID" != "None" ]]; then
  echo -e "${BLUE}Creating CloudFront invalidation for /assets/* ...${NC}"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/assets/*" >/dev/null
fi

if [[ -n "$WEB_DIST_ID" && "$WEB_DIST_ID" != "None" ]]; then
  echo -e "${BLUE}Creating Web CDN invalidation for /assets/* ...${NC}"
  aws cloudfront create-invalidation --distribution-id "$WEB_DIST_ID" --paths "/assets/*" >/dev/null
fi

REMOTE_URL=""
if [[ -n "$CDN_DOMAIN" && "$CDN_DOMAIN" != "None" ]]; then
  REMOTE_URL="https://${CDN_DOMAIN}/assets/remoteEntry.js"
  echo -e "${GREEN}Remote published: ${REMOTE_URL}${NC}"
  echo -e "Set VITE_ASSETS_REMOTE_URL=${REMOTE_URL} in Web env to consume it."
else
  echo -e "${YELLOW}CDN domain not resolved. Remote files are in s3://${BUCKET_NAME}/assets/ .${NC}"
fi
