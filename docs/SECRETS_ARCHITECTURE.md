# Secrets Management Architecture

## Overview

Postolio uses a **hybrid secrets management approach** that separates user-provided secrets from infrastructure secrets:

- **User Secrets**: Stored in GitHub Secrets, passed as environment variables
- **Infrastructure Secrets**: Generated and managed by AWS CDK in AWS Secrets Manager

This separation prevents CDK deployments from overwriting user-provided secrets with placeholders.

## Secret Categories

### 1. User-Provided Secrets (Environment Variables)
These secrets are provided by users and stored in GitHub Secrets for CI/CD, or as environment variables for local deployment:

| Secret | Environment Variable | Description | Required |
|--------|---------------------|-------------|----------|
| OpenAI API Key | `OPENAI_API_KEY` | For AI content generation | Yes |
| Google Client Secret | `GOOGLE_CLIENT_SECRET` | OAuth authentication | Optional |
| Facebook App Secret | `FACEBOOK_APP_SECRET` | OAuth authentication | Optional |

### 2. Infrastructure Secrets (AWS Secrets Manager)
These secrets are automatically generated and managed by CDK:

| Secret | Source | Description |
|--------|--------|-------------|
| `JWT_SECRET` | Generated from Stack ID | JWT token signing |
| `REDIS_URL` | ElastiCache endpoint | Redis connection string |
| `PUBLISHER_API_KEY` | Generated UUID | Internal Lambda auth |
| `DB_USERNAME` | RDS configuration | Database username |
| `DB_PASSWORD` | RDS auto-generated | Database password |

## Implementation Details

### CDK Stack Configuration

The CDK stack (`aws-infrastructure/lib/stacks/postolio-stack.ts`) now:

1. **Creates only infrastructure secrets** in AWS Secrets Manager:
```typescript
const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
  secretObjectValue: {
    jwtSecret: cdk.SecretValue.unsafePlainText(generatedValue),
    redisUrl: cdk.SecretValue.unsafePlainText(redisEndpoint),
    publisherApiKey: cdk.SecretValue.unsafePlainText(generatedUuid),
  }
})
```

2. **Receives user secrets as context/environment**:
```typescript
environment: {
  OPENAI_API_KEY: this.node.tryGetContext('openaiApiKey') || process.env.OPENAI_API_KEY || '',
  GOOGLE_CLIENT_SECRET: this.node.tryGetContext('googleClientSecret') || process.env.GOOGLE_CLIENT_SECRET || '',
  FACEBOOK_APP_SECRET: this.node.tryGetContext('facebookAppSecret') || process.env.FACEBOOK_APP_SECRET || '',
}
```

3. **ECS Task Definition** uses both sources:
```typescript
secrets: {
  // From AWS Secrets Manager (infrastructure)
  JWT_SECRET: ecs.Secret.fromSecretsManager(appSecrets, 'jwtSecret'),
  REDIS_URL: ecs.Secret.fromSecretsManager(appSecrets, 'redisUrl'),
  DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
},
environment: {
  // From GitHub Secrets/environment variables (user-provided)
  OPENAI_API_KEY: context.openaiApiKey,
  GOOGLE_CLIENT_SECRET: context.googleClientSecret,
  FACEBOOK_APP_SECRET: context.facebookAppSecret,
}
```

## Deployment Workflows

### Local Deployment

1. **Set environment variables**:
```bash
export OPENAI_API_KEY="sk-..."
export GOOGLE_CLIENT_SECRET="..."
export FACEBOOK_APP_SECRET="..."
```

2. **Run deployment**:
```bash
./scripts/deploy-aws.sh dev
```

The script automatically passes these as CDK context parameters.

### CI/CD Deployment (GitHub Actions)

1. **Configure GitHub Secrets**:
   - Go to Settings → Secrets and variables → Actions
   - Add repository secrets:
     - `OPENAI_API_KEY`
     - `GOOGLE_CLIENT_SECRET`
     - `FACEBOOK_APP_SECRET`

2. **GitHub Actions workflow** automatically:
   - Retrieves secrets from GitHub Secrets
   - Passes them as environment variables to CDK
   - Deploys infrastructure with user secrets

### Production Best Practices

1. **Never commit secrets** to the repository
2. **Use different secrets** for each environment (dev/staging/prod)
3. **Rotate secrets regularly** through GitHub UI
4. **Monitor secret usage** in CloudWatch logs

## Benefits of This Architecture

### 1. **No Secret Overwrites**
CDK deployments no longer overwrite user secrets with placeholders because user secrets aren't stored in AWS Secrets Manager.

### 2. **Clear Separation of Concerns**
- Infrastructure team manages AWS resources and generated secrets
- Development team manages API keys and OAuth secrets
- No conflicts between teams

### 3. **Simplified Secret Rotation**
- User secrets: Update in GitHub Secrets, redeploy
- Infrastructure secrets: Automatically regenerated on stack updates

### 4. **Better Security**
- User secrets never touch AWS Secrets Manager
- Infrastructure secrets are isolated from user configuration
- Each secret has appropriate access controls

### 5. **Easier Debugging**
- Clear distinction between secret types
- Easy to identify missing secrets
- Deployment script provides helpful feedback

## Migration from Old Architecture

If you have existing secrets in AWS Secrets Manager:

1. **Note down current values**:
```bash
aws secretsmanager get-secret-value \
  --secret-id "Postolio-dev/AppSecrets" \
  --query SecretString \
  --output text | jq '.'
```

2. **Set as environment variables**:
```bash
export OPENAI_API_KEY="<your-key>"
export GOOGLE_CLIENT_SECRET="<your-secret>"
export FACEBOOK_APP_SECRET="<your-secret>"
```

3. **Redeploy**:
```bash
./scripts/deploy-aws.sh dev
```

4. **For GitHub Actions**, add to repository secrets

## Troubleshooting

### Issue: "OPENAI_API_KEY not set"
**Solution**: Export the environment variable before deployment:
```bash
export OPENAI_API_KEY="sk-..."
```

### Issue: Secrets not available in ECS tasks
**Solution**: Check CloudWatch logs and ensure:
1. Environment variables were set during deployment
2. ECS service was restarted after deployment
3. Task definition includes the environment variables

### Issue: OAuth not working
**Solution**: Verify both public IDs and secrets are set:
- Public IDs: `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID` (in vars)
- Secrets: `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_SECRET` (in secrets)

## Security Considerations

1. **Environment Variable Security**:
   - Environment variables in ECS are encrypted at rest
   - Only accessible to the running container
   - Not visible in AWS Console UI

2. **GitHub Secrets Security**:
   - Encrypted at rest
   - Only available to workflows
   - Masked in logs

3. **AWS Secrets Manager**:
   - Used only for infrastructure secrets
   - Automatic encryption
   - IAM-based access control

## Future Improvements

1. Consider using AWS Systems Manager Parameter Store for user secrets
2. Implement secret rotation automation
3. Add secret validation before deployment
4. Create secret backup/recovery procedures