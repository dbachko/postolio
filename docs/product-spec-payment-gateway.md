# Product Spec: Payment Gateway & Subscription Billing

**Feature**: Stripe-based subscription billing, one-time payments, and AI credit top-ups
**Status**: Planning
**Created**: 2026-02-12
**Owner**: Platform & Engineering
**Research**: See payment gateway research in conversation history

---

## 1. Overview

### Problem Statement

Postolio has a working subscription tier system (`free`, `pro`, `enterprise`) with feature limits enforced across routes, an AI credits wallet with ledger tracking, and a Limits page referencing "Coming Soon: Paid Plans" — but there is no way to collect payment. Users cannot upgrade, purchase credits, or manage billing. Revenue is zero.

### Goals

- Enable users to subscribe to Pro and Enterprise plans with recurring monthly/annual billing.
- Allow one-time AI credit top-up purchases for brands that exhaust their allocation.
- Provide a self-service billing management experience (upgrade, downgrade, cancel, update payment method, view invoices).
- Maintain PCI DSS SAQ A compliance by never handling raw card data.
- Wire Stripe subscription status to the existing `User.subscriptionTier` field so all existing tier-based limits activate automatically.
- Support Apple Pay, Google Pay, and standard card payments from day one.

### Out of Scope (Phase 1)

- Enterprise custom pricing / sales-led contracts (Phase 3+).
- Marketplace / Connect payouts to third parties.
- Multi-currency local pricing (Phase 2+; USD-only for launch).
- Tax calculation and remittance (evaluate Stripe Tax in Phase 2).
- Usage-based metered billing (beyond credit top-ups).
- Paddle / alternative provider integrations.

---

## 2. Competitor Audit (Summary)

- **Buffer**: Free tier + 3 paid tiers ($6–$120/mo). Card via Stripe Checkout. Annual discount. Self-service portal.
- **Hootsuite**: Free trial + paid tiers ($99–$739/mo). Enterprise via sales. Card + invoice.
- **Later**: Free + 3 paid tiers ($25–$80/mo). Annual saves 17%. Stripe-powered billing.
- **Sprout Social**: No free tier ($199–$399/mo). Enterprise custom. Card + invoice. Net-30 terms for enterprise.
- **Publer**: Free + 3 tiers ($12–$84/mo). AI credits sold as add-ons. Stripe checkout.

Key patterns we adopt:

- Free tier with meaningful but limited functionality to drive organic adoption.
- Monthly + annual billing with ~17–20% annual discount.
- Self-service upgrade/downgrade with proration.
- AI credits sold as add-on packs (not just bundled in tiers).
- Stripe Checkout or Payment Element for the payment form.
- Customer Portal for self-service payment method and invoice management.

---

## 3. User Stories

1. As a free-tier user, I want to upgrade to Pro so I can schedule more posts and access premium recipe features.

2. As a Pro user, I want to switch to annual billing so I can save money.

3. As a brand owner, I want to buy additional AI credits when my allocation runs out so I can continue generating content without waiting for the next billing cycle.

4. As a paying user, I want to update my credit card so my subscription doesn't lapse when my card expires.

5. As a user who no longer needs Pro, I want to cancel my subscription and keep access until the end of my billing period so I don't lose work.

6. As an account admin, I want to view past invoices and download receipts for my records.

7. As a finance owner, I want to be notified when a payment fails so I can update my payment method before service is disrupted.

---

## 4. Requirements

### Functional Requirements (FR)

- FR-1 Plan Selection & Checkout
  - Pricing page displays Free, Pro ($29/mo or $290/yr), and Enterprise (contact sales).
  - "Upgrade" opens Stripe Payment Element (embedded, no redirect) or Stripe Checkout Session.
  - Supports card, Apple Pay, Google Pay, and Link (Stripe accelerated checkout).
  - 3D Secure / SCA handled automatically by Stripe Payment Element.

- FR-2 Subscription Lifecycle
  - Create subscription on successful payment; update `User.subscriptionTier` to `pro`.
  - Upgrade (free→pro): immediate access, charged now.
  - Downgrade (pro→free): `cancel_at_period_end = true`; access continues until period ends.
  - Annual ↔ Monthly switch: proration applied automatically.
  - Cancel: soft cancel at period end; reactivation possible before period expires.
  - Past due: 3 retry attempts over 7 days (Stripe Smart Retries); if all fail, downgrade to free.

- FR-3 AI Credit Top-Up
  - One-time purchase: 500 credits ($5), 2000 credits ($20), 5000 credits ($50).
  - Uses Stripe Checkout Session (mode: `payment`) or PaymentIntent.
  - On success (webhook `checkout.session.completed`), call `topUpAiCredits()` to credit the brand wallet.
  - Purchase history visible on billing page.

- FR-4 Payment Method Management
  - Add/remove payment methods via Stripe SetupIntents.
  - Set default payment method for subscription.
  - Display card brand, last 4 digits, expiry.

- FR-5 Invoice & Receipt History
  - List all invoices from Stripe (synced via webhooks).
  - Download invoice PDF (Stripe-hosted URL).
  - Email receipts on successful payment (Stripe auto-receipts enabled).

- FR-6 Billing Notifications
  - `billing.payment_failed`: email + in-app notification with "Update payment method" CTA.
  - `billing.subscription_canceled`: email confirmation.
  - `billing.invoice_paid`: in-app notification (email receipt via Stripe).
  - `billing.trial_ending`: email 3 days before trial ends (if trials are enabled).
  - Integrate with existing `NotificationsService.emit()` via billing category.

- FR-7 Stripe Customer Portal (Fallback)
  - Provide "Manage Billing" button that opens Stripe's hosted Customer Portal.
  - Serves as a fallback for payment method updates, invoice downloads, and cancellation.
  - Reduces custom UI surface area needed for launch.

### Non-Functional Requirements (NFR)

- NFR-1 Security: PCI SAQ A via Stripe Elements/Checkout; card data never touches our servers. Webhook signature verification on every request. Idempotency keys on all payment-mutating API calls.
- NFR-2 Reliability: At-least-once webhook processing with deduplication via `stripeEventId`. Exponential backoff on transient Stripe API errors. Payment state always verified server-side (never trust client).
- NFR-3 Performance: Checkout page loads in < 2s. Webhook processing completes in < 5s p95.
- NFR-4 Observability: Structured logs for all payment events. Metrics: MRR, churn rate, failed payment rate, webhook processing latency. Alerts on payment failure rate > 5%.
- NFR-5 Compliance: Stripe is PCI Level 1 Service Provider. We store only token references, card brand, last 4, and expiry — never full PAN or CVV. GDPR: payment data exported/deleted with user account.

---

## 5. Pricing Model

### Subscription Tiers

| Feature                 | Free     | Pro ($29/mo · $290/yr) | Enterprise (Contact Sales) |
| ----------------------- | -------- | ---------------------- | -------------------------- |
| Schedule-ahead capacity | 10 posts | 100 posts              | Unlimited                  |
| Publishing queue depth  | 10 items | 5,000 items            | Unlimited                  |
| AI credits (monthly)    | 1,000    | 5,000                  | Custom                     |
| Brands                  | 1        | 5                      | Unlimited                  |
| DM automation rules     | 1        | 20                     | Unlimited                  |
| Recipe runs / month     | 10       | 100                    | Unlimited                  |
| Social accounts         | 3        | 15                     | Unlimited                  |
| Priority support        | —        | Email                  | Dedicated                  |
| SSO / SAML              | —        | —                      | Yes                        |

### AI Credit Packs (One-Time)

| Pack     | Credits | Price | $/credit |
| -------- | ------- | ----- | -------- |
| Starter  | 500     | $5    | $0.010   |
| Standard | 2,000   | $20   | $0.010   |
| Bulk     | 5,000   | $50   | $0.010   |

Credits never expire. Credit packs available to all tiers.

---

## 6. Data Model (Prisma additions)

Add to `packages/libs/database/prisma/schema.prisma`:

```prisma
// ===========================
// Payment & Billing Models
// ===========================

model BillingCustomer {
  id                  String   @id @default(cuid())
  userId              String   @unique
  stripeCustomerId    String   @unique
  email               String
  currency            String   @default("usd")
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  subscriptions       BillingSubscription[]
  paymentMethods      BillingPaymentMethod[]
  invoices            BillingInvoice[]
  payments            BillingPayment[]

  @@index([stripeCustomerId])
  @@map("billing_customers")
}

model BillingProduct {
  id                String   @id @default(cuid())
  stripeProductId   String   @unique
  name              String
  description       String?
  active            Boolean  @default(true)
  metadata          Json     @default("{}")
  prices            BillingPrice[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@map("billing_products")
}

model BillingPrice {
  id              String   @id @default(cuid())
  productId       String
  stripePriceId   String   @unique
  currency        String   @default("usd")
  unitAmount      Int                       // in cents
  interval        String?                   // 'month' | 'year' | null (one-time)
  intervalCount   Int      @default(1)
  trialDays       Int?
  active          Boolean  @default(true)
  metadata        Json     @default("{}")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  product         BillingProduct @relation(fields: [productId], references: [id])
  subscriptions   BillingSubscription[]

  @@index([stripePriceId])
  @@map("billing_prices")
}

model BillingSubscription {
  id                        String    @id @default(cuid())
  customerId                String
  priceId                   String
  stripeSubscriptionId      String    @unique
  status                    String                  // trialing, active, past_due, canceled, unpaid, paused, incomplete
  currentPeriodStart        DateTime
  currentPeriodEnd          DateTime
  cancelAtPeriodEnd         Boolean   @default(false)
  canceledAt                DateTime?
  trialStart                DateTime?
  trialEnd                  DateTime?
  quantity                  Int       @default(1)
  metadata                  Json      @default("{}")
  createdAt                 DateTime  @default(now())
  updatedAt                 DateTime  @updatedAt

  customer                  BillingCustomer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  price                     BillingPrice @relation(fields: [priceId], references: [id])
  invoices                  BillingInvoice[]

  @@index([customerId])
  @@index([stripeSubscriptionId])
  @@index([status])
  @@map("billing_subscriptions")
}

model BillingPaymentMethod {
  id                          String   @id @default(cuid())
  customerId                  String
  stripePaymentMethodId       String   @unique
  type                        String                  // 'card' | 'link' | 'us_bank_account'
  cardBrand                   String?                 // 'visa' | 'mastercard' | 'amex'
  cardLastFour                String?
  cardExpMonth                Int?
  cardExpYear                 Int?
  isDefault                   Boolean  @default(false)
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt

  customer                    BillingCustomer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([customerId])
  @@map("billing_payment_methods")
}

model BillingInvoice {
  id                    String    @id @default(cuid())
  customerId            String
  subscriptionId        String?
  stripeInvoiceId       String    @unique
  number                String?                   // human-readable invoice number
  status                String                    // draft, open, paid, void, uncollectible
  currency              String
  total                 Int                       // cents
  amountPaid            Int       @default(0)
  amountDue             Int
  paidAt                DateTime?
  invoicePdfUrl         String?
  hostedInvoiceUrl      String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  customer              BillingCustomer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  subscription          BillingSubscription? @relation(fields: [subscriptionId], references: [id])

  @@index([customerId])
  @@index([stripeInvoiceId])
  @@index([status])
  @@map("billing_invoices")
}

model BillingPayment {
  id                        String    @id @default(cuid())
  customerId                String
  stripePaymentIntentId     String    @unique
  stripeChargeId            String?   @unique
  idempotencyKey            String?   @unique
  amount                    Int                     // cents
  currency                  String
  status                    String                  // pending, processing, succeeded, failed, canceled, refunded
  failureCode               String?
  failureMessage            String?
  metadata                  Json      @default("{}")
  createdAt                 DateTime  @default(now())
  updatedAt                 DateTime  @updatedAt

  customer                  BillingCustomer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([customerId])
  @@index([status])
  @@map("billing_payments")
}

model BillingWebhookEvent {
  id                String    @id @default(cuid())
  stripeEventId     String    @unique
  type              String                          // e.g., 'invoice.paid'
  payload           Json
  status            String    @default("pending")   // pending, processed, failed
  errorMessage      String?
  attempts          Int       @default(0)
  processedAt       DateTime?
  createdAt         DateTime  @default(now())

  @@index([stripeEventId])
  @@index([type])
  @@index([status])
  @@map("billing_webhook_events")
}
```

Notes:

- All models prefixed with `Billing` to avoid collisions with existing models.
- `BillingCustomer` links 1:1 to `User` — created lazily on first billing interaction.
- `BillingWebhookEvent` provides idempotent webhook processing via unique `stripeEventId`.
- Store only non-sensitive card metadata (brand, last 4, expiry). Never store PAN or CVV.

Extend existing `User` model:

```prisma
model User {
  // ... existing fields ...
  billingCustomer  BillingCustomer?
}
```

---

## 7. API Specification

Base path: `/api/billing`

### Checkout & Subscriptions

- **POST** `/checkout/subscription` — Create Stripe Checkout Session for subscription
  - Body: `{ priceId: string, successUrl?: string, cancelUrl?: string }`
  - Response: `{ sessionId: string, url: string }` (Checkout Session URL)

- **POST** `/checkout/credits` — Create Stripe Checkout Session for credit top-up
  - Body: `{ brandId: string, creditPack: 'starter' | 'standard' | 'bulk' }`
  - Response: `{ sessionId: string, url: string }`

- **GET** `/subscription` — Get current subscription status
  - Response: `{ subscription: SubscriptionDTO | null, tier: string, limits: TierLimitsDTO }`

- **POST** `/subscription/change` — Upgrade or downgrade plan
  - Body: `{ newPriceId: string }`
  - Response: `{ subscription: SubscriptionDTO, prorationAmount?: number }`

- **POST** `/subscription/cancel` — Cancel at period end
  - Response: `{ subscription: SubscriptionDTO, cancelAt: string }`

- **POST** `/subscription/reactivate` — Undo pending cancellation
  - Response: `{ subscription: SubscriptionDTO }`

### Payment Methods

- **GET** `/payment-methods` — List saved payment methods
  - Response: `{ methods: PaymentMethodDTO[], defaultId: string | null }`

- **POST** `/payment-methods/setup` — Create SetupIntent for adding a new method
  - Response: `{ clientSecret: string }`

- **DELETE** `/payment-methods/:id` — Remove a payment method
  - Response: `{ success: boolean }`

- **PATCH** `/payment-methods/:id/default` — Set as default
  - Response: `{ success: boolean }`

### Invoices & Portal

- **GET** `/invoices` — List invoices
  - Query: `limit`, `startingAfter`
  - Response: `{ invoices: InvoiceDTO[], hasMore: boolean }`

- **POST** `/portal` — Create Stripe Customer Portal session
  - Response: `{ url: string }`

### Webhooks (no authentication)

- **POST** `/webhooks/stripe` — Stripe webhook receiver
  - Headers: `stripe-signature`
  - Body: Raw Stripe event
  - Response: `{ received: true }`

---

## 8. Webhook Events to Handle

| Stripe Event                           | Action                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`           | If subscription: create local subscription, update `subscriptionTier`. If credit pack: call `topUpAiCredits()`. |
| `customer.subscription.created`        | Create/sync local `BillingSubscription`, set tier to `pro`.                                                     |
| `customer.subscription.updated`        | Sync status, period dates, cancel state. Update tier if plan changed.                                           |
| `customer.subscription.deleted`        | Set `subscriptionTier` to `free`, mark subscription canceled.                                                   |
| `invoice.paid`                         | Update local invoice status, record payment.                                                                    |
| `invoice.payment_failed`               | Emit `billing.payment_failed` notification. Start dunning sequence.                                             |
| `customer.subscription.trial_will_end` | Emit `billing.trial_ending` notification (3 days before).                                                       |
| `payment_method.attached`              | Sync to local `BillingPaymentMethod`.                                                                           |
| `payment_method.detached`              | Remove from local `BillingPaymentMethod`.                                                                       |
| `charge.dispute.created`               | Alert engineering team (Sentry alert + notification).                                                           |

---

## 9. UX Specifications

### 9.1 Pricing Page

- Route: `/pricing` (public) and `/settings/billing/upgrade` (authenticated).
- Three-column layout: Free, Pro (highlighted as "Most Popular"), Enterprise.
- Toggle for Monthly / Annual billing with savings badge ("Save 17%").
- Feature comparison table below the cards.
- "Get Started" (free) / "Upgrade to Pro" (opens checkout) / "Contact Sales" (enterprise).

### 9.2 Checkout Flow

- On "Upgrade to Pro" click:
  1. Backend creates Stripe Checkout Session (or returns `clientSecret` for embedded Payment Element).
  2. Redirect to Stripe Checkout (Phase 1, simpler) or render embedded Payment Element (Phase 2).
  3. On success, redirect to `/settings/billing?success=true` with confirmation toast.
  4. On cancel, redirect to `/pricing?canceled=true`.

### 9.3 Billing Settings Page

- Route: `/settings/billing`.
- Sections:
  - **Current Plan**: Tier name, next billing date, amount. "Change Plan" / "Cancel" buttons.
  - **Payment Method**: Default card display (brand icon + •••• 4242 · Exp 12/27). "Add Method" / "Change Default" actions.
  - **AI Credits**: Current balance per brand. "Buy Credits" button opening credit pack selector.
  - **Invoice History**: Table with date, amount, status, PDF download link.
  - **Manage Billing**: "Open Billing Portal" button (Stripe Customer Portal fallback).

### 9.4 Credit Top-Up Modal

- Triggered from Billing page or from Limits page when credits are low.
- Shows 3 pack options (Starter, Standard, Bulk) with credit amounts and prices.
- "Purchase" opens Stripe Checkout (mode: `payment`).
- On success, credits appear in brand wallet immediately (via webhook → `topUpAiCredits()`).

### 9.5 Upgrade Prompts

- Show upgrade CTA when user hits a tier limit:
  - Schedule-ahead limit reached (in `Limits.tsx` — replace "Coming Soon" section).
  - AI credits exhausted (in recipe run flow — show "Buy Credits" instead of blocking).
  - Publishing queue depth exceeded.
- Prompts are non-blocking suggestions, not hard paywalls (except when `AI_CREDITS_ENFORCE=true`).

### 9.6 Failed Payment Banner

- Persistent banner at top of app when subscription is `past_due`.
- "Your payment failed. Update your payment method to keep Pro features."
- Links to payment method management.
- Dismissible but reappears on next session.

---

## 10. Integration with Existing Systems

### 10.1 Subscription Tier Mapping

When Stripe webhook confirms subscription status change, update `User.subscriptionTier`:

```
Stripe subscription.status  →  User.subscriptionTier
─────────────────────────────────────────────────────
active                       →  'pro' (based on price metadata)
trialing                     →  'pro'
past_due                     →  'pro' (grace period, 7 days)
canceled / unpaid            →  'free'
incomplete / incomplete_expired →  'free'
```

This means all existing tier-based enforcement (`getMaxScheduledAheadForTier()`, `getMaxQueueDepthForTier()`, credit allocations) activates automatically without changes.

### 10.2 AI Credits Integration

- On Pro subscription activation: grant monthly credit allocation (5,000 credits) via `topUpAiCredits()`.
- On subscription renewal (`invoice.paid` for recurring): grant next month's credits.
- Credit top-up purchases: direct call to `topUpAiCredits()` on `checkout.session.completed`.
- Existing `recordManagedUsageDebit()` and `isAiCreditEnforcementEnabled()` continue unchanged.

### 10.3 Notifications Integration

Emit billing events through existing `NotificationsService`:

```typescript
await notificationsService.emit({
  type: 'billing.payment_failed',
  category: 'billing',
  severity: 'error',
  recipients: [userId],
  resource: { type: 'subscription', id: subscriptionId },
  metadata: { amount, currency, retryDate },
});
```

The notification system already supports the `billing` category. Email templates needed for:

- `[Action required] Payment failed for your Postolio subscription`
- `Your Postolio subscription has been canceled`
- `Receipt: Postolio Pro — $29.00`

---

## 11. Security

- **PCI DSS**: SAQ A compliance. Card data handled exclusively by Stripe via hosted iframes (Payment Element or Checkout). Our servers never see, log, or store raw card numbers.
- **Webhook Verification**: Every incoming webhook verified via `stripe.webhooks.constructEvent()` using HMAC SHA-256 with the webhook signing secret. Requests with invalid signatures are rejected with 400.
- **Idempotency**: All payment-mutating Stripe API calls include an `idempotencyKey` (format: `{userId}_{action}_{timestamp}`) to prevent double charges on retries.
- **Fraud**: Stripe Radar (included) provides ML-based fraud detection on all transactions. Consider Radar for Fraud Teams ($0.07/txn) at scale.
- **API Authorization**: All `/api/billing/*` routes require authenticated session (existing `fastify.authenticate` middleware). Webhook route (`/api/webhooks/stripe`) is unauthenticated but signature-verified.
- **Data Retention**: Webhook event payloads retained 90 days, then pruned. Invoice records retained indefinitely for compliance.

---

## 12. Observability & Metrics

- **Business Metrics**: MRR, ARR, subscriber count by tier, churn rate (monthly), upgrade/downgrade rate, credit pack revenue.
- **Operational Metrics**: Webhook processing latency (p50, p95, p99), webhook failure rate, Stripe API error rate, payment success rate.
- **Alerts**: Payment failure rate > 5% in 1 hour. Webhook processing backlog > 100 events. Stripe API 5xx error rate > 1%.
- **Logging**: Structured JSON logs for all billing events. Fields: `userId`, `stripeCustomerId`, `eventType`, `amount`, `currency`, `status`.

---

## 13. Cost Analysis

### Stripe Fees (at $29/mo Pro plan)

| Component                         | Fee          | Per $29 charge    |
| --------------------------------- | ------------ | ----------------- |
| Card processing                   | 2.9% + $0.30 | $1.14             |
| Stripe Billing                    | 0.7%         | $0.20             |
| **Total per subscription charge** |              | **$1.34** (~4.6%) |

### Projected Revenue vs Fees

| Subscribers | Monthly Revenue | Stripe Fees/mo | Net Revenue/mo |
| ----------- | --------------- | -------------- | -------------- |
| 100         | $2,900          | $134           | $2,766         |
| 500         | $14,500         | $670           | $13,830        |
| 1,000       | $29,000         | $1,341         | $27,659        |
| 5,000       | $145,000        | $6,703         | $138,297       |

Credit pack purchases add ~$134 per 100 purchases ($50 pack avg) in Stripe fees.

---

## 14. Rollout Phases

- **Phase 1 (MVP)**: Stripe Checkout (redirect), subscription create/cancel, credit top-up, webhook handler, basic billing page, Stripe Customer Portal fallback. Pricing page.
- **Phase 2**: Embedded Payment Element (no redirect), payment method management UI, upgrade/downgrade with proration, annual billing toggle, invoice history, dunning emails, multi-currency.
- **Phase 3**: Enterprise tier (sales-led, custom pricing), Stripe Tax integration, usage-based metered billing, advanced analytics dashboard, referral/coupon system.

---

## 15. Open Questions

1. **Trial period**: Should Pro have a 14-day free trial? (Recommendation: Yes for Phase 2, not MVP.)
2. **Annual billing discount**: 17% discount ($290/yr vs $348/yr)? (Recommendation: Yes, aligns with competitor norms.)
3. **Credit rollover**: Do unused monthly credits roll over or expire? (Recommendation: Roll over, capped at 2x monthly allocation.)
4. **Multi-user billing**: When team/org features are added, should billing be per-user or per-org? (Recommendation: Per-org, defer to Phase 3.)
5. **Stripe Tax**: Enable from launch or defer? (Recommendation: Defer to Phase 2; manually handle US sales tax initially or rely on nexus thresholds.)
