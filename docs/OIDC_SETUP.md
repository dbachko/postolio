# OIDC Authentication Setup for GitHub Actions

This document provides instructions for setting up OIDC (OpenID Connect) authentication as a more secure alternative to using long-lived AWS access keys in GitHub Actions.

## Benefits of OIDC

- **No long-lived secrets**: No need to store AWS access keys in GitHub secrets
- **Better security**: Temporary credentials that automatically expire
- **Audit trail**: CloudTrail shows which GitHub repository and workflow accessed AWS
- **Fine-grained permissions**: Can restrict access by repository, branch, or specific workflow

## Setup Instructions

### 1. Create OIDC Identity Provider in AWS

1. Go to AWS Console > IAM > Identity providers
2. Click "Create identity provider"
3. Select "OpenID Connect" as provider type
4. Set the provider URL: `https://token.actions.githubusercontent.com`
5. Set the audience: `sts.amazonaws.com`
6. Click "Create"

### 2. Create IAM Role for GitHub Actions

1. Go to AWS Console > IAM > Roles
2. Click "Create role"
3. Select "Web identity" as trusted entity type
4. Select the GitHub OIDC provider you just created
5. Set audience to: `sts.amazonaws.com`
6. Configure the trust policy with your repository details:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:maintainer/postolio:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

7. Attach the enhanced secure permissions policy as defined in [AWS_DEPLOYMENT_STRATEGY.md](./AWS_DEPLOYMENT_STRATEGY.md#github-actions-cicd-setup)
8. Name the role: `postolio-github-actions-oidc`
9. Copy the role ARN

### 3. Update GitHub Actions Workflow

Create an alternative workflow file `.github/workflows/deploy-oidc.yml` or modify the existing one:

```yaml
name: Deploy to AWS (OIDC)

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: postolio
  NODE_VERSION: '20'

permissions:
  id-token: write   # This is required for requesting the JWT
  contents: read    # This is required for actions/checkout

jobs:
  validate:
    runs-on: ubuntu-latest
    name: Validate deployment prerequisites
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Check OIDC role configuration
        run: |
          echo "🔍 Using OIDC authentication for AWS access"
          if [ -z "${{ secrets.AWS_ROLE_ARN }}" ]; then
            echo "❌ AWS_ROLE_ARN secret is not set"
            echo "Please configure this secret in your GitHub repository settings:"
            echo "Go to Settings > Secrets and variables > Actions > New repository secret"
            echo "Value should be: arn:aws:iam::YOUR_ACCOUNT_ID:role/postolio-github-actions-oidc"
            exit 1
          fi
          echo "✅ AWS_ROLE_ARN is configured"
          echo "✅ OIDC authentication ready"

  # ... rest of your jobs with OIDC authentication
```

### 4. Configure GitHub Secrets (OIDC Version)

Instead of the three secrets from the traditional method, you only need:

| Secret Name | Value |
|-------------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::YOUR_ACCOUNT_ID:role/postolio-github-actions-oidc` |

### 5. Update AWS Credentials Configuration

In each job that needs AWS access, replace:

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: ${{ env.AWS_REGION }}
```

With:

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
    role-session-name: GitHubActions
    aws-region: ${{ env.AWS_REGION }}
```

## Security Considerations

### Repository-Specific Access

To limit access to only your repository, use this condition in the trust policy:

```json
"token.actions.githubusercontent.com:sub": "repo:maintainer/postolio:ref:refs/heads/main"
```

### Branch-Specific Access

To limit access to only main branch deployments:

```json
"token.actions.githubusercontent.com:sub": "repo:maintainer/postolio:ref:refs/heads/main"
```

### Workflow-Specific Access

To limit access to specific workflows, add:

```json
"token.actions.githubusercontent.com:job_workflow_ref": "maintainer/postolio/.github/workflows/deploy.yml@refs/heads/main"
```

## Migration from Access Keys

1. Set up OIDC as described above
2. Test the new workflow to ensure it works
3. Remove the old secrets:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_ACCOUNT_ID`
4. Consider deactivating or deleting the IAM user that was used for access keys

## Troubleshooting

**"Web identity token file does not exist" Error**:
- Ensure `permissions.id-token: write` is set in the workflow
- Verify the OIDC provider is configured correctly in AWS

**"Access Denied" when assuming role**:
- Check the trust policy conditions match your repository and branch
- Verify the role has the required permissions attached
- Ensure the audience is set to `sts.amazonaws.com`

**"No assume role policy found" Error**:
- The IAM role's trust policy must allow `sts:AssumeRoleWithWebIdentity`
- Verify the federated identity in the trust policy matches your OIDC provider ARN

## References

- [AWS Documentation: Creating OIDC identity providers](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)
- [GitHub Actions: Configuring OpenID Connect in AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AWS Actions Configure Credentials](https://github.com/aws-actions/configure-aws-credentials)