#!/usr/bin/env bash
# Run the Postolio dev stack in an isolated Linux environment on your Mac:
# an OrbStack machine or a Docker container. Both run the same Ubuntu setup,
# so every command behaves the same on either backend.
# Usage: scripts/devenv.sh [--backend orb|docker] <command> [options]
#        (run with "help" for details)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${POSTOLIO_DEV_NAME:-postolio}"
DISTRO="${POSTOLIO_DEV_DISTRO:-ubuntu:noble}"
# Node major and pnpm version follow the repo (.nvmrc and packageManager).
NODE_MAJOR="${POSTOLIO_DEV_NODE_MAJOR:-$(tr -dc '0-9.' < "$ROOT_DIR/.nvmrc" | cut -d. -f1)}"
PNPM_VERSION="$(sed -n 's/.*"packageManager": *"pnpm@\([^"+]*\).*/\1/p' "$ROOT_DIR/package.json")"
READY_TIMEOUT="${POSTOLIO_DEV_READY_TIMEOUT:-900}"

# Paths inside the environment. "$HOME" is expanded by the environment's shell.
REMOTE_DIR='$HOME/postolio'
REMOTE_LOG='$HOME/dev-stack.log'
REMOTE_PID='$HOME/dev-stack.pid'
REMOTE_SEEDED='$HOME/.postolio-seeded'
REMOTE_MCP_DIR='$HOME/playwright-mcp'
REMOTE_MCP_LOG='$HOME/playwright-mcp.log'
REMOTE_MCP_PID='$HOME/playwright-mcp.pid'

# Playwright MCP server that drives a headless Chromium inside the environment.
MCP_VERSION="${POSTOLIO_DEV_MCP_VERSION:-0.0.83}"
MCP_PORT="${POSTOLIO_DEV_MCP_PORT:-8931}"
MCP_NAME="${POSTOLIO_DEV_MCP_NAME:-postolio-browser}"
MCP_URL="http://localhost:${MCP_PORT}/mcp"
# Screenshots and snapshots land here. The environment sees this folder at the
# same path (OrbStack's /Users mount, or a Docker bind mount), so file paths in
# MCP results are valid on the Mac too.
MCP_OUTPUT_DIR="${ROOT_DIR}/.playwright-mcp"

WEB_URL="http://localhost:5173"
HEALTH_URLS=("http://localhost:3000/health" "http://localhost:3002/health" "http://localhost:5173/")
APP_PORTS=("web:5173" "api:3000" "assets-api:3002" "mcp:${MCP_PORT}")
DB_PORTS=("postgres:5432" "postgres-assets:5433" "valkey:6379")

SCRIPT="$(basename "$0")"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Run the Postolio dev stack in an OrbStack machine or a Docker container.

Usage: ${SCRIPT} [--backend orb|docker] <command> [options]

Commands:
  up [--reset] [--no-mcp] [--watch]
                    Create/provision the environment if needed, sync code, install
                    deps, start the stack and the Playwright MCP server. Seeds the
                    databases on the first run. --watch keeps syncing edits afterwards.
  watch             Hot reload: copy every file you save into the environment as it
                    changes (Vite HMR and tsx watch reload there). Ctrl+C to stop.
  sync              One-off copy of your working tree (tracked + untracked, minus
                    ignored files) into the environment.
  start [--reset]   Start the stack (already synced). --reset wipes and reseeds the DBs.
  stop              Stop the dev processes, MCP server and Postgres/Valkey (data kept).
  restart [--reset] stop + sync + start.
  seed [--email E] [--password P] [--name N] [--brand B]
                    Create (or recreate) a test account with sample data.
                    Defaults: test@postolio.test, password Test123!@#.
  status            Show environment state, service health and port forwarding.
  ports             Check that each port is reachable from the Mac.
  mcp <start|stop|status|config>
                    Manage the Playwright MCP server (headless Chromium in the
                    environment) that AI agents on the Mac use to test the app.
                    'config' prints how to register it with Claude Code.
  logs [-n N]       Follow the stack log (Ctrl+C to stop following).
  shell             Open a shell in the repo copy inside the environment.
  open              Open the web app in your browser.
  destroy           Delete the environment and everything in it.

Backends (--backend, or POSTOLIO_DEV_BACKEND):
  orb      OrbStack Linux machine "${ENV_NAME}".
  docker   Docker container "${ENV_NAME}-devenv" on the engine your docker CLI
           uses (Docker Desktop, OrbStack, Colima, ...). Runs privileged, with
           its own Docker daemon for Postgres and Valkey.
  Without a choice, the backend whose environment already exists is used;
  for a new environment, orb if OrbStack is installed, otherwise docker.

Environment:
  POSTOLIO_DEV_BACKEND      orb or docker
  POSTOLIO_DEV_NAME         Environment name (default: postolio)
  POSTOLIO_DEV_MCP_PORT     Playwright MCP port (default: 8931)
  POSTOLIO_DEV_MCP_VERSION  @playwright/mcp version (default: ${MCP_VERSION})

Web ${WEB_URL}, API :3000, assets API :3002 and MCP ${MCP_URL} reach the
Mac's localhost on both backends. Postgres :5432/:5433 and Valkey :6379 do
too on orb; on docker they stay inside the container.
EOF
}

# --- Backends ---------------------------------------------------------------
# Each backend provides: be_available, be_state (running|stopped|""), be_create,
# be_start, be_exec, be_exec_root, be_exec_tty, be_exec_prefix, be_destroy,
# be_start_dockerd, plus BE_LABEL, BE_PORTS and BE_EXTRA_HOSTS.

find_orb() {
  if command -v orb >/dev/null 2>&1; then
    command -v orb
  elif [[ -x /Applications/OrbStack.app/Contents/MacOS/bin/orb ]]; then
    echo /Applications/OrbStack.app/Contents/MacOS/bin/orb
  fi
}

find_docker() {
  if command -v docker >/dev/null 2>&1 && docker version >/dev/null 2>&1; then
    command -v docker
  elif [[ -x /Applications/OrbStack.app/Contents/MacOS/xbin/docker ]]; then
    echo /Applications/OrbStack.app/Contents/MacOS/xbin/docker
  elif command -v docker >/dev/null 2>&1; then
    command -v docker
  fi
}

ORB="$(find_orb)"
DOCKER="$(find_docker)"

# ---- orb: OrbStack Linux machine
orb_available() { [[ -n "$ORB" ]]; }
orb_state() {
  orb_available || return 0
  "$ORB" list 2>/dev/null | awk -v m="$ENV_NAME" '$1 == m { print $2 }'
}
orb_ensure_engine() {
  if [[ "$("$ORB" status 2>/dev/null)" != "Running" ]]; then
    log "Starting OrbStack..."
    "$ORB" start >/dev/null
  fi
}
orb_create() { "$ORB" create "$DISTRO" "$ENV_NAME" >/dev/null; }
orb_start() { "$ORB" start "$ENV_NAME" >/dev/null; }
orb_exec() { "$ORB" -m "$ENV_NAME" bash -c "$1"; }
orb_exec_root() { "$ORB" -m "$ENV_NAME" -u root bash -c "$1"; }
orb_exec_tty() { "$ORB" -m "$ENV_NAME" bash -c "$1"; }
orb_exec_prefix() { printf '%s\n' "$ORB" -m "$ENV_NAME"; }
orb_destroy() { "$ORB" delete -f "$ENV_NAME"; }
orb_start_dockerd() {
  orb_exec_root 'command -v dockerd >/dev/null || exit 0; systemctl enable --now docker >/dev/null 2>&1'
}

# ---- docker: privileged Ubuntu container with its own Docker daemon
CONTAINER="${ENV_NAME}-devenv"
DEV_USER="$(printf '%s' "${USER:-dev}" | tr -cd 'a-z0-9_-')"
DEV_USER="${DEV_USER:-dev}"

docker_available() { [[ -n "$DOCKER" ]] && "$DOCKER" version >/dev/null 2>&1; }
docker_state() {
  docker_available || return 0
  local s
  s="$("$DOCKER" inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)"
  case "$s" in
    running) echo running ;;
    "") ;;
    *) echo stopped ;;
  esac
}
docker_ensure_engine() {
  [[ -n "$DOCKER" ]] || die "Docker CLI not found. Install Docker Desktop or OrbStack."
  "$DOCKER" version >/dev/null 2>&1 || die "The Docker engine is not running (start Docker Desktop or OrbStack)."
}
# Pull a public image. If the Docker config names a credential helper that is no
# longer installed (e.g. "desktop" after removing Docker Desktop), pulls fail even
# for public images; retry once with an empty config, which pulls anonymously.
docker_pull_public() {
  local image="$1" out tmp
  "$DOCKER" image inspect "$image" >/dev/null 2>&1 && return 0
  if out="$("$DOCKER" pull -q "$image" 2>&1)"; then
    return 0
  fi
  if [[ "$out" == *"docker-credential-"* ]]; then
    warn "Your Docker config names a credential helper that isn't installed (${out##*exec: }). Pulling ${image} anonymously."
    warn "To fix it for good, remove \"credsStore\" from ~/.docker/config.json or install that helper."
    tmp="$(mktemp -d)"
    # An empty config also drops the current context, so keep its endpoint.
    local host="${DOCKER_HOST:-$("$DOCKER" context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)}"
    if DOCKER_CONFIG="$tmp" DOCKER_HOST="$host" "$DOCKER" pull -q "$image" >/dev/null; then
      rm -rf "$tmp"
      return 0
    fi
    rm -rf "$tmp"
  fi
  printf '%s\n' "$out" >&2
  die "Could not pull ${image}."
}

docker_create() {
  mkdir -p "$MCP_OUTPUT_DIR"
  docker_pull_public "$DISTRO"
  local port
  local ports=()
  for port in 5173 3000 3002 "$MCP_PORT"; do ports+=(-p "127.0.0.1:${port}:${port}"); done
  # --privileged: the container runs its own Docker daemon for Postgres and Valkey.
  # /var/lib/docker must be a volume (overlayfs can't nest on the container's own).
  "$DOCKER" run -d --name "$CONTAINER" --hostname "$ENV_NAME" --privileged --init \
    "${ports[@]}" \
    -v "${CONTAINER}-docker:/var/lib/docker" \
    -v "${CONTAINER}-home:/home" \
    -v "${MCP_OUTPUT_DIR}:${MCP_OUTPUT_DIR}" \
    --label dev.postolio.devenv=1 \
    "$DISTRO" sleep infinity >/dev/null
  "$DOCKER" exec "$CONTAINER" bash -c "id -u '$DEV_USER' >/dev/null 2>&1 || useradd -m -s /bin/bash '$DEV_USER'"
}
docker_start() { "$DOCKER" start "$CONTAINER" >/dev/null; }
docker_user_args() { printf '%s\n' -u "$DEV_USER" -w "/home/$DEV_USER" -e "HOME=/home/$DEV_USER" -e "USER=$DEV_USER"; }
# Read lines from a command into the array named "lines" (bash 3.2 has no mapfile).
read_lines() {
  lines=()
  local line
  while IFS= read -r line; do lines+=("$line"); done < <("$@")
}

docker_exec() {
  local lines
  read_lines docker_user_args
  "$DOCKER" exec -i "${lines[@]}" "$CONTAINER" bash -c "$1"
}
docker_exec_root() { "$DOCKER" exec -i "$CONTAINER" bash -c "$1"; }
docker_exec_tty() {
  local lines tty=-i
  read_lines docker_user_args
  if [[ -t 0 && -t 1 ]]; then tty=-it; fi
  "$DOCKER" exec "$tty" "${lines[@]}" "$CONTAINER" bash -c "$1"
}
docker_exec_prefix() {
  printf '%s\n' "$DOCKER" exec -i
  docker_user_args
  printf '%s\n' "$CONTAINER"
}
docker_destroy() {
  "$DOCKER" rm -f "$CONTAINER" >/dev/null
  "$DOCKER" volume rm "${CONTAINER}-docker" "${CONTAINER}-home" >/dev/null 2>&1 || true
}
docker_start_dockerd() {
  docker_exec_root '
    command -v dockerd >/dev/null || exit 0
    if ! pgrep -x dockerd >/dev/null; then
      setsid nohup dockerd > /var/log/dockerd.log 2>&1 < /dev/null &
    fi
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done
    echo "dockerd did not start:" >&2
    tail -20 /var/log/dockerd.log >&2
    exit 1
  '
}

# ---- backend selection
BACKEND=""

select_backend() {
  local requested="${1:-${POSTOLIO_DEV_BACKEND:-}}"
  if [[ -z "$requested" ]]; then
    local orb_has="" docker_has="" orb_s docker_s
    orb_s="$(orb_state)"
    docker_s="$(docker_state)"
    [[ -n "$orb_s" ]] && orb_has=1
    [[ -n "$docker_s" ]] && docker_has=1
    if [[ -n "$orb_has" && -n "$docker_has" ]]; then
      # Both exist: use the one that is running, if only one is.
      if [[ "$orb_s" == running && "$docker_s" != running ]]; then
        requested=orb
      elif [[ "$docker_s" == running && "$orb_s" != running ]]; then
        requested=docker
      else
        die "Both an OrbStack machine and a Docker container exist for ${ENV_NAME}. Pass --backend orb or --backend docker."
      fi
    elif [[ -n "$orb_has" ]]; then
      requested=orb
    elif [[ -n "$docker_has" ]]; then
      requested=docker
    elif orb_available; then
      requested=orb
    else
      requested=docker
    fi
  fi
  case "$requested" in
    orb)
      orb_available || die "OrbStack CLI not found. Install OrbStack (https://orbstack.dev) or use --backend docker."
      BACKEND=orb
      BE_LABEL="OrbStack machine ${ENV_NAME}"
      BE_PORTS=("${APP_PORTS[@]}" "${DB_PORTS[@]}")
      BE_EXTRA_HOSTS="${ENV_NAME}.orb.local"
      ;;
    docker)
      BACKEND=docker
      BE_LABEL="Docker container ${CONTAINER}"
      BE_PORTS=("${APP_PORTS[@]}")
      BE_EXTRA_HOSTS=""
      ;;
    *) die "Unknown backend: ${requested} (use orb or docker)" ;;
  esac
}

be() { local fn="$1"; shift; "${BACKEND}_${fn}" "$@"; }
in_env() { be exec "$1"; }
in_env_root() { be exec_root "$1"; }

ensure_env_running() {
  be ensure_engine
  local state
  state="$(be state)"
  if [[ -z "$state" ]]; then
    log "Creating ${BE_LABEL} (${DISTRO})..."
    be create
  elif [[ "$state" != "running" ]]; then
    log "Starting ${BE_LABEL}..."
    be start
  fi
  be start_dockerd
}

require_env() {
  be ensure_engine
  local state
  state="$(be state)"
  [[ -n "$state" ]] || die "${BE_LABEL} does not exist. Run: ${SCRIPT} --backend ${BACKEND} up"
  if [[ "$state" != "running" ]]; then
    log "Starting ${BE_LABEL}..."
    be start
  fi
  be start_dockerd
}

# --- Shared setup (identical on every backend) --------------------------------

provision() {
  [[ -n "$NODE_MAJOR" && -n "$PNPM_VERSION" ]] || die "Could not read the Node version (.nvmrc) or pnpm version (packageManager)."
  if in_env 'command -v docker >/dev/null && command -v rsync >/dev/null && command -v lsof >/dev/null && command -v pgrep >/dev/null && node -v 2>/dev/null | grep -q "^v'"$NODE_MAJOR"'\." && [ "$(pnpm --version 2>/dev/null)" = "'"$PNPM_VERSION"'" ]' 2>/dev/null; then
    return 0
  fi
  log "Installing Docker, Node ${NODE_MAJOR} and pnpm ${PNPM_VERSION} in ${BE_LABEL}..."
  in_env_root '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl git rsync lsof procps docker.io docker-compose-v2 >/dev/null
    if ! node -v 2>/dev/null | grep -q "^v'"$NODE_MAJOR"'\."; then
      curl -fsSL https://deb.nodesource.com/setup_'"$NODE_MAJOR"'.x | bash - >/dev/null 2>&1
      apt-get install -y -qq nodejs >/dev/null
    fi
    # Node 25+ no longer ships corepack, so install the pinned pnpm with npm.
    # Remove pnpm shims a previous corepack setup left behind (npm will not overwrite them).
    # They dangle once corepack is gone, so check the paths directly.
    for path in /usr/bin/pnpm /usr/bin/pnpx /usr/local/bin/pnpm /usr/local/bin/pnpx; do
      if [ -L "$path" ] && readlink "$path" | grep -q corepack; then rm -f "$path"; fi
    done
    npm install -g --no-audit --no-fund --no-update-notifier --loglevel=error "pnpm@'"$PNPM_VERSION"'" >/dev/null
  '
  # Add the default (non-root) user to the docker group, then start the daemon.
  local user
  user="$(in_env 'id -un')"
  in_env_root "usermod -aG docker '$user'"
  be start_dockerd
}

# Stream the working tree from the Mac into the environment.
sync_code() {
  log "Syncing ${ROOT_DIR} -> ${BE_LABEL}:~/postolio ..."
  # git decides what to copy: tracked + untracked files, minus everything ignored
  # (node_modules, dist, .env, ...), so the environment keeps its own installs and
  # .env. Files that dropped out of the list since the last sync are deleted.
  # Files are read on the Mac and streamed in as a tar archive (no shared mounts,
  # which can serve stale contents right after a save). The archive lands in a
  # staging folder and rsync copies only what changed, so running dev servers
  # don't see unchanged files rewritten.
  (
    cd "$ROOT_DIR"
    git ls-files -co --exclude-standard --deduplicate |
      while IFS= read -r f; do
        if [[ -e "$f" || -L "$f" ]]; then printf '%s\n' "$f"; fi
      done |
      COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -cf - -T -
  ) | in_env '
    set -euo pipefail
    dest='"$REMOTE_DIR"'
    staging=$HOME/.postolio-sync-staging
    manifest=$HOME/.postolio-sync-manifest
    rm -rf "$staging" && mkdir -p "$staging" "$dest"
    tar -xf - -C "$staging" --warning=no-unknown-keyword
    (cd "$staging" && find . \( -type f -o -type l \) | sed "s|^\./||" | sort) > "$manifest.new"
    rsync -a "$staging/" "$dest/"
    rm -rf "$staging"
    if [ -f "$manifest" ]; then
      comm -23 "$manifest" "$manifest.new" | (cd "$dest" && xargs -r -d "\n" rm -f --)
    fi
    mv "$manifest.new" "$manifest"
    # Turborepo hashes inputs with git; give the copy a baseline commit once.
    if [ ! -d "$dest/.git" ]; then
      cd "$dest"
      git init -q
      printf "node_modules/\ndist/\n.turbo/\n" >> .git/info/exclude
      git add -A
      git -c user.name=devenv -c user.email=devenv@localhost commit -qm "snapshot" --no-verify
    fi
  '
}

ensure_dotenv() {
  if in_env "test -f $REMOTE_DIR/.env"; then
    return 0
  fi
  if [[ -f "$ROOT_DIR/.env" ]]; then
    log "Copying your .env into the environment..."
    in_env "cat > $REMOTE_DIR/.env" < "$ROOT_DIR/.env"
  else
    log "Creating .env from .env.example with a random JWT_SECRET..."
    in_env '
      set -euo pipefail
      cd '"$REMOTE_DIR"'
      cp .env.example .env
      secret="$(head -c 32 /dev/urandom | base64 | tr -d "/=+")"
      sed -i "s|^JWT_SECRET=.*|JWT_SECRET=\"$secret\"|" .env
    '
  fi
}

install_deps() {
  log "Installing dependencies (pnpm install --frozen-lockfile)..."
  in_env "cd $REMOTE_DIR && pnpm install --frozen-lockfile --reporter=append-only 2>&1 | tail -3"
}

# True when the seed marker lists the current compose volumes and they all exist.
volumes_seeded() {
  in_env '
    cd '"$REMOTE_DIR"' || exit 1
    project="${COMPOSE_PROJECT_NAME:-postolio}"
    expected="$(sg docker -c "docker compose -p $project config --volumes" | sort)"
    [ -n "$expected" ] && [ "$(cat '"$REMOTE_SEEDED"' 2>/dev/null)" = "$expected" ] || exit 1
    for v in $expected; do
      sg docker -c "docker volume inspect ${project}_$v" >/dev/null 2>&1 || exit 1
    done
  '
}

is_running() {
  in_env "test -f $REMOTE_PID && kill -0 \$(cat $REMOTE_PID) 2>/dev/null"
}

start_stack() {
  local reset="${1:-0}"
  if is_running; then
    log "Stack is already running. Use 'restart' to restart it."
    print_urls
    return 0
  fi

  # Seed automatically when the compose data volumes are new (fresh environment,
  # or docker-compose.yml switched to new volumes, e.g. a Postgres major upgrade).
  if [[ "$reset" != "1" ]] && ! volumes_seeded; then
    log "Database volumes are new: seeding the databases."
    reset=1
  fi

  local vite_env=""
  if [[ -n "$BE_EXTRA_HOSTS" ]]; then
    # Let Vite also answer on e.g. http://<machine>.orb.local:5173, the fallback
    # when the Mac's port 5173 is taken and can't be forwarded.
    vite_env="__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.orb.local"
  fi
  local cmd="env $vite_env pnpm dev:stack"
  if [[ "$reset" == "1" ]]; then
    log "Resetting and seeding the environment's databases (your Mac's data is untouched)."
    cmd="env $vite_env CONFIRM_LOCAL_DB_RESET=delete-local-data pnpm dev:reset"
  fi

  log "Starting the dev stack (log: ~/dev-stack.log in ${BE_LABEL})..."
  # setsid gives the stack its own process group so 'stop' can kill all of it.
  # sg picks up docker group membership without a fresh login.
  in_env "cd $REMOTE_DIR && sg docker -c 'setsid nohup bash -c \"echo \\\$\\\$ > $REMOTE_PID; exec $cmd\" > $REMOTE_LOG 2>&1 < /dev/null &'"

  wait_until_ready
  if [[ "$reset" == "1" ]]; then
    in_env "cd $REMOTE_DIR && sg docker -c 'docker compose -p \${COMPOSE_PROJECT_NAME:-postolio} config --volumes' | sort > $REMOTE_SEEDED"
  fi
  print_urls
}

wait_until_ready() {
  log "Waiting for services (first start builds workspace packages; this can take a few minutes)..."
  local start_ts now
  start_ts="$(date +%s)"
  while true; do
    if ! is_running; then
      warn "The stack exited during startup. Last log lines:"
      in_env "tail -40 $REMOTE_LOG" >&2
      exit 1
    fi
    if all_healthy; then
      log "All services are up."
      return 0
    fi
    now="$(date +%s)"
    if (( now - start_ts > READY_TIMEOUT )); then
      warn "Timed out after ${READY_TIMEOUT}s. Last log lines:"
      in_env "tail -40 $REMOTE_LOG" >&2
      exit 1
    fi
    sleep 5
  done
}

all_healthy() {
  local checks=""
  for url in "${HEALTH_URLS[@]}"; do
    checks+="curl -fsS -o /dev/null --max-time 3 '$url' && "
  done
  in_env "${checks}true" >/dev/null 2>&1
}

# Kill the process group whose leader's pid is stored in a file inside the environment.
kill_group() {
  local pidfile="$1"
  in_env '
    if [ -f '"$pidfile"' ]; then
      pgid="$(cat '"$pidfile"')"
      kill -TERM -- "-$pgid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pgid" 2>/dev/null || break; sleep 0.5; done
      kill -KILL -- "-$pgid" 2>/dev/null || true
      rm -f '"$pidfile"'
    fi
  '
}

stop_stack() {
  mcp_stop
  log "Stopping dev processes..."
  kill_group "$REMOTE_PID"
  in_env "cd $REMOTE_DIR 2>/dev/null && bash scripts/kill-dev-processes.sh >/dev/null 2>&1 || true"
  log "Stopping Postgres and Valkey containers (data volumes kept)..."
  in_env "cd $REMOTE_DIR 2>/dev/null && sg docker -c 'docker compose -p \${COMPOSE_PROJECT_NAME:-postolio} stop' 2>&1 | grep -v '^ *$' || true"
}

cmd_seed() {
  local email="test@postolio.test" password="Test123!@#" name="Test User" brand="Test Brand"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --email) email="$2"; shift 2 ;;
      --password) password="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      --brand) brand="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  log "Seeding ${email} in ${BE_LABEL}..."
  # Values travel as positional arguments, not interpolated into the script.
  local lines output
  read_lines be exec_prefix
  if ! output="$("${lines[@]}" bash -c 'cd "$HOME/postolio" && pnpm --filter api seed:dev -- --email="$1" --password="$2" --name="$3" --brand="$4"' \
    seed "$email" "$password" "$name" "$brand" 2>&1)"; then
    printf '%s\n' "$output" | tail -15 >&2
    die "Seeding failed. Is the stack running? (${SCRIPT} status)"
  fi
  printf '%s\n' "$output" | grep -E '^Posts:' || true
  cat <<EOF

  Log in at ${WEB_URL}
  Email:    ${email}
  Password: ${password}

EOF
}

# --- Playwright MCP ------------------------------------------------------------

mcp_is_running() {
  in_env "test -f $REMOTE_MCP_PID && kill -0 \$(cat $REMOTE_MCP_PID) 2>/dev/null"
}

mcp_provision() {
  if in_env "test -f $REMOTE_MCP_DIR/.installed-$MCP_VERSION"; then
    return 0
  fi
  log "Installing Playwright MCP ${MCP_VERSION} and Chromium in ${BE_LABEL} (one-time)..."
  in_env '
    set -euo pipefail
    mkdir -p '"$REMOTE_MCP_DIR"' && cd '"$REMOTE_MCP_DIR"'
    [ -f package.json ] || npm init -y >/dev/null
    npm install --no-audit --no-fund --loglevel=error "@playwright/mcp@'"$MCP_VERSION"'" >/dev/null
  '
  # Chromium's system libraries need root; the browser itself goes in the user's cache.
  local dir
  dir="$(in_env "echo $REMOTE_MCP_DIR")"
  in_env_root "cd '$dir' && node_modules/.bin/playwright install-deps chromium >/dev/null 2>&1"
  in_env "cd $REMOTE_MCP_DIR && node_modules/.bin/playwright install chromium >/dev/null && rm -f .installed-* && touch .installed-$MCP_VERSION"
}

# True when the MCP endpoint answers an initialize request from the Mac.
mcp_responds() {
  curl -fsS -o /dev/null --max-time 5 -X POST "$MCP_URL" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"devenv.sh","version":"0"}}}' \
    2>/dev/null
}

mcp_start() {
  if mcp_is_running; then
    log "Playwright MCP is already running at ${MCP_URL}"
    return 0
  fi
  mcp_provision
  mkdir -p "$MCP_OUTPUT_DIR"
  log "Starting Playwright MCP on port ${MCP_PORT}..."
  local hosts="localhost:$MCP_PORT,127.0.0.1:$MCP_PORT"
  if [[ -n "$BE_EXTRA_HOSTS" ]]; then hosts+=",$BE_EXTRA_HOSTS:$MCP_PORT"; fi
  # Bind all interfaces so the port can be forwarded/published to the Mac;
  # --allowed-hosts keeps the Host-header check (DNS-rebinding protection).
  in_env "cd $REMOTE_MCP_DIR && setsid nohup bash -c 'echo \$\$ > $REMOTE_MCP_PID; exec node_modules/.bin/playwright-mcp \
      --headless --isolated --browser chromium \
      --host 0.0.0.0 --port $MCP_PORT \
      --allowed-hosts $hosts \
      --output-dir \"$MCP_OUTPUT_DIR\" --file-paths absolute' > $REMOTE_MCP_LOG 2>&1 < /dev/null &"
  local i
  for i in $(seq 1 30); do
    if mcp_responds; then
      log "Playwright MCP is up at ${MCP_URL}"
      return 0
    fi
    mcp_is_running || break
    sleep 1
  done
  warn "Playwright MCP did not start. Log:"
  in_env "tail -20 $REMOTE_MCP_LOG" >&2
  return 1
}

mcp_stop() {
  if mcp_is_running; then
    log "Stopping Playwright MCP..."
  fi
  kill_group "$REMOTE_MCP_PID"
}

mcp_config() {
  cat <<EOF
Playwright MCP (headless Chromium inside ${BE_LABEL}): ${MCP_URL}
The browser runs in the environment; point it at ${WEB_URL}.
Screenshots and snapshots are saved to ${MCP_OUTPUT_DIR}

Claude Code (this checkout only):
  claude mcp add --transport http --scope local ${MCP_NAME} ${MCP_URL}

Other MCP clients (.mcp.json / mcp.json):
  {
    "mcpServers": {
      "${MCP_NAME}": { "type": "http", "url": "${MCP_URL}" }
    }
  }
EOF
}

# --- Status, ports, watch -------------------------------------------------------

# For each forwarded port: is it reachable on the Mac's localhost, and who owns it?
cmd_ports() {
  local entry name port owner state
  printf '  %-16s %-6s %-7s %s\n' SERVICE PORT MAC OWNER
  for entry in "${BE_PORTS[@]}"; do
    name="${entry%%:*}"
    port="${entry##*:}"
    owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $1 }' | sort -u | paste -sd, -)"
    if nc -z -G 2 localhost "$port" >/dev/null 2>&1; then state="open"; else state="closed"; fi
    # OrbStack, Docker Desktop (com.docker.backend) or Colima/Lima own forwarded ports.
    if [[ -n "$owner" && ! "$owner" =~ (OrbStack|com\.docke|docker|limactl|ssh) ]]; then
      owner="${owner} (a Mac process holds this port; stop it to reach the environment)"
    fi
    printf '  %-16s %-6s %-7s %s\n' "$name" "$port" "$state" "${owner:--}"
  done
}

cmd_watch() {
  command -v node >/dev/null 2>&1 || die "Node.js is needed on the Mac for 'watch' (any recent version)."
  sync_code
  local dest prefix
  dest="$(in_env "echo $REMOTE_DIR")"
  # The watcher runs commands in the environment through this prefix (one arg per line).
  prefix="$(be exec_prefix)"
  log "Hot reload on: saved files are copied into ${BE_LABEL} as they change."
  DEVENV_EXEC="$prefix" DEVENV_LABEL="$BE_LABEL" ROOT_DIR="$ROOT_DIR" DEST="$dest" \
    exec node "$ROOT_DIR/scripts/devenv-watch.mjs"
}

print_urls() {
  cat <<EOF

  Web:        ${WEB_URL}
  API:        http://localhost:3000   (assets API: http://localhost:3002)
  Login:      dev@postolio.test / Test123!@#   (more accounts: ${SCRIPT} seed)
  MCP:        ${MCP_URL}   (client setup: ${SCRIPT} mcp config)
  Hot reload: ${SCRIPT} watch
  Logs:       ${SCRIPT} logs

EOF
}

cmd_status() {
  be ensure_engine
  local state
  state="$(be state)"
  if [[ -z "$state" ]]; then
    echo "${BE_LABEL}: not created (run: ${SCRIPT} --backend ${BACKEND} up)"
    return 0
  fi
  echo "${BE_LABEL}: ${state}"
  [[ "$state" == "running" ]] || return 0
  if is_running; then echo "Dev stack: running"; else echo "Dev stack: stopped"; fi
  for url in "${HEALTH_URLS[@]}"; do
    local code
    code="$(in_env "curl -s -o /dev/null --max-time 3 -w '%{http_code}' '$url'" 2>/dev/null || true)"
    printf '  %-32s %s\n' "$url" "${code:-000}"
  done
  in_env "cd $REMOTE_DIR 2>/dev/null && sg docker -c 'docker compose -p \${COMPOSE_PROJECT_NAME:-postolio} ps --format \"  {{.Service}}: {{.Status}}\"'" 2>/dev/null || true
  if mcp_is_running; then echo "Playwright MCP: running (${MCP_URL})"; else echo "Playwright MCP: stopped"; fi
  echo "Ports on the Mac:"
  cmd_ports
}

main() {
  # Pull out --backend wherever it appears.
  local requested_backend="" args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --backend) requested_backend="${2:-}"; shift 2 ;;
      --backend=*) requested_backend="${1#--backend=}"; shift ;;
      *) args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]+"${args[@]}"}"

  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    help | -h | --help) usage; return 0 ;;
  esac

  select_backend "$requested_backend"

  local reset=0 with_mcp=1 with_watch=0
  for arg in "$@"; do
    case "$arg" in
      --reset) reset=1 ;;
      --no-mcp) with_mcp=0 ;;
      --watch) with_watch=1 ;;
    esac
  done

  case "$cmd" in
    up)
      ensure_env_running
      provision
      sync_code
      ensure_dotenv
      install_deps
      start_stack "$reset"
      if [[ "$with_mcp" == "1" ]]; then mcp_start; fi
      if [[ "$with_watch" == "1" ]]; then cmd_watch; fi
      ;;
    watch) require_env; cmd_watch ;;
    sync) require_env; sync_code ;;
    start) require_env; start_stack "$reset" ;;
    stop) require_env; stop_stack ;;
    restart)
      require_env
      stop_stack
      sync_code
      install_deps
      start_stack "$reset"
      if [[ "$with_mcp" == "1" ]]; then mcp_start; fi
      ;;
    seed) require_env; cmd_seed "$@" ;;
    status) cmd_status ;;
    ports) cmd_ports ;;
    mcp)
      local sub="${1:-status}"
      case "$sub" in
        start) require_env; mcp_start ;;
        stop) require_env; mcp_stop ;;
        status)
          require_env
          if mcp_is_running && mcp_responds; then
            echo "Playwright MCP: running at ${MCP_URL}"
          elif mcp_is_running; then
            echo "Playwright MCP: running, but ${MCP_URL} doesn't answer from the Mac (see: ${SCRIPT} ports)"
          else
            echo "Playwright MCP: stopped (start it: ${SCRIPT} mcp start)"
          fi
          ;;
        config) mcp_config ;;
        *) die "Unknown mcp command: $sub (use start, stop, status or config)" ;;
      esac
      ;;
    logs)
      require_env
      local lines=100
      if [[ "${1:-}" == "-n" && -n "${2:-}" ]]; then lines="$2"; fi
      be exec_tty "tail -n $lines -f $REMOTE_LOG"
      ;;
    shell)
      require_env
      be exec_tty "cd $REMOTE_DIR && exec bash -l"
      ;;
    open) open "$WEB_URL" ;;
    destroy)
      be ensure_engine
      [[ -n "$(be state)" ]] || { echo "${BE_LABEL} does not exist."; return 0; }
      read -r -p "Delete ${BE_LABEL} and all its data? [y/N] " answer
      [[ "$answer" =~ ^[Yy]$ ]] || { echo "Aborted."; return 1; }
      be destroy
      log "Deleted ${BE_LABEL}."
      ;;
    *)
      usage >&2
      die "Unknown command: $cmd"
      ;;
  esac
}

main "$@"
