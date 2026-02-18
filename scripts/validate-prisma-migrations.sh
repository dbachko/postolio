#!/usr/bin/env bash

set -euo pipefail

# Validate that Prisma schema changes are accompanied by migrations.
# This is a lightweight Git-based check that does NOT touch a database.

ROOT_DIR="$(cd "$(dirname "${BASH_REMATCH[0]:-${BASH_SOURCE[0]}}")/.." && pwd 2>/dev/null || pwd)"
cd "${ROOT_DIR}"

MAIN_SCHEMA_PATH="packages/libs/database/prisma/schema.prisma"
MAIN_MIGRATIONS_DIR="packages/libs/database/prisma/migrations"
ASSETS_SCHEMA_PATH="packages/libs/database-assets/prisma/schema.prisma"
ASSETS_MIGRATIONS_DIR="packages/libs/database-assets/prisma/migrations"

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

strip_non_migration_schema_changes() {
  # Remove generator/datasource blocks, comments, and blank lines so we only
  # compare model/type/enums that actually affect migrations.
  awk '
    BEGIN { skip=0; depth=0 }
    /^[[:space:]]*(generator|datasource)[[:space:]][A-Za-z0-9_]+[[:space:]]*[{]/ { skip=1; depth=1; next }
    skip == 1 {
      depth += gsub(/[{]/, "{")
      depth -= gsub(/[}]/, "}")
      if (depth <= 0) { skip=0; depth=0 }
      next
    }
    {
      line=$0
      sub(/^[[:space:]]+/, "", line)
      if (substr(line, 1, 2) == "//") next
      if (line == "") next
      print
    }
  '
}

validate_schema() {
  local schema_path="$1"
  local migrations_dir="$2"
  local package_dir="$3"

  local schema_changed=false
  local migrations_changed=false

  while IFS= read -r file; do
    if [[ "${file}" == "${schema_path}" ]]; then
      schema_changed=true
    elif [[ "${file}" == ${migrations_dir}/* ]]; then
      migrations_changed=true
    fi
  done <<< "${CHANGED_FILES}"

  if [[ "${schema_changed}" == true && "${migrations_changed}" == false ]]; then
    # Allow changes that only touch generator/datasource blocks (e.g., Prisma v7 migration),
    # comments, or whitespace; these don't require a DB migration.
    local base_schema
    local head_schema
    base_schema="$(git show "${BASE_REF}:${schema_path}" 2>/dev/null || true)"
    head_schema="$(cat "${schema_path}" 2>/dev/null || true)"

    if [[ -n "${base_schema}" && -n "${head_schema}" ]]; then
      local base_stripped
      local head_stripped
      base_stripped="$(printf '%s\n' "${base_schema}" | strip_non_migration_schema_changes)"
      head_stripped="$(printf '%s\n' "${head_schema}" | strip_non_migration_schema_changes)"

      if diff -q <(printf '%s\n' "${base_stripped}") <(printf '%s\n' "${head_stripped}") >/dev/null 2>&1; then
        echo "[migrations] ${schema_path}: changes are limited to generator/datasource/comments; skipping migration requirement."
        return 0
      fi
    fi

    echo "[migrations] Detected changes to ${schema_path} without any changes under ${migrations_dir}/."
    echo "[migrations] This usually indicates Prisma schema changes without a corresponding migration."
    echo "[migrations] Generate a migration, commit it, and try again. For example:"
    echo "  cd ${package_dir}"
    echo "  pnpm db:migrate   # runs 'prisma migrate dev' and creates a new migration folder"
    return 1
  fi
}

if ! validate_schema "${MAIN_SCHEMA_PATH}" "${MAIN_MIGRATIONS_DIR}" "packages/libs/database"; then
  exit 1
fi

if ! validate_schema "${ASSETS_SCHEMA_PATH}" "${ASSETS_MIGRATIONS_DIR}" "packages/libs/database-assets"; then
  exit 1
fi

echo "[migrations] Schema/migration validation passed."
