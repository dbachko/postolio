#!/bin/bash

set -euo pipefail

ENVIRONMENT="dev"
DESTROY_STACKS="false"

for arg in "$@"; do
  case "$arg" in
    dev|staging|prod)
      ENVIRONMENT="$arg"
      ;;
    --env=*)
      ENVIRONMENT="${arg#--env=}"
      ;;
    --destroy)
      DESTROY_STACKS="true"
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [dev|staging|prod] [--destroy]"
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CDK_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

AWS_REGION_RESOLVED="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
if [[ -z "$AWS_REGION_RESOLVED" ]]; then
  AWS_REGION_RESOLVED="$(aws configure get region 2>/dev/null || true)"
fi
if [[ -z "$AWS_REGION_RESOLVED" ]]; then
  AWS_REGION_RESOLVED="us-east-1"
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
if [[ -z "$ACCOUNT_ID" ]]; then
  echo "Unable to resolve AWS account. Configure AWS credentials first."
  exit 1
fi

echo "Environment: $ENVIRONMENT"
echo "Region: $AWS_REGION_RESOLVED"
echo "Account: $ACCOUNT_ID"

STACKS=($(
  aws cloudformation list-stacks \
    --region "$AWS_REGION_RESOLVED" \
    --output json \
    --query "StackSummaries[?starts_with(StackName, 'Postolio-') && ends_with(StackName, '-${ENVIRONMENT}') && StackStatus!='DELETE_COMPLETE'].StackName" \
    | jq -r '.[]'
))

if [[ ${#STACKS[@]} -eq 0 ]]; then
  echo "No active Postolio stacks found for environment '$ENVIRONMENT'."
  exit 0
fi

echo ""
echo "Discovered stacks:"
printf ' - %s\n' "${STACKS[@]}"

all_buckets=""
for stack in "${STACKS[@]}"; do
  stack_buckets="$(
    aws cloudformation list-stack-resources \
      --region "$AWS_REGION_RESOLVED" \
      --stack-name "$stack" \
      --query "StackResourceSummaries[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId" \
      --output json \
      | jq -r '.[]'
  )"
  if [[ -n "$stack_buckets" ]]; then
    all_buckets+="${stack_buckets}"$'\n'
  fi
done

BUCKETS=($(echo "$all_buckets" | sed '/^$/d' | sort -u))

if [[ ${#BUCKETS[@]} -eq 0 ]]; then
  echo "No S3 buckets discovered in active stacks."
else
  echo ""
  echo "Discovered S3 buckets:"
  printf ' - %s\n' "${BUCKETS[@]}"
fi

empty_bucket() {
  local bucket="$1"

  aws s3 rm "s3://$bucket" --recursive --only-show-errors >/dev/null 2>&1 || true

  while true; do
    local payload count
    payload="$(
      aws s3api list-object-versions \
        --region "$AWS_REGION_RESOLVED" \
        --bucket "$bucket" \
        --max-items 1000 \
        --output json \
        | jq -c '{Objects: ([.Versions[]?, .DeleteMarkers[]?] | map({Key: .Key, VersionId: .VersionId})), Quiet: true}'
    )"
    count="$(echo "$payload" | jq '.Objects | length')"
    if [[ "$count" -eq 0 ]]; then
      break
    fi
    aws s3api delete-objects \
      --region "$AWS_REGION_RESOLVED" \
      --bucket "$bucket" \
      --delete "$payload" >/dev/null 2>&1 || true
  done

  while true; do
    local uploads upload_count
    uploads="$(
      aws s3api list-multipart-uploads \
        --region "$AWS_REGION_RESOLVED" \
        --bucket "$bucket" \
        --output json 2>/dev/null || echo '{}'
    )"
    upload_count="$(echo "$uploads" | jq '[.Uploads[]?] | length')"
    if [[ "$upload_count" -eq 0 ]]; then
      break
    fi

    echo "$uploads" | jq -r '.Uploads[] | [.Key, .UploadId] | @tsv' | while IFS=$'\t' read -r key upload_id; do
      [[ -z "$key" ]] && continue
      aws s3api abort-multipart-upload \
        --region "$AWS_REGION_RESOLVED" \
        --bucket "$bucket" \
        --key "$key" \
        --upload-id "$upload_id" >/dev/null 2>&1 || true
    done
  done
}

FAILED_BUCKETS=()

for bucket in "${BUCKETS[@]}"; do
  echo ""
  echo "Processing: $bucket"
  empty_bucket "$bucket"
  if aws s3api delete-bucket --region "$AWS_REGION_RESOLVED" --bucket "$bucket" >/dev/null 2>&1; then
    echo "Deleted: $bucket"
  else
    echo "Failed to delete: $bucket"
    FAILED_BUCKETS+=("$bucket")
  fi
done

echo ""
echo "Post-cleanup bucket check:"
aws s3api list-buckets --query "Buckets[?contains(Name, 'postolio')].[Name,CreationDate]" --output table

if [[ ${#FAILED_BUCKETS[@]} -gt 0 ]]; then
  echo ""
  echo "Buckets that still require manual cleanup:"
  printf ' - %s\n' "${FAILED_BUCKETS[@]}"
  exit 1
fi

if [[ "$DESTROY_STACKS" == "true" ]]; then
  echo ""
  echo "Destroying discovered stacks via CDK:"
  printf ' - %s\n' "${STACKS[@]}"
  (
    cd "$CDK_ROOT"
    npx cdk destroy --context environment="$ENVIRONMENT" --force "${STACKS[@]}"
  )
else
  echo ""
  echo "Bucket cleanup complete."
  echo "To destroy stacks too, run with --destroy."
fi
