# API container deployment

The [deployment workflow](../.github/workflows/README.md) builds images and deploys the selected CDK stacks. Use this guide when preparing an image manually.

## Build and push

Authenticate Docker to your ECR registry, then run from the repository root with your registry and tag:

```bash
docker buildx build \
  --platform linux/amd64 \
  -f packages/apps/api/Dockerfile \
  -t <registry>/postolio:<image-tag> \
  --push .
```

The image platform must match the ECS task. Deploy the selected tag through the stack configuration:

```bash
./scripts/deploy-stack.sh -e dev -t <image-tag> api
```

A forced ECS deployment alone does not select a different image tag. Verify the task definition references the image you intend to run.

## Verify

Inspect ECS service events and task status. Confirm running tasks use the intended image and digest, health checks pass, and application logs contain no startup errors. For pull failures, check the tag, image platform, registry permissions, and network access.
