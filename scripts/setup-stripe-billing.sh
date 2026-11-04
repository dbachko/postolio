#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
WEBHOOK_URL="http://localhost:3000/api/webhooks/stripe"
WRITE_ENV=0

usage() {
  cat <<'EOF'
Usage: scripts/setup-stripe-billing.sh [options]

Idempotently creates/reuses Stripe products, prices, portal configuration,
and webhook endpoint for Postolio billing.

Options:
  --env-file <path>     Env file to source when STRIPE_SECRET_KEY is unset (default: .env)
  --webhook-url <url>   Webhook endpoint URL to configure
                        (default: http://localhost:3000/api/webhooks/stripe)
  --write-env           Write discovered IDs into env file
  -h, --help            Show help

Required:
  STRIPE_SECRET_KEY must be available in shell env or env file.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --webhook-url)
      WEBHOOK_URL="${2:-}"
      shift 2
      ;;
    --write-env)
      WRITE_ENV=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${STRIPE_SECRET_KEY:-}" && -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  echo "Missing STRIPE_SECRET_KEY. Set it in shell env or $ENV_FILE." >&2
  exit 1
fi

if [[ "$STRIPE_SECRET_KEY" != sk_* ]]; then
  echo "STRIPE_SECRET_KEY does not look like a Stripe secret key (expected sk_...)." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for JSON parsing in this script." >&2
  exit 1
fi

stripe_api() {
  curl -sS -u "${STRIPE_SECRET_KEY}:" "$@" # gitleaks:allow -- environment reference, not a literal credential
}

json_first_id_by_name() {
  local target_name="$1"
  python3 - "$target_name" <<'PY'
import json
import sys

target = sys.argv[1]
payload = json.load(sys.stdin)
for item in payload.get("data", []):
    if item.get("name") == target:
        print(item.get("id", ""))
        break
PY
}

json_first_id_by_lookup_key() {
  python3 - <<'PY'
import json
import sys

payload = json.load(sys.stdin)
data = payload.get("data", [])
if data:
    print(data[0].get("id", ""))
PY
}

json_webhook_match() {
  local target_url="$1"
  python3 - "$target_url" <<'PY'
import json
import sys

target_url = sys.argv[1]
payload = json.load(sys.stdin)
for item in payload.get("data", []):
    if item.get("url") == target_url:
        print(item.get("id", ""))
        break
PY
}

json_field() {
  local key="$1"
  python3 - "$key" <<'PY'
import json
import sys

key = sys.argv[1]
payload = json.load(sys.stdin)
value = payload.get(key, "")
if value is None:
    value = ""
print(value)
PY
}

upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  python3 - "$file" "$key" "$value" <<'PY'
import pathlib
import re
import sys

file_path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]

if file_path.exists():
    content = file_path.read_text()
else:
    content = ""

line = f'{key}="{value}"'
pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)

if pattern.search(content):
    content = pattern.sub(line, content)
else:
    if content and not content.endswith("\n"):
        content += "\n"
    content += line + "\n"

file_path.write_text(content)
PY
}

find_or_create_product() {
  local product_name="$1"
  local product_key="$2"
  local product_id

  product_id="$(
    stripe_api "https://api.stripe.com/v1/products?limit=100" \
      | json_first_id_by_name "$product_name"
  )"

  if [[ -n "$product_id" ]]; then
    echo "$product_id"
    return 0
  fi

  product_id="$(
    stripe_api "https://api.stripe.com/v1/products" \
      -d "name=$product_name" \
      -d "metadata[postolio_product_key]=$product_key" \
      -d "metadata[managed_by]=scripts/setup-stripe-billing.sh" \
      | json_field id
  )"

  echo "$product_id"
}

find_or_create_price() {
  local lookup_key="$1"
  local product_id="$2"
  local unit_amount="$3"
  local interval="${4:-}"
  local price_id

  price_id="$(
    stripe_api "https://api.stripe.com/v1/prices?limit=1&active=true&lookup_keys[]=$lookup_key" \
      | json_first_id_by_lookup_key
  )"

  if [[ -n "$price_id" ]]; then
    echo "$price_id"
    return 0
  fi

  if [[ -n "$interval" ]]; then
    price_id="$(
      stripe_api "https://api.stripe.com/v1/prices" \
        -d "currency=usd" \
        -d "unit_amount=$unit_amount" \
        -d "product=$product_id" \
        -d "lookup_key=$lookup_key" \
        -d "recurring[interval]=$interval" \
        -d "metadata[managed_by]=scripts/setup-stripe-billing.sh" \
        | json_field id
    )"
  else
    price_id="$(
      stripe_api "https://api.stripe.com/v1/prices" \
        -d "currency=usd" \
        -d "unit_amount=$unit_amount" \
        -d "product=$product_id" \
        -d "lookup_key=$lookup_key" \
        -d "metadata[managed_by]=scripts/setup-stripe-billing.sh" \
        | json_field id
    )"
  fi

  echo "$price_id"
}

find_or_create_webhook() {
  local target_url="$1"
  local existing_id
  existing_id="$(
    stripe_api "https://api.stripe.com/v1/webhook_endpoints?limit=100" \
      | json_webhook_match "$target_url"
  )"

  if [[ -n "$existing_id" ]]; then
    echo "$existing_id|"
    return 0
  fi

  local created_payload webhook_id webhook_secret
  created_payload="$(
    stripe_api "https://api.stripe.com/v1/webhook_endpoints" \
      -d "url=$target_url" \
      -d "enabled_events[]=checkout.session.completed" \
      -d "enabled_events[]=customer.subscription.created" \
      -d "enabled_events[]=customer.subscription.updated" \
      -d "enabled_events[]=customer.subscription.deleted" \
      -d "enabled_events[]=invoice.paid" \
      -d "enabled_events[]=invoice.payment_failed" \
      -d "enabled_events[]=customer.subscription.trial_will_end" \
      -d "enabled_events[]=payment_method.attached" \
      -d "enabled_events[]=payment_method.detached"
  )"

  webhook_id="$(printf '%s' "$created_payload" | json_field id)"
  webhook_secret="$(printf '%s' "$created_payload" | json_field secret)"
  echo "${webhook_id}|${webhook_secret}"
}

ensure_portal_configuration() {
  local existing_id
  existing_id="$(
    stripe_api "https://api.stripe.com/v1/billing_portal/configurations?limit=100" \
      | python3 - <<'PY'
import json
import sys

payload = json.load(sys.stdin)
for item in payload.get("data", []):
    md = item.get("metadata", {}) or {}
    if md.get("postolio_portal_config") == "default":
        print(item.get("id", ""))
        break
PY
  )"

  if [[ -n "$existing_id" ]]; then
    echo "$existing_id"
    return 0
  fi

  stripe_api "https://api.stripe.com/v1/billing_portal/configurations" \
    -d "business_profile[headline]=Manage your Postolio subscription" \
    -d "features[invoice_history][enabled]=true" \
    -d "features[payment_method_update][enabled]=true" \
    -d "features[subscription_cancel][enabled]=true" \
    -d "features[subscription_cancel][mode]=at_period_end" \
    -d "features[subscription_update][enabled]=false" \
    -d "features[customer_update][enabled]=true" \
    -d "features[customer_update][allowed_updates][]=email" \
    -d "metadata[postolio_portal_config]=default" \
    -d "metadata[managed_by]=scripts/setup-stripe-billing.sh" \
    >/dev/null

  stripe_api "https://api.stripe.com/v1/billing_portal/configurations?limit=100" \
    | python3 - <<'PY'
import json
import sys

payload = json.load(sys.stdin)
for item in payload.get("data", []):
    md = item.get("metadata", {}) or {}
    if md.get("postolio_portal_config") == "default":
        print(item.get("id", ""))
        break
PY
}

echo "Creating/reusing Stripe products..."
PRODUCT_PRO="$(find_or_create_product "Postolio Pro" "postolio_pro")"
PRODUCT_CREDITS_STARTER="$(find_or_create_product "AI Credit Pack - Starter" "credits_starter")"
PRODUCT_CREDITS_STANDARD="$(find_or_create_product "AI Credit Pack - Standard" "credits_standard")"
PRODUCT_CREDITS_BULK="$(find_or_create_product "AI Credit Pack - Bulk" "credits_bulk")"

echo "Creating/reusing Stripe prices..."
PRICE_PRO_MONTHLY="$(find_or_create_price "postolio_pro_monthly" "$PRODUCT_PRO" "2900" "month")"
PRICE_PRO_ANNUAL="$(find_or_create_price "postolio_pro_annual" "$PRODUCT_PRO" "29000" "year")"
PRICE_CREDITS_STARTER="$(find_or_create_price "postolio_credits_starter" "$PRODUCT_CREDITS_STARTER" "500")"
PRICE_CREDITS_STANDARD="$(find_or_create_price "postolio_credits_standard" "$PRODUCT_CREDITS_STANDARD" "2000")"
PRICE_CREDITS_BULK="$(find_or_create_price "postolio_credits_bulk" "$PRODUCT_CREDITS_BULK" "5000")"

echo "Ensuring customer portal configuration..."
PORTAL_CONFIG_ID="$(ensure_portal_configuration)"

echo "Creating/reusing webhook endpoint..."
WEBHOOK_RESULT="$(find_or_create_webhook "$WEBHOOK_URL")"
WEBHOOK_ID="${WEBHOOK_RESULT%%|*}"
WEBHOOK_SECRET="${WEBHOOK_RESULT#*|}"

echo
echo "Stripe billing setup complete."
echo "Products:"
echo "  Postolio Pro:            $PRODUCT_PRO"
echo "  Credits Starter:         $PRODUCT_CREDITS_STARTER"
echo "  Credits Standard:        $PRODUCT_CREDITS_STANDARD"
echo "  Credits Bulk:            $PRODUCT_CREDITS_BULK"
echo "Prices:"
echo "  Pro Monthly:             $PRICE_PRO_MONTHLY"
echo "  Pro Annual:              $PRICE_PRO_ANNUAL"
echo "  Credits Starter:         $PRICE_CREDITS_STARTER"
echo "  Credits Standard:        $PRICE_CREDITS_STANDARD"
echo "  Credits Bulk:            $PRICE_CREDITS_BULK"
echo "Portal configuration:"
echo "  $PORTAL_CONFIG_ID"
echo "Webhook endpoint:"
echo "  $WEBHOOK_ID ($WEBHOOK_URL)"
if [[ -n "$WEBHOOK_SECRET" ]]; then
  echo "Webhook signing secret:"
  echo "  $WEBHOOK_SECRET"
else
  echo "Webhook signing secret:"
  echo "  (existing endpoint reused; secret is not re-readable via API)"
fi

echo
echo "Env vars to set:"
echo "  VITE_STRIPE_PRICE_PRO_MONTHLY=\"$PRICE_PRO_MONTHLY\""
echo "  VITE_STRIPE_PRICE_PRO_ANNUAL=\"$PRICE_PRO_ANNUAL\""
echo "  STRIPE_PRICE_CREDITS_STARTER=\"$PRICE_CREDITS_STARTER\""
echo "  STRIPE_PRICE_CREDITS_STANDARD=\"$PRICE_CREDITS_STANDARD\""
echo "  STRIPE_PRICE_CREDITS_BULK=\"$PRICE_CREDITS_BULK\""
if [[ -n "$WEBHOOK_SECRET" ]]; then
  echo "  STRIPE_WEBHOOK_SECRET=\"$WEBHOOK_SECRET\""
fi

if [[ "$WRITE_ENV" -eq 1 ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    touch "$ENV_FILE"
  fi
  upsert_env_var "$ENV_FILE" "VITE_STRIPE_PRICE_PRO_MONTHLY" "$PRICE_PRO_MONTHLY"
  upsert_env_var "$ENV_FILE" "VITE_STRIPE_PRICE_PRO_ANNUAL" "$PRICE_PRO_ANNUAL"
  upsert_env_var "$ENV_FILE" "STRIPE_PRICE_CREDITS_STARTER" "$PRICE_CREDITS_STARTER"
  upsert_env_var "$ENV_FILE" "STRIPE_PRICE_CREDITS_STANDARD" "$PRICE_CREDITS_STANDARD"
  upsert_env_var "$ENV_FILE" "STRIPE_PRICE_CREDITS_BULK" "$PRICE_CREDITS_BULK"
  if [[ -n "$WEBHOOK_SECRET" ]]; then
    upsert_env_var "$ENV_FILE" "STRIPE_WEBHOOK_SECRET" "$WEBHOOK_SECRET"
  fi
  echo
  echo "Updated $ENV_FILE with pricing vars."
fi
