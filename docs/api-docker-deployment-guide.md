# API Docker Deployment Guide

This runbook captures the exact steps used to rebuild and deploy the Fastify API container to AWS ECR/ECS. Follow this whenever a refreshed image needs to be produced manually.

## Prerequisites

- AWS CLI authenticated against the `000000000000` account (e.g. `aws sts get-caller-identity` should succeed).
- Docker CLI with BuildKit/Buildx available.
- Logged into the target ECR registry.

## Step-by-step checklist

1. **Set working directory**

   ```bash
   cd /home/developer/project
   ```

2. **Build API image for `linux/amd64`**

   ```bash
   docker buildx build \
     --platform linux/amd64 \
     -f packages/apps/api/Dockerfile \
     -t 000000000000.dkr.ecr.us-east-1.amazonaws.com/postolio:api-dev-<tag> \
     --push .
   ```

   - Always pin the full tag provided by release engineering.
   - Buildx ensures the manifest contains the `linux/amd64` platform required by Fargate.

3. **(Optional) Pull locally for verification**

   ```bash
   docker pull 000000000000.dkr.ecr.us-east-1.amazonaws.com/postolio:api-dev-<tag>
   ```

4. **Force new ECS deployment**

   ```bash
   aws ecs update-service \
     --cluster postolio-dev-api-cluster \
     --service postolio-dev-api-service \
     --force-new-deployment
   ```

5. **Watch deployment progress**

   ```bash
   aws ecs describe-services \
     --cluster postolio-dev-api-cluster \
     --services postolio-dev-api-service \
     | jq '.services[0].deployments'
   ```

   - Ensure the new deployment reaches `PRIMARY` with `runningCount = desiredCount` and no failed tasks.

6. **Confirm tasks are on the new image**

   ```bash
   aws ecs list-tasks --cluster postolio-dev-api-cluster --service-name postolio-dev-api-service
   aws ecs describe-tasks --cluster postolio-dev-api-cluster --tasks <taskArns>
   ```

   - Check `containers[].image` matches the pushed tag.

7. **Monitor events for pull failures**

   ```bash
   aws ecs describe-services \
     --cluster postolio-dev-api-cluster \
     --services postolio-dev-api-service \
     | jq '.services[0].events[:5]'
   ```

   - If you see `CannotPullContainerError` mentioning architecture, rebuild with the explicit `--platform linux/amd64` flag.

8. **Log verification (optional)**
   ```bash
   aws logs tail Postolio-API-dev-PostolioServiceTaskDefwebLogGroupE0C50488-FjbRcgJRbvM9 --follow
   ```

## Tips

- Always use `docker buildx build` with `--push`; Fargate pulls directly from ECR and requires the manifest before tasks start.
- Keep an eye on older deployments marked `DRAINING` and ensure they finish before concluding the rollout.
- Document the final image digest in the deployment notes if opening an incident report or PR.
