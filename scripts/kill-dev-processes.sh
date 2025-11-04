#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_PORTS=(3000 3002 5173)
PORTS=("${DEFAULT_PORTS[@]}")

if [[ -n "${DEV_PORTS:-}" ]]; then
  # shellcheck disable=SC2206
  EXTRA_PORTS=(${DEV_PORTS})
  PORTS+=("${EXTRA_PORTS[@]}")
fi

PID_FILES=(api.dev.pid web.dev.pid assets.dev.pid)
PATTERNS=(
  "pnpm --filter api dev"
  "pnpm --filter @postolio/assets-api dev"
  "pnpm --filter @postolio/assets-api dev:server"
  "pnpm --filter @postolio/web dev"
  "tsx watch src/server.ts"
  "tsx watch src/index.ts"
  "vite dev"
)

found=0

kill_pid() {
  local pid="$1"
  local reason="$2"

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  echo "Stopping PID ${pid} (${reason})"
  kill "$pid" >/dev/null 2>&1 || true
  sleep 1

  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "PID ${pid} still running, sending SIGKILL"
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
  ((found++))
  return 0
}

kill_pattern() {
  local pattern="$1"
  local matches
  matches="$(pgrep -f "$pattern" 2>/dev/null || true)"
  if [[ -n "$matches" ]]; then
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      kill_pid "$pid" "pattern ${pattern}"
    done <<< "$matches"
  fi
}

for pattern in "${PATTERNS[@]}"; do
  kill_pattern "$pattern"
done

for pid_file in "${PID_FILES[@]}"; do
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    kill_pid "$pid" "pid file ${pid_file}"
    rm -f "$pid_file"
  fi
done

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof is required to free ports automatically. Install lsof or kill processes manually." >&2
  exit 1
fi

for port in "${PORTS[@]}"; do
  pids="$(lsof -t -i tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      kill_pid "$pid" "port ${port}"
    done <<< "$pids"
  fi
done

for port in "${PORTS[@]}"; do
  attempts=10
  while lsof -t -i tcp:"$port" >/dev/null 2>&1; do
    if (( attempts == 0 )); then
      echo "Port ${port} is still busy after multiple attempts." >&2
      exit 1
    fi
    attempts=$((attempts-1))
    sleep 0.5
  done
done

if (( found == 0 )); then
  echo "No lingering dev processes found."
else
  echo "Stopped ${found} lingering processes. Ports ${PORTS[*]} should now be free."
fi
