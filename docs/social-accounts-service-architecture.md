# Social Accounts Service — Greenfield Architecture (Meta-first)

**Date**: 2025-12-15  
**Status**: Proposed  
**Context**: No customers → we can adopt a breaking, clean-slate design.

---

## Purpose (New Base Structure)

Create a dedicated microservice that becomes the **single source of truth** for:

- Connected social accounts (per brand, per platform, multiple accounts supported)
- Connection lifecycle (OAuth start/callback/candidate discovery/finalize)
- Token coordination (store per-account tokens in Token Service)
- Account health and events (disconnected, token expiring, reconnect needed)

This service is the foundation that makes adding platforms incremental: a new platform is primarily “add connector + add provider adapter (OAuth) + add UI config”.

---

## Core Concepts

### Social account

A concrete destination you can publish/sync/analyze:

- Instagram: IG professional account (Business/Creator) discovered through a Facebook Page
- Facebook: Facebook Page

### Provider vs Platform

- **Provider**: OAuth + discovery mechanism (e.g., Meta)
- **Platform**: Where the content lands (instagram, facebook, …)

Meta is a provider that can yield candidates for multiple platforms.

---

## Dependencies

- **Postgres** (or equivalent) for `Brand` + `SocialAccount` persistence
- **Token Service** for storing sensitive tokens (encrypted at rest)
- **Connectors** (`packages/libs/connectors`) for platform API calls (list posts, publish, insights)
- **Redis** (optional) for short-lived connect sessions/candidates and rate limiting
- **EventBridge** (recommended) for emitting account lifecycle + operations events

---

## Service API (proposed)

### List & manage accounts

- `GET /brands/:brandId/social-accounts`
- `POST /brands/:brandId/social-accounts/:socialAccountId/set-default`
- `POST /brands/:brandId/social-accounts/:socialAccountId/disconnect`
- `POST /brands/:brandId/social-accounts/:socialAccountId/reconnect` (optional convenience wrapper)

### Meta connect (primary connect flow)

- `POST /brands/:brandId/social-accounts/connect/meta/start`
  - returns `authUrl` + `connectSessionId`
- `GET /brands/:brandId/social-accounts/connect/meta/callback`
  - exchanges code → collects candidates → stores them for the session → returns popup success page
- `GET /brands/:brandId/social-accounts/connect/meta/candidates?connectSessionId=...`
  - returns Pages + IG accounts discovered
- `POST /brands/:brandId/social-accounts/connect/meta/finalize`
  - body includes `connectSessionId` + selected candidate ids
  - upserts `SocialAccount` rows + stores tokens keyed by `socialAccountId`

### Operations (optional in v1, but recommended to centralize)

- `POST /brands/:brandId/social-accounts/:socialAccountId/sync`
- `POST /brands/:brandId/social-accounts/:socialAccountId/publish`

If publishing is handled elsewhere (Publisher service), the Publisher should publish against `socialAccountId` and fetch tokens by that id.

---

## Token Identity Contract (greenfield recommendation)

Store tokens per connected account:

- Key tuple: `(userId, brandId, platform, socialAccountId)`
- Token metadata should include:
  - `brandId`
  - `externalAccountId`
  - `pageId` (Meta), if applicable
  - `expiresAt`

This avoids “brand+platform implies one account” assumptions and forces every caller to be explicit about the target account.

---

## Events (recommended)

Emit events so downstream services don’t re-implement coupling logic:

- `social.account.connected` (brandId, socialAccountId, platform)
- `social.account.disconnected`
- `social.account.reconnect_required`
- `social.account.sync_requested`
- `social.account.sync_completed`
- `social.account.publish_requested`
- `social.account.publish_completed`

---

## Web UX Contract (BFF)

The web app should consume:

- list accounts for a brand
- start connect → popup → finalize selection
- disconnect / set default / sync actions per account

The existing `api` app can proxy these endpoints to keep browser auth/cookies consistent, but should not own platform-specific connection logic long-term.
