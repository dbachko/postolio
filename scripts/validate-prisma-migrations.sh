#!/usr/bin/env bash

set -euo pipefail

# Validate that Prisma schema changes are accompanied by migrations.
# This is a lightweight Git-based check that does NOT touch a database.

ROOT_DIR="$(cd "$(dirname "${BASH_REMATCH[0]:-${BASH_SOURCE[0]}}")/.." && pwd 2>/dev/null || pwd)"
cd "${ROOT_DIR}"

SCHEMA_PATH="packages/libs/database/prisma/schema.prisma"
MIGRATIONS_DIR="packages/libs/database/prisma/migrations"

if ! command -v git >/dev/null 2>&1; then
  echo "[migrations] git not available; skipping schema/migration validation."
  exit 0
fi

# Determine a sensible base ref to diff against:
# - Prefer merge-base with origin/main (typical PR / branch flow)
# - Fallback to the first commit if origin/main is unavailable (e.g., fresh repo)
BASE_REF=""
if git rev-parse --verify origin/main >/dev/null 2>&1; then
  if BASE="$(git merge-base HEAD origin/main 2>/dev/null)"; then
    BASE_REF="${BASE}"
  fi
fi

if [[ -z "${BASE_REF}" ]]; then
  BASE_REF="$(git rev-list --max-parents=0 HEAD | tail -n 1)"
fi

CHANGED_FILES="$(git diff --name-only "${BASE_REF}"...HEAD || true)"

if [[ -z "${CHANGED_FILES}" ]]; then
  echo "[migrations] No files changed since base (${BASE_REF}); skipping validation."
  exit 0
fi

schema_changed=false
migrations_changed=false

while IFS= read -r file; do
  if [[ "${file}" == "${SCHEMA_PATH}" ]]; then
    schema_changed=true
  elif [[ "${file}" == ${MIGRATIONS_DIR}/* ]]; then
    migrations_changed=true
  fi
done <<< "${CHANGED_FILES}"

if [[ "${schema_changed}" == true && "${migrations_changed}" == false ]]; then
  echo "[migrations] Detected changes to ${SCHEMA_PATH} without any changes under ${MIGRATIONS_DIR}/."
  echo "[migrations] This usually indicates Prisma schema changes without a corresponding migration."
  echo "[migrations] Generate a migration, commit it, and try again. For example:"
  echo "  cd packages/libs/database"
  echo "  pnpm db:migrate   # runs 'prisma migrate dev' and creates a new migration folder"
  exit 1
fi

echo "[migrations] Schema/migration validation passed."

