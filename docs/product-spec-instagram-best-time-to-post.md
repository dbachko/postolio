# Product Spec: Instagram Best Time to Post Microservice

**Feature**: Data-driven posting time recommendations (Instagram)
**Status**: Planning
**Created**: 2025-10-26
**Owner**: Engineering Team

---

## 1. Overview

### Problem Statement

Creators currently pick posting times manually or rely on generic advice. We need brand-specific, timezone-aware recommendations for when to post on Instagram to maximize reach and engagement.

### Solution

Introduce a microservice that computes and serves “best time to post” data for Instagram. It returns:

- A 7×24 heatmap of relative posting quality per local hour.
- A ranked list of top N recommended posting windows (e.g., 30–60 minute slots).
- A confidence score and the data source used (insights, history, or heuristics).

### Scope (MVP)

- Platform: Instagram only.
- Brands with properly connected Instagram professional (Business or Creator) accounts.
- Eligible brands have ≥100 followers for insights-driven recommendations.
- Primary signal: Instagram Graph API “online_followers” insights (when available).
- Fallback: Recent performance of the brand’s posts, then heuristics when data is insufficient.

### Success Metrics

- 95% of eligible brands receive recommendations within 800 ms (cached) or 3 s (fresh).
- > 80% of recommendations sourced from platform insights or brand history (not heuristics).
- +10–15% improvement in engagement for posts scheduled in recommended windows (post-launch study).

---

## 2. Background & Research Summary

- Vendor landscape: many tools expose “best times to post” only in their UI; few expose an API. We will implement our own using platform signals to avoid vendor lock-in.
- Instagram Graph API (v24.0) exposes follower online activity via the `online_followers` IG User insights metric. Confirmed limitations from Meta docs:
  - Not available for IG professional accounts with fewer than 100 followers.
  - Available only for the last 30 days; data may be delayed up to ~48 hours.
  - Requires `instagram_basic`, `instagram_manage_insights`, and `pages_read_engagement` permissions.
- Additional signals include brand’s own historical engagement by hour-of-week (from our `Content` table), adjusted for timezone and seasonality. When insights are unavailable or sample size is small, a heuristic fallback is used.

References: Meta IG User Insights documentation (v24.0) confirming `online_followers`, follower threshold, and last‑30‑days constraint.

---

## 3. User Stories

1. As a content creator, I want a “Best times to post” list so I can quickly pick the most effective time slots.
2. As a brand manager, I want a calendar heatmap overlay so I can visually identify high-opportunity windows across the week.
3. As a scheduler user, I want the composer to suggest the next best slot in my brand’s timezone so I don’t need to guess.

---

## 4. Requirements

### Functional Requirements

- FR-1: Provide a 7×24 heatmap (local brand timezone) of posting suitability values (0–1 float).
- FR-2: Provide top N recommended windows (e.g., 5–10), each with:
  - local start time, duration (30–60 mins), UTC equivalent
  - score and confidence, and a short explanation (e.g., “High follower activity”).
- FR-3: Primary data source: Instagram Graph API `online_followers` (v24.0) when permission and data exist.
- FR-4: Fallback logic:
  - Fallback A: Analyze last 60–90 days of brand’s posts (`Content`) for engagement by hour-of-week (likes/comments; use reach if present).
  - Fallback B: Heuristic defaults (industry and general Instagram patterns) adjusted to brand timezone.
- FR-5: Timezone handling: all inputs and outputs presented in the brand’s posting timezone (`TimezoneService`).
- FR-6: Caching: cache per-brand results for 24 hours; allow manual refresh. TTL configurable (12–24h recommended) to balance freshness and rate limits.
- FR-7: API endpoints:
  - GET `/api/instagram/best-time/:brandId` → cached recommendations
  - POST `/api/instagram/best-time/:brandId/refresh` → recompute and return
  - GET `/api/instagram/best-time/:brandId/status` → freshness, source, confidence, next refresh
- FR-8: Permissions & eligibility: ensure brand has an Instagram professional (Business or Creator) account, at least 100 followers for `online_followers`, and required scopes (`instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`); return actionable error if missing and fall back.

### Non‑Functional Requirements

- NFR-1: Performance: cached GET < 800 ms p95; refresh compute < 3 s p95.
- NFR-2: Reliability: graceful fallback path; never block scheduling flows.
- NFR-3: Rate Limits: respect Meta Graph API rate limits (avoid hardcoded numeric assumptions); reuse Token Service; apply exponential backoff; cache aggressively.
- NFR-4: Security: no raw token storage; use Token Service; store only aggregated results; PII-free.
- NFR-5: Observability: log source used, cache hits/misses, compute duration, and error reasons.

---

## 5. Data & Algorithm

### Inputs

- Brand context: `brandId`, brand posting timezone (via `TimezoneService.getBrandTimezone`).
- Instagram account identifiers and access tokens (via Token Service).
- Optional: historical `Content` rows for engagement analysis.

### Transformations

1. Insights path (preferred):
   - Fetch `online_followers` histogram(s) from Instagram Graph API v24.0 using the IG User insights endpoint.
   - Constrain range to the last 30 days; handle empty datasets when insights are unavailable.
   - Normalize to [0,1]; smooth with a 3×3 kernel across neighboring hours/days.
   - Penalize nighttime hours by small factor unless activity is high.
   - Produce 7×24 heatmap and rank top disjoint windows.

2. History path (fallback A):
   - Aggregate last 60–90 days of published posts by hour-of-week in the brand timezone.
   - Score = weighted engagement (e.g., `likes + 2*comments`), optionally normalized by reach/impressions if available.
   - Apply minimum sample thresholds (e.g., ≥3 posts per hour bucket); if insufficient, back off to broader dayparts; then normalize and smooth.

3. Heuristic path (fallback B):
   - Use a static profile (Instagram-global defaults, tuned per region/hemisphere if available) and align to brand timezone.

### Outputs

```json
{
  "brandId": "...",
  "platform": "instagram",
  "timezone": "America/Los_Angeles",
  "source": "instagram_insights | history | heuristic",
  "confidence": 0.82,
  "generatedAt": "2025-10-26T18:35:00Z",
  "ttlSeconds": 86400,
  "heatmap": [[0.12, 0.09, ... 24 values], ... 7 rows],
  "topWindows": [
    {
      "startLocal": "2025-10-27T10:00:00-07:00",
      "startUTC": "2025-10-27T17:00:00Z",
      "durationMinutes": 60,
      "score": 0.93,
      "explanation": "Peak follower activity"
    }
  ],
  "notes": ["Insights-based", "Smoothed across neighboring hours"]
}
```

---

## 6. API Design (MVP)

- GET `/api/instagram/best-time/:brandId`
  - Query: `force=false` (bypass cache if true)
  - 200: recommendations payload (above)
  - 400/403: missing permissions or account type; actionable message

- POST `/api/instagram/best-time/:brandId/refresh`
  - Body: `{ recompute: true }`
  - 200: fresh recommendations; sets/updates cache

- GET `/api/instagram/best-time/:brandId/status`
  - 200: `{ source, confidence, generatedAt, nextRefreshAt, cacheHitRate }`

---

## 7. Data Storage & Caching

- Primary: Redis key `ig_best_time:{brandId}` with 24h TTL (JSON payload).
- Optional persistence (phase 2): Postgres table `best_post_time_recommendations` for audit/analytics.
- Do not store raw follower data beyond aggregated shape needed to reproduce outputs.

Refresh policy: compute on-demand, and (phase 2) precompute nightly per brand to further reduce p95 latencies on first access.

---

## 8. Edge Cases & Constraints

- Missing `instagram_manage_insights` permission → error with remediation steps.
- Non-Business or newly converted accounts → insights unavailable; use fallback.
- <100 followers → `online_followers` unavailable; use fallback and mark low confidence.
- Very low follower counts or sparse history → drop to heuristics; mark low confidence.
- DST transitions → rely on `TimezoneService` for correct hour mapping.
- Rate limit or token errors → retry with backoff and cache prior results.

---

## 9. Success Criteria (MVP)

- [ ] Endpoints live and documented; recommendations returned for eligible brands.
- [ ] Cached response p95 < 800 ms; recompute p95 < 3 s.
- [ ] ≥80% of responses use insights or history (not heuristics) for connected, active brands.
- [ ] Clear fallbacks and confidence values when data is insufficient.

---

## 10. Out of Scope (MVP)

- Other platforms (Facebook, LinkedIn, TikTok).
- UI overlays and composer integration (planned in a later phase).
- Long-term model training beyond simple smoothing/weights.
