# Multi-Platform Social Accounts (Instagram + Facebook) — Research & UX Patterns

**Date**: 2025-12-15  
**Status**: Research (proposed architecture + UX recommendations)  
**Scope**: Add Facebook Pages alongside Instagram, and shift Postolio to a “multiple social accounts per brand” model.

**Greenfield note**: There are no customers. We can safely introduce breaking API/service changes and rebuild this area as a clean, robust foundation (no backward-compat routes, no migration gates, no “fetch legacy fields” scaffolding).

---

## Executive Summary

Postolio already has a multi-platform-ready data model (`SocialAccount`, `ContentPublication`, `Platform` enum) and a connector-based “generic social routes” layer, but key integration points still assume **one account per brand per platform**:

- Backend status/sync routes fetch a single `SocialAccount` via `findFirst()`.
- Tokens are stored in the Token Service keyed by `(userId, brandId, platform)`, which cannot represent multiple Instagram or Facebook accounts per brand.
- The dashboard UX largely still centers on “Connect Instagram”, even though onboarding already uses the phrase “Connect social accounts”.

To support **multiple Instagram accounts**, **multiple Facebook accounts/pages**, and future platforms, we should treat **SocialAccount** as the primary unit of connection and operation (publish/sync/analytics), not “brand+platform”.

This document:

1. Summarizes Meta/Facebook technical requirements (OAuth scopes + Graph endpoints).
2. Recommends terminology and UX patterns (“Social accounts” / “Connected accounts”).
3. Proposes a modular architecture for platform integrations that scales to additional platforms.
4. Lists UX touchpoints that must change to support the new paradigm.

---

## Current State in This Repo (as-is)

### Data model (already supports multi-account)

- `packages/libs/database/prisma/schema.prisma`: `Brand.socialAccounts: SocialAccount[]` and `SocialAccount` allows multiple records per `brandId` + `platform` (no DB uniqueness constraint).
- `ContentPublication` already links to a specific `socialAccountId` (good foundation for multi-account publishing/analytics).

### Backend (still behaves single-account)

- `packages/apps/api/src/routes/social-platform.ts`: uses `prisma.socialAccount.findFirst({ where: { brandId, platform } })` for `status`, `sync`, `disconnect`, etc.
- `packages/apps/api/src/services/publisher-credentials.ts`: `take: 1` Instagram social account and fetches token by `(userId, brandId, 'instagram')`.
- Token Service (`packages/services/token-service/src/index.ts`) stores tokens keyed by:
  - `pk = ${userId}#${platform}`
  - `sk = ${brandId}`
    This model supports **one token per brand+platform**, not per account.

### Why we should take a greenfield reset

Because we don’t have customers, it’s cheaper and safer to:

- Make the API/service contracts **account-scoped** from the start (`socialAccountId` everywhere).
- Fix token identity properly (per-account) instead of adding “default account” hacks first.
- Introduce a dedicated “Social Accounts” base structure (service boundary) that every future platform plugs into.

### Frontend (UI says “social accounts”, but flow is still Instagram-only)

- Onboarding step label: “Connect social accounts” but renders only `InstagramConnect`.
- Brand management renders only an Instagram connection card (`InstagramConnect` wraps the generic `SocialAccountConnect`).
- `packages/apps/web/src/lib/platform-config.ts` includes `facebook` but marked `enabled: false`.
- `BrandClient.initializeSocialOAuth()` throws for all platforms except Instagram.

---

## Terminology (Recommended)

### Internal naming (product + code)

- **Platform**: Instagram, Facebook, LinkedIn, etc.
- **Social account**: A concrete target you can publish/sync/measure against.
  - Instagram: IG Business/Creator account (requires FB Page)
  - Facebook: Facebook Page (API does not support posting as a personal profile)
- **Provider** (optional concept): Auth provider implementation (e.g., “Meta” powering IG + FB connections).

### What competitors call it

Our existing competitor notes frequently use “channels” as the unit of connected destinations (e.g., `docs/product-spec.md` mentions “10 channels”, “3 channels” for competitors). In many tools, “channel” and “social account/profile” are used interchangeably.

**Recommendation for Postolio UI**: Use **“Social accounts”** consistently (we already do in onboarding copy). It’s clearer than “channels” (which can also mean content channels/marketing channels).

---

## Meta/Facebook Technical Research (What’s needed)

### 1) Authentication model

For both Instagram Graph API and Facebook Pages API, we use Meta OAuth (Facebook Login dialog) and then call Graph API.

Existing Instagram OAuth implementation already requests scopes including:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts` (depends on `pages_read_engagement` + `pages_show_list`)
- `business_management`
- `instagram_basic`
- `instagram_manage_insights`
- `instagram_content_publish`

Source in repo: `packages/apps/api/src/routes/instagram-oauth.ts`.

Meta docs confirm `pages_manage_posts` dependencies and purpose:

- `pages_manage_posts` depends on `pages_read_engagement` and `pages_show_list`, and allows create/edit/delete Page posts.
  - Meta docs: `https://developers.facebook.com/docs/permissions/reference/pages_manage_posts/`

### 2) Discovering connectable accounts (multi-account)

With a single Meta login, we can fetch the set of Facebook Pages the user manages and derive both Facebook and Instagram “social accounts”:

1. `GET /me/accounts` → list Pages + Page access tokens (requires `pages_show_list`)
2. For each Page:
   - `GET /{page-id}?fields=instagram_business_account,connected_instagram_account&access_token={page_access_token}`
   - If present, we can connect an Instagram account via `instagram_business_account.id` (or connected account).

**Important**: the current Instagram OAuth flow selects one Page “with an Instagram account” automatically. To support multiple Instagram accounts and Facebook Pages, we must present a selection UI (or connect all found).

### 3) Facebook publishing primitives (Pages)

Facebook Page feed publishing is available via:

- `POST /{page-id}/feed` (text/link posts)
  - Meta docs: `https://developers.facebook.com/docs/graph-api/reference/v24.0/page/feed/`

Notes from the docs page:

- Supports scheduled publishing fields (e.g., `scheduled_publish_time`) and unpublished posts via parameters. Exact product constraints should be validated during implementation (some features require Page settings and app review).

### 4) Permissions + App Review reality

Development mode works for app admins/dev/testers.
Production use for Page publishing typically requires App Review approval for Page permissions (e.g., `pages_manage_posts`), and Meta periodically changes requirements.

**Recommendation**: treat “Facebook connect” as two milestones:

1. **Connect + store accounts** (selection UI + persistence)
2. **Publishing/sync/analytics enablement** (depends on connector capabilities + permissions + review)

---

## Modular Architecture Proposal (Make adding platforms easier)

### Guiding principle

Make **SocialAccount** the unit of:

- connection (OAuth and persistence)
- tokens (storage + refresh)
- publish/sync operations
- analytics aggregation

Avoid assuming one account per brand/platform.

### Proposed backend layering

1. **OAuth adapters (provider/platform)**
   - Goal: produce a list of “connectable account candidates” for a given brand.
   - For Meta, one auth callback can produce candidates for both Facebook Pages and connected Instagram accounts.

2. **Connection finalization**
   - Persist selected candidates to `social_accounts`.
   - Store per-account tokens in Token Service keyed by account identity.
   - Mark a “default” account per platform per brand (optional but strongly recommended).

3. **Connectors (per platform)**
   - `packages/libs/connectors` already defines a stable `Connector` interface.
   - Add `FacebookConnector` for:
     - `listRecentPosts` (Page feed)
     - optional `publish`
     - optional insights later

4. **Generic routes become account-aware**
   - Keep existing routes for backward compatibility, but add account-scoped endpoints and/or parameters:
     - list connected accounts
     - sync/publish a specific socialAccountId

### Token Service change (required for multi-account)

Current Token Service key: `(userId, brandId, platform)` → token

To support multiple accounts per platform, we need **token keys to include account identity**. Suggested options:

1. **Key by SocialAccount ID**
   - Pros: stable internal ID, aligns with DB relationships.
   - Cons: Token Service becomes coupled to Postgres-generated IDs.

2. **Key by external account identity**
   - Example key tuple: `(userId, brandId, platform, externalAccountId)`
   - Pros: independent of DB IDs; matches the “real world” identity.
   - Cons: needs careful handling for platforms where “account” identity is composite (e.g., pageId + igAccountId).

Recommendation: key by `(userId, brandId, platform, externalAccountId)` and include additional identifiers (like `pageId`) in `metadata`.

---

## Proposed Service Boundary (New Base Structure)

### Social Accounts Service (recommended)

Create a dedicated microservice responsible for:

- OAuth connection orchestration (start → callback → candidates → finalize)
- Persisting `SocialAccount` records
- Token storage coordination (writing per-account tokens to Token Service)
- Account health (connected/disconnected, token status), and emitting events for other services

Everything else (publishing, analytics ingestion, scheduler) should consume **social accounts** via this service rather than re-implementing connection logic.

This sets us up for a future “Social Power‑Up” entitlement:

- Social accounts _exist_ regardless.
- Advanced capabilities (publishing, analytics, inbox) can be enabled per brand via entitlements without changing the underlying connection architecture.

---

## UX Patterns (What we should build)

### 1) Brand has a “Social accounts” section

Show a list grouped by platform:

- Instagram accounts (can be 0..N)
- Facebook Pages (can be 0..N)

Each account row:

- platform icon + platform name
- account display name / username
- status (Connected / Needs reconnect)
- actions: Sync, Set default (optional), Disconnect

### 2) “Add account” flow (platform selector + selection)

1. User clicks **Add account**
2. Choose platform:
   - Instagram
   - Facebook
3. OAuth popup
4. After OAuth returns, show selection UI:
   - list of discovered Pages (for Facebook)
   - list of discovered IG accounts (for Instagram)
   - allow multi-select
5. Confirm → creates `social_accounts` + stores tokens

### 3) Multiple accounts per brand

For v1 UX, prefer:

- Allow multiple accounts per platform per brand.
- Support selecting a “default” account per platform per brand for simple flows (publish/sync buttons can default).
- Advanced flows (composer) can explicitly pick target accounts.

---

## UX Touchpoints to Update (High-level)

See also the dedicated UX audit list in `docs/implementation-plan-social-accounts-multi-platform.md`.

- Onboarding “Connect social accounts” should allow connecting Instagram and Facebook, and multiple accounts.
- Brand management should show “Social accounts” rather than only “Instagram Connection”.
- Any “Instagram-only required” gates should become “at least one social account connected” gates.
- Publishing UI must eventually choose target social account(s), not just platform.
- Analytics filters may need account-level filtering (optional), but should at least aggregate across all accounts for a brand.

---

## Open Questions / Decisions Needed

1. Do we treat Meta as a single combined “Connect Meta” flow, or separate “Instagram” vs “Facebook” buttons?
2. Should the MVP connect **all discovered accounts** automatically (fast) or require user selection (safer)?
3. Do we allow the same Instagram/Facebook account to be connected to multiple brands? (DB currently prevents this via `@@unique([platform, externalAccountId])`.)
4. What is the “primary/default account” rule per platform for a brand?
5. For Facebook, do we support Pages only (recommended) or attempt any personal-profile behavior (not supported via API)?
