# Fix CDK Bootstrap Deployment Error

## Problem
The CDK bootstrap stack is failing with `UPDATE_ROLLBACK_FAILED` because the GitHub Actions IAM user lacks the `iam:UpdateAssumeRolePolicy` permission.

## Error Details
```
Resource handler returned message: "User: arn:aws:iam::***:user/postolio-github-actions 
is not authorized to perform: iam:UpdateAssumeRolePolicy on resource: 
role cdk-hnb659fds-file-publishing-role-***-us-east-1"
```

## Solution Steps

### Step 1: Update IAM Policy
The GitHub Actions user needs the `iam:UpdateAssumeRolePolicy` permission.

1. **Go to AWS Console**
   - Navigate to IAM > Users > `postolio-github-actions`
   - Click on the attached policy

2. **Edit the Policy**
   Add `iam:UpdateAssumeRolePolicy` to the InfrastructureManagement statement:

   ```json
   {
       "Sid": "InfrastructureManagement",
       "Effect": "Allow",
       "Action": [
           "cloudformation:*",
           "iam:AttachRolePolicy",
           "iam:CreateRole",
           "iam:DeleteRole",
           "iam:DeleteRolePolicy",
           "iam:DetachRolePolicy",
           "iam:GetRole",
           "iam:GetRolePolicy",
           "iam:PutRolePolicy",
           "iam:TagRole",
           "iam:UntagRole",
           "iam:UpdateRole",
           "iam:UpdateAssumeRolePolicy",  // <-- ADD THIS LINE
           "sts:AssumeRole",
           "sts:GetCallerIdentity"
       ],
       "Resource": "*"
   }
   ```

3. **Save the Policy**
   Click "Review policy" and then "Save changes"

### Step 2: Fix the Stuck CDK Stack

#### Option A: Use the Fix Script (Recommended)
```bash
# Run the automated fix script
./scripts/fix-cdk-bootstrap.sh
```

#### Option B: Manual Fix via AWS Console
1. **Go to CloudFormation Console**
   - Find the `CDKToolkit` stack
   - Note the status (likely `UPDATE_ROLLBACK_FAILED`)

2. **Continue Rollback**
   - Select the stack
   - Actions > Continue Update Rollback
   - Select the failed resources to skip:
     - `FilePublishingRole`
     - `ImagePublishingRole`
     - `LookupRole`
   - Click "Continue update rollback"

3. **Delete the Stack (if rollback fails)**
   - Actions > Delete stack
   - Check "Retain resources" for the failed resources
   - Delete the stack

4. **Re-bootstrap CDK**
   ```bash
   AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
   AWS_REGION=us-east-1
   
   npx cdk bootstrap "aws://${AWS_ACCOUNT_ID}/${AWS_REGION}"
   ```

### Step 3: Retry Deployment

Once the IAM policy is updated and the CDK stack is fixed:

1. **Commit and Push Changes**
   ```bash
   git add .
   git commit -m "fix: add iam:UpdateAssumeRolePolicy permission for CDK bootstrap"
   git push origin main
   ```

2. **Monitor GitHub Actions**
   - Go to your repository's Actions tab
   - Watch the deployment workflow
   - It should now pass the CDK bootstrap step

## Prevention

To prevent this issue in the future:

1. **Use the Complete IAM Policy**
   The updated policy in `docs/AWS_DEPLOYMENT_STRATEGY.md` now includes all necessary permissions.

2. **Regular CDK Updates**
   Keep CDK updated to avoid bootstrap issues:
   ```bash
   npm update -g aws-cdk
   cd aws-infrastructure && npm update aws-cdk-lib
   ```

3. **Test Deployments Locally First**
   Before pushing to production:
   ```bash
   ./scripts/validate-aws-setup.sh
   ./scripts/deploy-aws.sh dev
   ```

## Additional Permissions That May Be Needed

If you encounter other permission errors, add these to the IAM policy:

```json
"iam:UpdateAssumeRolePolicy",    // For updating trust relationships
"iam:ListRolePolicies",          // For listing policies attached to roles
"iam:ListAttachedRolePolicies",  // For listing managed policies
"iam:GetPolicy",                 // For reading policy details
"iam:GetPolicyVersion"           // For reading policy versions
```

## Verification

After fixing, verify the deployment works:

```bash
# Check CDK bootstrap status
aws cloudformation describe-stacks --stack-name CDKToolkit \
  --query 'Stacks[0].StackStatus' --output text

# Should output: CREATE_COMPLETE or UPDATE_COMPLETE

# Check the deployment
cd aws-infrastructure
npm run cdk -- diff Postolio-dev
npm run cdk -- deploy Postolio-dev
```

## Support

If you continue to have issues:

1. Check the CloudFormation console for detailed error messages
2. Review the IAM policy for any missing permissions
3. Ensure your AWS CLI is configured correctly
4. Check that the AWS account ID in GitHub secrets matches your actual account

## Related Documentation

- [AWS Deployment Strategy](./AWS_DEPLOYMENT_STRATEGY.md) - Complete deployment guide with updated IAM policy
- [CDK Bootstrap Documentation](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) - AWS CDK bootstrap details