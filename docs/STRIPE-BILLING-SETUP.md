# Stripe Billing Setup

This guide covers:

- How to create Stripe resources for Postolio billing.
- Where to find each key/ID in Stripe.
- Which environment variables are required and what each one is used for.

## 1. Create a Stripe account and project

1. Sign up at `https://dashboard.stripe.com/register`.
2. Switch to `Test mode` in the Stripe Dashboard while configuring locally.
3. Use one Stripe account per environment strategy (commonly:
   - one test project/account for local + staging
   - one live project/account for production)

## 2. Create products and prices

Create these in Stripe Dashboard:

- `Product catalog` -> `Add product`

Create recurring prices for Pro:

1. `Pro Monthly`
   - Pricing model: `Recurring`
   - Interval: `Monthly`
   - Copy resulting `price_...` ID
2. `Pro Annual`
   - Pricing model: `Recurring`
   - Interval: `Yearly`
   - Copy resulting `price_...` ID

Create one-time prices for AI credit top-ups:

1. `Credits Starter` (500 credits equivalent)
2. `Credits Standard` (2000 credits equivalent)
3. `Credits Bulk` (5000 credits equivalent)

For each, copy the resulting `price_...` ID.

### Optional automation (recommended)

You can provision/reuse all required products, prices, portal config, and webhook endpoint with:

```bash
chmod +x scripts/setup-stripe-billing.sh
scripts/setup-stripe-billing.sh --webhook-url "http://localhost:3000/api/webhooks/stripe" --write-env
```

Notes:

- Requires `STRIPE_SECRET_KEY` in shell env or root `.env`.
- `--write-env` writes discovered `price_...` values (and newly created webhook secret) into `.env`.
- If a webhook endpoint already exists for the same URL, Stripe will not return its secret again (Stripe limitation).

## 3. Get Stripe API keys

In Stripe Dashboard:

- `Developers` -> `API keys`

Collect:

- `Publishable key` (`pk_test_...` or `pk_live_...`)
- `Secret key` (`sk_test_...` or `sk_live_...`)

## 4. Configure webhook endpoint

In Stripe Dashboard:

- `Developers` -> `Webhooks` -> `Add endpoint`

Endpoint URL:

- Local: `http://localhost:3000/api/webhooks/stripe`
- Prod: `https://<your-api-domain>/api/webhooks/stripe`

Subscribe to these events (currently handled by API):

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.trial_will_end`
- `payment_method.attached`
- `payment_method.detached`

After creating endpoint:

- Open endpoint details
- Reveal and copy `Signing secret` (`whsec_...`)

## 5. Environment variables (what each is for)

Add these to root `.env` (or your deployed secret manager).

### Required for core billing

| Variable                        | Required             | Used by | Purpose                                                                                                                   |
| ------------------------------- | -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`             | Yes                  | API     | Enables Stripe client in backend. Without this, billing endpoints return `Billing is not configured on this environment.` |
| `VITE_STRIPE_PRICE_PRO_MONTHLY` | Yes (for pricing UI) | Web     | Price ID used when user selects Monthly on `/pricing`.                                                                    |
| `VITE_STRIPE_PRICE_PRO_ANNUAL`  | Yes (for pricing UI) | Web     | Price ID used when user selects Annual on `/pricing`.                                                                     |

### Required for webhook processing

| Variable                | Required           | Used by | Purpose                                      |
| ----------------------- | ------------------ | ------- | -------------------------------------------- |
| `STRIPE_WEBHOOK_SECRET` | Yes (for webhooks) | API     | Verifies incoming Stripe webhook signatures. |

### Required for AI credit purchases

| Variable                        | Required                   | Used by | Purpose                              |
| ------------------------------- | -------------------------- | ------- | ------------------------------------ |
| `STRIPE_PRICE_CREDITS_STARTER`  | Yes (for credits checkout) | API     | Price ID for `starter` credit pack.  |
| `STRIPE_PRICE_CREDITS_STANDARD` | Yes (for credits checkout) | API     | Price ID for `standard` credit pack. |
| `STRIPE_PRICE_CREDITS_BULK`     | Yes (for credits checkout) | API     | Price ID for `bulk` credit pack.     |

### Recommended support vars

| Variable                      | Required       | Used by | Purpose                                                             |
| ----------------------------- | -------------- | ------- | ------------------------------------------------------------------- |
| `APP_URL`                     | Recommended    | API     | Default success/cancel/portal return URL base.                      |
| `FRONTEND_URL`                | Recommended    | API     | Fallback frontend URL when `APP_URL` is unset.                      |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Optional today | Web     | Future-proof client-side Stripe.js usage. Keep set for consistency. |

## 6. Example `.env` block

```bash
# Stripe keys
STRIPE_SECRET_KEY="sk_test_xxx"
STRIPE_WEBHOOK_SECRET="whsec_xxx"
VITE_STRIPE_PUBLISHABLE_KEY="pk_test_xxx"

# Pro subscription prices
VITE_STRIPE_PRICE_PRO_MONTHLY="price_xxx_monthly"
VITE_STRIPE_PRICE_PRO_ANNUAL="price_xxx_annual"

# Credit pack prices
STRIPE_PRICE_CREDITS_STARTER="price_xxx_starter"
STRIPE_PRICE_CREDITS_STANDARD="price_xxx_standard"
STRIPE_PRICE_CREDITS_BULK="price_xxx_bulk"

# App URL fallbacks used by API return URLs
APP_URL="http://localhost:5173"
FRONTEND_URL="http://localhost:5173"
```

## 7. Local validation checklist

1. Restart stack after env changes: `pnpm run dev:stack`
2. Open `http://localhost:5173/pricing`
3. Click `Upgrade to Pro` and verify Stripe Checkout opens
4. Open `http://localhost:5173/settings/billing`
5. Use `Open customer portal` and verify Stripe portal opens
6. Complete a test payment and confirm webhook-driven updates appear in billing UI

## 8. Common error

`Billing is not configured on this environment.`

Root cause:

- `STRIPE_SECRET_KEY` is missing/empty in API runtime env.

Fix:

1. Set `STRIPE_SECRET_KEY` in root `.env` (or deployed secret config).
2. Restart API/stack.
