#!/usr/bin/env bash
set -euo pipefail

# Simple CI guard to prevent usage of Tailwind palette utilities
# outside of UI primitives. Allows dynamic inline style usage.

TARGET_DIR=${1:-"packages/apps/web/src"}

if ! command -v rg >/dev/null 2>&1; then
  echo "[palette-guard] ripgrep (rg) not found; skipping check." >&2
  exit 0
fi

PATTERN='\b(text|bg|border|ring|from|to|via)-(red|green|blue|gray|zinc|neutral|rose|fuchsia|purple|violet|indigo|sky|cyan|teal|emerald|lime|yellow|amber|orange|stone)(-|:|/|\b)'

echo "Checking for disallowed Tailwind palette utilities in ${TARGET_DIR}..."

# Exclude UI primitives and CSS
EXCLUDES=(
  "-g" "!**/components/ui/**"
  "-g" "!**/src/index.css"
  "-g" "!**/*.css"
)

MATCHES=$(rg -n --no-heading ${EXCLUDES[@]} "${PATTERN}" "${TARGET_DIR}" || true)

if [[ -n "${MATCHES}" ]]; then
  echo "Found disallowed palette classes:"
  echo "${MATCHES}"
  echo "\nPlease replace with shadcn tokens (e.g., text-foreground, bg-muted) or use inline styles for data-driven colors."
  exit 1
fi

echo "OK: No disallowed palette utilities found in ${TARGET_DIR}."
