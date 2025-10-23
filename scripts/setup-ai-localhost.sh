#!/usr/bin/env bash
set -euo pipefail

# Bootstrap local HTTPS for ai.localhost on macOS using mkcert
# - Generates and trusts a local CA (once)
# - Creates repo-local certs in ./certs for ai.localhost, localhost, 127.0.0.1, ::1
# - Wires API and Vite to use these certs via .env files and sane defaults

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CERT_DIR="$REPO_ROOT/certs"
CERT_FILE="$CERT_DIR/ai.localhost.pem"
KEY_FILE="$CERT_DIR/ai.localhost-key.pem"

echo "==> Setting up local HTTPS certificates for ai.localhost"

# macOS check (mkcert supports other OSes, but we validate as requested)
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[!] This helper is tailored for macOS. You can still use mkcert on Linux/Windows."
  echo "    Docs: https://github.com/FiloSottile/mkcert"
fi

# Check mkcert
if ! command -v mkcert >/dev/null 2>&1; then
  echo "[!] mkcert is not installed."
  echo "    Install with Homebrew: brew install mkcert"
  echo "    Optional (Firefox trust store): brew install nss"
  exit 1
fi

# Ensure certs folder exists
mkdir -p "$CERT_DIR"

echo "==> Installing local CA (if not already installed)"
mkcert -install

echo "==> Generating certificate for: ai.localhost, localhost, 127.0.0.1, ::1"
# Overwrite if present to ensure freshness
rm -f "$CERT_FILE" "$KEY_FILE"
mkcert \
  -cert-file "$CERT_FILE" \
  -key-file "$KEY_FILE" \
  ai.localhost localhost 127.0.0.1 ::1

echo "==> Writing API env to use repo-local certs"
API_ENV_FILE="$REPO_ROOT/packages/apps/api/.env"
touch "$API_ENV_FILE"
grep -q '^SSL_CERT_PATH=' "$API_ENV_FILE" 2>/dev/null && sed -i '' "s#^SSL_CERT_PATH=.*#SSL_CERT_PATH=../../../certs/ai.localhost.pem#" "$API_ENV_FILE" || echo "SSL_CERT_PATH=../../../certs/ai.localhost.pem" >> "$API_ENV_FILE"
grep -q '^SSL_KEY_PATH=' "$API_ENV_FILE" 2>/dev/null && sed -i '' "s#^SSL_KEY_PATH=.*#SSL_KEY_PATH=../../../certs/ai.localhost-key.pem#" "$API_ENV_FILE" || echo "SSL_KEY_PATH=../../../certs/ai.localhost-key.pem" >> "$API_ENV_FILE"
grep -q '^NODE_ENV=' "$API_ENV_FILE" 2>/dev/null || echo "NODE_ENV=dev" >> "$API_ENV_FILE"

echo "==> Writing Web env (optional; Vite also uses sane defaults)"
WEB_ENV_FILE="$REPO_ROOT/packages/apps/web/.env"
touch "$WEB_ENV_FILE"
grep -q '^SSL_CERT_PATH=' "$WEB_ENV_FILE" 2>/dev/null && sed -i '' "s#^SSL_CERT_PATH=.*#SSL_CERT_PATH=../../../certs/ai.localhost.pem#" "$WEB_ENV_FILE" || echo "SSL_CERT_PATH=../../../certs/ai.localhost.pem" >> "$WEB_ENV_FILE"
grep -q '^SSL_KEY_PATH=' "$WEB_ENV_FILE" 2>/dev/null && sed -i '' "s#^SSL_KEY_PATH=.*#SSL_KEY_PATH=../../../certs/ai.localhost-key.pem#" "$WEB_ENV_FILE" || echo "SSL_KEY_PATH=../../../certs/ai.localhost-key.pem" >> "$WEB_ENV_FILE"

cat <<EOF

✅ Local HTTPS is ready.

Next steps:
1) Start the backend API (HTTPS on 3000):
   pnpm --filter api dev

2) Start the web app (HTTPS on https://ai.localhost:5173):
   pnpm --filter @postolio/web dev

Open https://ai.localhost:5173 in your browser.

Notes:
- Certificates are stored in: $CERT_DIR
- API reads SSL_CERT_PATH/SSL_KEY_PATH from packages/apps/api/.env
- Vite reads SSL_CERT_PATH/SSL_KEY_PATH from packages/apps/web/.env or defaults to ../../certs paths
- No /etc/hosts changes are required: .localhost domains resolve to 127.0.0.1
EOF
