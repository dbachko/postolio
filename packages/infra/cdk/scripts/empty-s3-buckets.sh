#!/bin/bash

# Script to empty and help delete S3 buckets for Postolio-dev stack

echo "Emptying S3 buckets for Postolio-dev stack..."

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)

if [ -z "$ACCOUNT_ID" ]; then
    echo "Error: Unable to get AWS account ID. Please configure AWS credentials."
    exit 1
fi

echo "Using AWS Account: $ACCOUNT_ID"

# Bucket names follow the pattern: postolio-{type}-dev-{account-id}
BUCKETS=(
    "postolio-ai-images-dev-${ACCOUNT_ID}"
    "postolio-frontend-dev-${ACCOUNT_ID}"
    "postolio-alb-logs-dev-${ACCOUNT_ID}"
)

for BUCKET in "${BUCKETS[@]}"; do
    echo ""
    echo "Processing bucket: $BUCKET"
    
    # Check if bucket exists
    if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
        echo "  Found bucket, emptying..."
        
        # Delete all objects
        aws s3 rm "s3://$BUCKET" --recursive
        
        # Delete all object versions (if versioning was enabled)
        echo "  Removing versioned objects if any..."
        aws s3api delete-objects --bucket "$BUCKET" \
            --delete "$(aws s3api list-object-versions \
            --bucket "$BUCKET" \
            --output json \
            --query '{Objects: Versions[].{Key: Key, VersionId: VersionId}}')" 2>/dev/null || true
        
        # Delete delete markers
        echo "  Removing delete markers if any..."
        aws s3api delete-objects --bucket "$BUCKET" \
            --delete "$(aws s3api list-object-versions \
            --bucket "$BUCKET" \
            --output json \
            --query '{Objects: DeleteMarkers[].{Key: Key, VersionId: VersionId}}')" 2>/dev/null || true
        
        echo "  ✅ Bucket $BUCKET emptied successfully"
    else
        echo "  ⚠️  Bucket $BUCKET not found or already deleted"
    fi
done

echo ""
echo "All buckets processed. Now retrying stack deletion..."
echo ""

# Retry stack deletion
npx cdk destroy Postolio-dev --force