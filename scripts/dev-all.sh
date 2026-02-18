#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
else
  echo "WARNING: .env not found in repo root; proceeding with existing environment variables."
fi

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-postolio}"
DEV_SEED_EMAIL="${DEV_SEED_EMAIL:-dev@postolio.test}"
DEV_SEED_PASSWORD="${DEV_SEED_PASSWORD:-Test123!@#}"
DEV_SEED_NAME="${DEV_SEED_NAME:-Dev User}"
DEV_SEED_BRAND="${DEV_SEED_BRAND:-Dev Brand}"
DEV_SEED_POSTS="${DEV_SEED_POSTS:-10}"
ASSETS_API_PORT="${ASSETS_API_PORT:-3002}"
SKIP_ASSETS_DB_RESET="${SKIP_ASSETS_DB_RESET:-0}"
SKIP_ASSETS_SEED="${SKIP_ASSETS_SEED:-0}"
ASSETS_SEED_BRAND_EMAIL="${ASSETS_SEED_BRAND_EMAIL:-$DEV_SEED_EMAIL}"
ASSETS_SEED_BRAND_NAME="${ASSETS_SEED_BRAND_NAME:-$DEV_SEED_BRAND}"
ASSETS_SEED_COUNT="${ASSETS_SEED_COUNT:-12}"
ASSETS_SEED_CDN_BASE="${ASSETS_SEED_CDN_BASE:-https://picsum.photos}"

PIDS=()
NAMES=()

cleanup() {
  local exit_code="${1:-0}"
  trap - EXIT INT TERM

  if (( ${#PIDS[@]} )); then
    echo -e "\nStopping dev processes..."
    for pid in "${PIDS[@]}"; do
      if kill -0 "$pid" >/dev/null 2>&1; then
        kill "$pid" >/dev/null 2>&1 || true
      fi
    done
  fi

  # Wait for children to exit quietly
  wait || true
  exit "$exit_code"
}

trap 'cleanup $?' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

start_service() {
  local name="$1"
  shift
  echo "Starting ${name}..."
  "$@" &
  local pid=$!
  PIDS+=("$pid")
  NAMES+=("$name")
}

wait_for_http_endpoint() {
  local url="$1"
  local max_attempts="${2:-30}"
  local sleep_seconds="${3:-2}"

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is not installed; skipping readiness check for ${url}"
    return 0
  fi

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if curl -fsS -o /dev/null "$url"; then
      return 0
    fi
    echo "Waiting for ${url} (attempt ${attempt}/${max_attempts})..."
    sleep "${sleep_seconds}"
  done

  echo "Timed out waiting for ${url}"
  return 1
}

wait_for_compose_service_health() {
  local service="$1"
  local max_attempts="${2:-60}"
  local sleep_seconds="${3:-1}"

  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not installed; skipping readiness check for ${service}"
    return 0
  fi

  local container_id=""
  container_id="$(docker compose -p "${COMPOSE_PROJECT_NAME}" ps -q "${service}" 2>/dev/null || true)"
  if [[ -z "${container_id}" ]]; then
    echo "Unable to resolve container id for service '${service}' (project ${COMPOSE_PROJECT_NAME})"
    return 1
  fi

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    local status=""
    status="$(
      docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "${container_id}" 2>/dev/null || true
    )"

    if [[ "${status}" == "healthy" ]]; then
      echo "Service '${service}' is healthy."
      return 0
    fi

    if [[ "${status}" == "exited" || "${status}" == "dead" ]]; then
      echo "Service '${service}' is not running (status=${status})."
      return 1
    fi

    echo "Waiting for service '${service}' health (status=${status:-unknown}) (attempt ${attempt}/${max_attempts})..."
    sleep "${sleep_seconds}"
  done

  echo "Timed out waiting for service '${service}' to become healthy."
  return 1
}

derive_origin_from_url() {
  local input="$1"
  if [[ "$input" =~ ^https?://[^/]+ ]]; then
    printf '%s' "${BASH_REMATCH[0]}"
    return 0
  fi
  return 1
}

ASSETS_API_HEALTHCHECK_URL="${ASSETS_API_HEALTHCHECK_URL:-}"
if [[ -z "${ASSETS_API_HEALTHCHECK_URL}" && -n "${ASSETS_API_BASE_URL:-}" ]]; then
  if origin="$(derive_origin_from_url "${ASSETS_API_BASE_URL}")" && [[ -n "${origin}" ]]; then
    ASSETS_API_HEALTHCHECK_URL="${origin}/health"
  fi
fi

ASSETS_API_STARTED=0

start_assets_api_service() {
  if [[ "${ASSETS_API_STARTED}" -eq 1 ]]; then
    return
  fi

  if [[ -z "${ASSETS_DATABASE_URL:-}" ]]; then
    echo "ASSETS_DATABASE_URL is unset; cannot start Assets API."
    return 1
  fi

  start_service "Assets API" env ASSETS_API_PORT="${ASSETS_API_PORT}" PORT="${ASSETS_API_PORT}" pnpm --filter @postolio/assets-api dev
  ASSETS_API_STARTED=1

  if [[ -n "${ASSETS_API_HEALTHCHECK_URL:-}" ]]; then
    echo "Waiting for Assets API readiness at ${ASSETS_API_HEALTHCHECK_URL}..."
    wait_for_http_endpoint "${ASSETS_API_HEALTHCHECK_URL}" 30 2
  else
    echo "Assets API healthcheck URL not detected; continuing without readiness verification."
    sleep 2
  fi
}

"$ROOT_DIR/scripts/kill-dev-processes.sh" || true

echo "Restarting local infrastructure (COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME})..."
"$ROOT_DIR/scripts/restart-dev-stack.sh"

echo "Waiting for local infrastructure readiness..."
wait_for_compose_service_health postgres 60 1
wait_for_compose_service_health postgres_assets 60 1
wait_for_compose_service_health redis 60 1

if [[ "${SKIP_ASSETS_DB_RESET:-0}" != "1" ]]; then
  if [[ -n "${ASSETS_DATABASE_URL:-}" ]]; then
    echo "Resetting assets Postgres database via Prisma..."
    pnpm --filter @postolio/database-assets exec -- prisma migrate reset --force
  else
    echo "ASSETS_DATABASE_URL is unset; cannot reset assets DB."
  fi
else
  echo "Skipping assets DB reset because SKIP_ASSETS_DB_RESET=1"
fi

if [[ -n "${ASSETS_DATABASE_URL:-}" ]]; then
  echo "Applying assets database migrations..."
  pnpm --filter @postolio/database-assets exec -- prisma migrate deploy
else
  echo "ASSETS_DATABASE_URL not set; skipping assets migration deploy."
fi

if [[ -n "${ASSETS_DATABASE_URL:-}" ]]; then
  echo "Bootstrapping local Assets API before running content seeds..."
  start_assets_api_service
else
  echo "ASSETS_DATABASE_URL is unset; skipping Assets API startup (asset imports may fail)."
fi

if [[ "${SKIP_DB_RESET:-0}" != "1" ]]; then
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "Resetting primary Postgres database via Prisma..."
    pnpm --filter @postolio/database exec -- prisma migrate reset --force

    echo "Generating primary Prisma client..."
    pnpm --filter @postolio/database run build

    echo "Seeding deterministic dev data (${DEV_SEED_EMAIL})..."
    pnpm --filter api seed:dev -- --email="${DEV_SEED_EMAIL}" --password="${DEV_SEED_PASSWORD}" --name="${DEV_SEED_NAME}" --brand="${DEV_SEED_BRAND}" --posts="${DEV_SEED_POSTS}"
  else
    echo "DATABASE_URL is not set; skipping DB reset."
  fi
else
  echo "Skipping database reset because SKIP_DB_RESET=1"
fi

# Always attempt to apply any pending primary DB migrations (covers SKIP_DB_RESET case)
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "Applying primary database migrations..."
  pnpm --filter @postolio/database exec -- prisma migrate deploy
else
  echo "DATABASE_URL not set; skipping primary migration deploy."
fi

if [[ "${SKIP_ASSETS_SEED:-0}" != "1" ]]; then
  if [[ -n "${ASSETS_DATABASE_URL:-}" ]]; then
    echo "Resolving brand ID for assets seed (email=${ASSETS_SEED_BRAND_EMAIL}, brand=${ASSETS_SEED_BRAND_NAME})..."
    BRAND_LOOKUP_ARGS=(--email="${ASSETS_SEED_BRAND_EMAIL}")
    if [[ -n "${ASSETS_SEED_BRAND_NAME:-}" ]]; then
      BRAND_LOOKUP_ARGS+=("--brand=${ASSETS_SEED_BRAND_NAME}")
    fi

    if BRAND_OUTPUT="$(pnpm --filter api exec -- tsx scripts/get-brand-id.ts "${BRAND_LOOKUP_ARGS[@]}")"; then
      BRAND_ID="$(echo "${BRAND_OUTPUT}" | awk '/^[A-Za-z0-9_-]{10,}$/ {print; exit}')"
      BRAND_ID="$(echo "${BRAND_ID}" | tr -d '\r\n')"
    else
      BRAND_ID=""
    fi

    if [[ -z "${BRAND_ID}" ]]; then
      echo "Unable to determine brand ID for assets seed; skipping."
    else
      echo "Seeding assets database for brand ${BRAND_ID}..."
      ASSETS_SEED_CMD=(pnpm --filter @postolio/database-assets db:seed -- --brandId="${BRAND_ID}" --count="${ASSETS_SEED_COUNT}")
      if [[ -n "${ASSETS_SEED_CDN_BASE}" ]]; then
        ASSETS_SEED_CMD+=("--cdnBase=${ASSETS_SEED_CDN_BASE}")
      fi
      "${ASSETS_SEED_CMD[@]}"
    fi
  else
    echo "ASSETS_DATABASE_URL not set; skipping assets DB seed."
  fi
else
  echo "Skipping assets DB seed because SKIP_ASSETS_SEED=1"
fi

if [[ "${SKIP_DEP_BUILDS:-0}" != "1" ]]; then
  echo "Building API workspace dependencies (one-time per clean)..."
  pnpm --filter api run build:deps

  echo "Building web workspace dependencies (one-time per clean)..."
  pnpm --filter @postolio/web^... run build
else
  echo "Skipping dependency builds because SKIP_DEP_BUILDS=1"
fi

start_service "Fastify API" pnpm --filter api dev
if [[ "${ASSETS_API_STARTED}" -ne 1 ]]; then
  if [[ -n "${ASSETS_DATABASE_URL:-}" ]]; then
    start_assets_api_service
  else
    echo "ASSETS_DATABASE_URL is unset; Assets API will not start."
  fi
fi
start_service "Web UI" pnpm --filter @postolio/web dev

echo -e "\nAll dev services are running. Press Ctrl+C to stop everything."

while true; do
  for idx in "${!PIDS[@]}"; do
    pid="${PIDS[$idx]}"
    name="${NAMES[$idx]}"
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      wait "$pid" || true
      echo "'${name}' process exited; stopping remaining services."
      cleanup 1
    fi
  done
  sleep 1
done
