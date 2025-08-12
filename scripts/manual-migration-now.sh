#!/bin/bash

# IMMEDIATE manual migration fix for production
# This runs the migration directly in the running container

set -e

echo "==========================================="
echo "🚨 RUNNING IMMEDIATE MIGRATION FIX"
echo "==========================================="
echo ""

CLUSTER="Postolio-dev-PostolioCluster45B01E48-JnKPELhN8CEq"
SERVICE="Postolio-dev-PostolioService71B9CD8C-BctX9mosXeEz"

echo "Finding running task..."
TASK_ARN=$(aws ecs list-tasks --cluster $CLUSTER --service-name $SERVICE --desired-status RUNNING --query 'taskArns[0]' --output text)

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
    echo "❌ No running tasks found"
    exit 1
fi

echo "Task ARN: $TASK_ARN"
echo ""

# First, let's check the actual environment variables
echo "Checking environment variables in container..."
aws ecs execute-command \
    --cluster $CLUSTER \
    --task $TASK_ARN \
    --container postolio-container \
    --interactive \
    --command "sh -c 'echo DB_HOST=\$DB_HOST; echo DB_USERNAME=\$DB_USERNAME; echo DB_PASSWORD=[hidden]; echo DB_PORT=\$DB_PORT'"

echo ""
echo "Constructing DATABASE_URL and running migration..."

# Run the migration with constructed DATABASE_URL
aws ecs execute-command \
    --cluster $CLUSTER \
    --task $TASK_ARN \
    --container postolio-container \
    --interactive \
    --command "sh -c 'export DATABASE_URL=\"postgresql://\${DB_USERNAME}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT:-5433}/postolio\" && echo \"DATABASE_URL configured\" && npx prisma migrate deploy --schema=./prisma/schema.prisma'"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration completed successfully!"
    echo ""
    echo "Restarting service to ensure all containers have the schema..."
    aws ecs update-service --cluster $CLUSTER --service $SERVICE --force-new-deployment
    echo ""
    echo "✅ Service restart initiated"
else
    echo ""
    echo "❌ Migration failed!"
    echo "Try running the direct SQL migration instead:"
    echo "./scripts/direct-sql-migration.sh dev"
fi