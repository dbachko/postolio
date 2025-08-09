# CDK Bootstrap Troubleshooting Guide

This guide helps resolve CDK bootstrap issues, particularly the common "AccessDenied: CreateChangeSet" error.

## Quick Fix for AccessDenied Errors

If you see this error:
```
AccessDenied: User: arn:aws:iam::ACCOUNT:user/USERNAME is not authorized to perform: cloudformation:CreateChangeSet
```

### Solution Options (Choose One):

#### Option 1: Use the Bootstrap Script (Recommended)
```bash
./scripts/bootstrap-cdk.sh
```
This script will:
- Check your permissions automatically
- Provide specific guidance based on your situation
- Offer multiple bootstrap methods

#### Option 2: Request Administrator Help
Ask your AWS administrator to run:
```bash
cdk bootstrap aws://YOUR-ACCOUNT-ID/us-east-1
```

#### Option 3: Use AWS CloudShell
1. Open AWS CloudShell from the AWS Console
2. Install CDK: `npm install -g aws-cdk`
3. Run bootstrap: `cdk bootstrap aws://YOUR-ACCOUNT-ID/us-east-1`

#### Option 4: Manual Console Bootstrap
1. Go to CloudFormation in AWS Console
2. Create Stack → With new resources
3. Template source: Amazon S3 URL
4. Use: `https://s3.amazonaws.com/cdk-assets-us-east-1/toolkit-bootstrap-template.json`
5. Stack name: `CDKToolkit`
6. Use all default parameters

## Understanding the Error

CDK bootstrap creates the foundational infrastructure needed for CDK deployments:
- S3 bucket for storing deployment artifacts
- IAM roles for CDK operations
- ECR repository for container images
- SSM parameters for configuration

This requires several AWS permissions:
- `cloudformation:CreateStack`
- `cloudformation:CreateChangeSet`
- `s3:CreateBucket`
- `iam:CreateRole`
- And others...

## Validation Before Deployment

Always run validation before attempting deployment:
```bash
./scripts/validate-aws-setup.sh
```

This will check:
- AWS CLI installation
- Credential configuration
- Required permissions
- CDK bootstrap status
- Docker installation

## Enhanced Deployment Script

The `deploy-aws.sh` script has been enhanced to:
- Validate bootstrap permissions before attempting bootstrap
- Provide clear error messages and solutions
- Offer alternative approaches when permissions are insufficient
- Guide users to appropriate help resources

## Prevention

To avoid bootstrap issues in the future:
1. Ensure proper IAM permissions before CDK projects
2. Use the validation script before deployments
3. Consider using AWS CloudShell for broader permissions
4. Document your organization's CDK bootstrap procedures

## Related Commands

```bash
# Check if CDK is bootstrapped
aws cloudformation describe-stacks --stack-name CDKToolkit

# Force re-bootstrap (if needed)
cdk bootstrap --force aws://ACCOUNT-ID/REGION

# Validate deployment readiness
./scripts/validate-aws-setup.sh

# Deploy after successful bootstrap
./scripts/deploy-aws.sh dev
```