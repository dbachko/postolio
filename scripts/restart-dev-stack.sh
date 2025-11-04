#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Allows overriding with `COMPOSE_PROJECT_NAME=my-name ./scripts/restart-dev-stack.sh`
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-postolio}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed or not in PATH" >&2
  exit 1
fi

echo "Restarting docker compose stack for project '${PROJECT_NAME}' in ${ROOT_DIR}"

docker compose -p "${PROJECT_NAME}" down --remove-orphans
docker compose -p "${PROJECT_NAME}" up -d

echo "All services are up. Use COMPOSE_PROJECT_NAME to choose a different shared name."
