#!/bin/bash

# Quick fix to add DATABASE_URL to ECS task definition
# This constructs DATABASE_URL from existing environment variables

set -e

echo "==========================================="
echo "🔧 FIXING DATABASE_URL IN ECS TASK"
echo "==========================================="
echo ""

if [ "$1" != "dev" ] && [ "$1" != "prod" ]; then
    echo "Usage: $0 [dev|prod]"
    exit 1
fi

ENV=$1
STACK_NAME="Postolio-$ENV"

echo "Environment: $ENV"
echo ""

# Get the current task definition
echo "Getting current task definition..."
TASK_FAMILY="Postolio${ENV}PostolioServiceTaskDef"

# Get the latest task definition revision
TASK_DEF=$(aws ecs describe-task-definition --task-definition $TASK_FAMILY --query 'taskDefinition' --output json)

if [ -z "$TASK_DEF" ]; then
    echo "❌ Could not find task definition"
    exit 1
fi

# Extract the container definition
CONTAINER_DEF=$(echo $TASK_DEF | jq '.containerDefinitions[0]')

# Get DB_HOST from environment variables
DB_HOST=$(echo $CONTAINER_DEF | jq -r '.environment[] | select(.name=="DB_HOST") | .value')
DB_PORT=$(echo $CONTAINER_DEF | jq -r '.environment[] | select(.name=="DB_PORT") | .value // "5432"')
DB_NAME="postolio"

echo "Database configuration:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  Database: $DB_NAME"
echo ""

# Add DATABASE_URL to the environment variables
echo "Adding DATABASE_URL environment variable..."

# Create a new environment array with DATABASE_URL
NEW_ENV=$(echo $CONTAINER_DEF | jq --arg dbhost "$DB_HOST" --arg dbport "$DB_PORT" --arg dbname "$DB_NAME" '.environment += [{
    "name": "DATABASE_URL",
    "value": ("postgresql://\(.secrets[] | select(.name=="DB_USERNAME") | .name):\(.secrets[] | select(.name=="DB_PASSWORD") | .name)@" + $dbhost + ":" + $dbport + "/" + $dbname)
}]')

# Actually, we need to construct it differently since username/password are secrets
# We'll add a startup wrapper that constructs DATABASE_URL from the components

cat > /tmp/database-url-wrapper.sh << 'EOF'
#!/bin/sh
# Wrapper script to construct DATABASE_URL from components
export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/postolio"
echo "DATABASE_URL configured (connection string hidden for security)"
exec "$@"
EOF

echo ""
echo "To fix this issue, we need to update the Docker image with a wrapper script"
echo "or update the CDK stack to properly set DATABASE_URL."
echo ""
echo "Temporary workaround:"
echo "1. Run the emergency migration script to apply migrations manually:"
echo "   ./scripts/emergency-migration-fix.sh $ENV"
echo ""
echo "2. Or run direct SQL migration:"
echo "   ./scripts/direct-sql-migration.sh $ENV"
echo ""
echo "Permanent fix:"
echo "Update the CDK stack to construct DATABASE_URL from the components."