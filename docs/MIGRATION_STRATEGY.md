# Database Migration Strategy for ECS Fargate

## Overview
This document outlines the database migration strategies for running Prisma migrations in AWS ECS Fargate with PostgreSQL RDS.

## Migration Approaches

### Approach 1: Migrations at Container Startup (Current - Simple)
**File:** `scripts/start-with-migration.sh`
**Usage:** Default in Dockerfile

**Pros:**
- Simple setup
- Automatic migrations on every deployment
- No additional infrastructure needed

**Cons:**
- Longer container startup time
- Potential race conditions with multiple containers
- Health check complications

**Implementation:**
```dockerfile
CMD ["./start-with-migration.sh"]
```

**Features:**
- POSIX-compliant (works with Alpine Linux sh)
- Random delay to prevent race conditions
- Retry logic with exponential backoff
- Proper error handling

### Approach 2: Separate ECS Task (Recommended for Production)
**File:** `scripts/run-migrations-only.sh`
**Usage:** Run as separate ECS task before deployment

**Pros:**
- No race conditions
- Clean separation of concerns
- Faster container startup
- Better for blue-green deployments

**Cons:**
- Requires additional deployment step
- More complex CI/CD pipeline

**Implementation:**
```bash
# Run migration task
aws ecs run-task \
  --cluster your-cluster \
  --task-definition your-task-migration \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx]}"

# Wait for completion
aws ecs wait tasks-stopped --cluster your-cluster --tasks task-arn

# Then deploy new containers
aws ecs update-service --cluster your-cluster --service your-service --force-new-deployment
```

## Alpine Linux Compatibility

Both scripts are fully POSIX-compliant and work with Alpine Linux's sh shell (BusyBox ash):

1. **Random number generation:** Uses `/dev/urandom` with `od` instead of bash's `$RANDOM`
2. **Arithmetic operations:** Uses POSIX `$(( ))` syntax
3. **Conditionals:** Uses POSIX `[ ]` test syntax
4. **String operations:** Uses standard POSIX utilities

## Running Migrations Manually

### Local Development
```bash
npm run migrate:deploy
```

### Production (via ECS Task)
```bash
# One-time migration
npm run migrate:only

# Or using AWS CLI
aws ecs run-task --cluster Postolio-prod --task-definition postolio-migration
```

### Emergency Migration via ECS Exec
```bash
# Connect to running container
aws ecs execute-command \
  --cluster your-cluster \
  --task task-id \
  --container your-container \
  --interactive \
  --command "/bin/sh"

# Run migration manually
npx prisma migrate deploy
```

## Environment Variables

Required for all migration approaches:
- `DATABASE_URL`: PostgreSQL connection string

## Best Practices

1. **Always test migrations in staging first**
2. **Keep migration files in the Docker image** (COPY prisma ./prisma/)
3. **Use separate task for production migrations**
4. **Monitor migration logs in CloudWatch**
5. **Have rollback plan ready**
6. **Use RDS snapshots before major migrations**

## Troubleshooting

### Migration Fails in Container
1. Check DATABASE_URL is set correctly
2. Verify network connectivity to RDS
3. Check security groups allow connection
4. Review CloudWatch logs for specific errors

### Race Condition Issues
- Use separate ECS task approach
- Or ensure only one container runs migrations (using ECS service deployment configuration)

### Health Check Failures
- Increase start period in Docker HEALTHCHECK
- Current setting: 120 seconds start period

## Migration History

Migrations are tracked in the `_prisma_migrations` table in PostgreSQL. This ensures:
- Migrations only run once
- Consistent state across deployments
- Ability to track migration history