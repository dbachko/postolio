#!/usr/bin/env bash
set -euo pipefail

# Destroy all Postolio stacks for a given environment (dev|staging|prod)
# - Empties S3 buckets (including all versions and delete markers)
# - Deletes stacks in dependency-safe order
# - Cleans up orphan Lambda ENIs that can block SG/VPC deletion
#
# Usage:
#   ./scripts/destroy-all.sh dev

ENVIRONMENT="${1:-dev}"
REGION="${AWS_REGION:-us-east-1}"

echo "Environment: $ENVIRONMENT"
echo "Region:       $REGION"

empty_bucket() {
  local bucket="$1"
  echo "-- Emptying bucket: $bucket"
  # Delete current objects (fast path)
  aws s3 rm "s3://$bucket" --recursive --region "$REGION" >/dev/null 2>&1 || true
  # Delete versioned objects and delete markers
  local keyMarker="" versionIdMarker=""
  while true; do
    if [[ -n "$keyMarker" && -n "$versionIdMarker" ]]; then
      resp=$(aws s3api list-object-versions --bucket "$bucket" --key-marker "$keyMarker" --version-id-marker "$versionIdMarker" --region "$REGION" 2>/dev/null || true)
    else
      resp=$(aws s3api list-object-versions --bucket "$bucket" --region "$REGION" 2>/dev/null || true)
    fi
    vers=$(jq -r '.Versions // []' <<< "$resp")
    dms=$(jq -r '.DeleteMarkers // []' <<< "$resp")
    nv=$(jq -r 'length' <<< "$vers")
    nd=$(jq -r 'length' <<< "$dms")
    if [[ "$nv" -eq 0 && "$nd" -eq 0 ]]; then break; fi
    del=$(jq -n --argjson ver "$vers" --argjson dm "$dms" '{Objects: ($ver + $dm | map({Key:.Key,VersionId:.VersionId})), Quiet:true}')
    printf "%s" "$del" > /tmp/del.json
    aws s3api delete-objects --bucket "$bucket" --delete file:///tmp/del.json --region "$REGION" >/dev/null 2>&1 || true
    keyMarker=$(jq -r '.NextKeyMarker // empty' <<< "$resp")
    versionIdMarker=$(jq -r '.NextVersionIdMarker // empty' <<< "$resp")
    [[ -z "$keyMarker" ]] && break
    sleep 1
  done
}

empty_stack_buckets() {
  local stack="$1"
  echo "== Checking S3 buckets for $stack"
  buckets=$(aws cloudformation list-stack-resources --stack-name "$stack" --region "$REGION" \
            --query 'StackResourceSummaries[?ResourceType==`AWS::S3::Bucket`].PhysicalResourceId' --output text 2>/dev/null || true)
  [[ -z "${buckets// }" ]] && { echo "(no buckets)"; return; }
  for b in $buckets; do empty_bucket "$b"; done
}

delete_stack() {
  local stack="$1"
  echo "== Deleting stack: $stack"
  aws cloudformation delete-stack --stack-name "$stack" --region "$REGION" || true
  echo ".. waiting for deletion to complete"
  aws cloudformation wait stack-delete-complete --stack-name "$stack" --region "$REGION" || true
}

cleanup_lambda_enis_for_sg() {
  local sg_id="$1"
  [[ -z "$sg_id" ]] && return 0
  local enis
  enis=$(aws ec2 describe-network-interfaces --filters Name=group-id,Values=$sg_id --region "$REGION" \
          --query 'NetworkInterfaces[].NetworkInterfaceId' --output text 2>/dev/null || true)
  [[ -z "${enis// }" ]] && return 0
  for eni in $enis; do
    echo "Deleting ENI: $eni (linked to $sg_id)"
    aws ec2 delete-network-interface --network-interface-id "$eni" --region "$REGION" || true
    sleep 1
  done
}

# Deletion order (reverse of creation): web -> api -> asset-library -> brand-analysis -> publishing -> scheduling -> auth -> foundation
STACKS=(
  "Postolio-Web-$ENVIRONMENT"
  "Postolio-API-$ENVIRONMENT"
  "Postolio-AssetLibrary-$ENVIRONMENT"
  "Postolio-BrandAnalysis-$ENVIRONMENT"
  "Postolio-Publishing-$ENVIRONMENT"
  "Postolio-Scheduling-$ENVIRONMENT"
  "Postolio-Auth-$ENVIRONMENT"
  "Postolio-Foundation-$ENVIRONMENT"
)

echo "Listing candidate stacks:"
aws cloudformation describe-stacks --region "$REGION" \
  | jq -r '.Stacks[] | select(.StackName|test("^Postolio-.*-'"$ENVIRONMENT"'$")) | [.StackName,.StackStatus] | @tsv' \
  | sed -n '1,200p'

for s in "${STACKS[@]}"; do
  # Skip if stack does not exist
  if ! aws cloudformation describe-stacks --stack-name "$s" --region "$REGION" >/dev/null 2>&1; then
    echo "(stack not found) $s"
    continue
  fi
  empty_stack_buckets "$s"
  delete_stack "$s"
done

# Final pass: remove orphan Lambda ENIs blocking Foundation (common)
if aws cloudformation describe-stacks --stack-name "Postolio-Foundation-$ENVIRONMENT" --region "$REGION" >/dev/null 2>&1; then
  sg_id=$(aws cloudformation list-stack-resources --stack-name "Postolio-Foundation-$ENVIRONMENT" --region "$REGION" \
           --query 'StackResourceSummaries[?LogicalResourceId==`LambdaSecurityGroup0BD9FC99`].PhysicalResourceId' --output text 2>/dev/null || echo "")
  cleanup_lambda_enis_for_sg "$sg_id"
  delete_stack "Postolio-Foundation-$ENVIRONMENT"
fi

echo "Done. Remaining stacks:"
aws cloudformation describe-stacks --region "$REGION" \
  | jq -r '.Stacks[] | select(.StackName|test("^Postolio-.*-'"$ENVIRONMENT"'$")) | [.StackName,.StackStatus] | @tsv' \
  | sed -n '1,200p'

