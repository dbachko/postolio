# Product Spec: Notifications & Notification Preferences

**Feature**: In‑app notifications, preferences, and email delivery
**Status**: Planning
**Created**: 2025-10-25
**Owner**: Platform & UX

---

## 1. Overview

### Problem Statement

Users do not receive actionable alerts about important events in Postolio (e.g., scheduled post failures, approval requests, or account disconnects). There is a Notifications tab in Settings, but no working notification system or preferences yet.

### Goals

- Deliver timely, actionable in‑app notifications with a familiar bell icon + dropdown and a full Notification Center.
- Allow granular preferences by category/type and channel (in‑app, email immediate, email digest; future: push/Slack).
- Provide DND windows and digest scheduling so users can control attention and reduce noise.
- Ensure reliability, accessibility, privacy compliance, and observability from day one.

### Out of Scope (Phase 1)

- Browser push, mobile push, Slack app/webhooks (will be Phase 4+).
- Per-resource watch subscriptions UI (Phase 3+); Phase 1 uses system defaults and coarse preferences.

---

## 2. Competitor Audit (Summary)

- Buffer: Clear “Failed posts” with reasons and next steps; central view for failed items.
- Hootsuite: Bell + feed, sidebar/overlay, settings for publishing/assignments/messages; granular filters.
- Sprout Social: “Smart Inbox” with approvals, spikes, failure alerts; task‑oriented actions.
- Slack: Per‑workspace/channel prefs, keyword alerts, DND, email for missed; scheduled summaries.
- GitHub/Linear: Inbox triage (save/done/archive/mute), custom filters; in‑app + email; real‑time.

Key patterns we adopt:

- Bell + badge + dropdown for recent items; dedicated Notification Center for full history.
- Clear actor + concise title + context + time + CTA.
- Read/unread, mark all read, bulk actions; grouping by day and aggregation of repetitive events.
- Preferences by category/type and channel; DND; digest schedule; critical events always on.

---

## 3. User Stories

1. As a brand owner, I want to be notified when a scheduled post fails to publish, so I can retry/reconnect immediately.

2. As a content manager, I want to be notified when my approval is requested or a request is approved/rejected, so I can keep content moving.

3. As a collaborator, I want to be notified when I am mentioned or a comment is added on a post I follow, so I can respond quickly.

4. As an account admin, I want to be notified when a social account disconnects or its token is expiring, so I can restore connectivity.

5. As a finance owner, I want to be notified about billing issues (payment failed), so I can resolve them and prevent disruption.

6. As a user, I want to control which notifications I receive and when (instant vs digest, DND), so I can manage attention.

---

## 4. Requirements

### Functional Requirements (FR)

- FR‑1 In‑App Feed
  - Bell icon with badge; dropdown shows latest 10–20 grouped by day.
  - “View all” opens Notification Center (full history with filters/search).
  - Item shows icon (by category), title, short body/context, relative time, and CTA (e.g., Retry, Reconnect, View).
  - Read/unread state; per‑item toggle; “Mark all as read”; archive support.

- FR‑2 Preferences
  - Per category (publishing, accounts, collaboration, system, billing) and type (e.g., publishing.post_failed).
  - Per channel toggles: in_app (always on by default), email instant, email digest.
  - Frequency for email channels: instant, daily, weekly; user‑selectable digest time (local tz).
  - DND window (start/end local time) with “allow mentions during DND” override.

- FR‑3 Delivery & Real‑Time
  - In‑app real‑time updates via WebSockets (reuse StatusBroadcaster infra) with Redis streams; polling fallback.
  - Email delivery via existing EmailService + EmailQueue (Bull + Redis).
  - Digest emails aggregated by category/time window.

- FR‑4 Event Ingestion
  - Internal `NotificationsService.emit({ type, severity, resource, recipients, metadata, dedupeKey, groupKey })` to materialize per‑recipient notifications.
  - De‑duplication window (e.g., 10 min) using `dedupe_key`; aggregation with `group_key`.

- FR‑5 API
  - List, mark read/unread, mark‑all‑read, archive, update preferences, get stream cursor.

### Non‑Functional Requirements (NFR)

- NFR‑1 Performance: unread count updates in < 200ms p95; list fetch returns in < 300ms p95.
- NFR‑2 Reliability: at‑least‑once delivery semantics; idempotency via dedupe_key; retries with exponential backoff for email.
- NFR‑3 Accessibility: full keyboard navigation; ARIA attributes for list items and badge; color contrast.
- NFR‑4 Security/Privacy: AuthZ by user/org; marketing vs operational consent separation; GDPR export/delete; retention policy (180d default).
- NFR‑5 Observability: structured logs; metrics for queue size, delivery success rate, time‑to‑notify.

---

## 5. Notification Taxonomy

Categories: publishing, accounts, collaboration, system, billing.

Examples (Phase 1 focus bolded):

- Publishing: **post_failed**, post_published, retry_succeeded/failed, approval_requested/approved/rejected.
- Accounts: **account_disconnected**, **token_expiring_24h/7d**, permission_changed.
- Collaboration: mention, comment_added, assignment_changed.
- System: incident, maintenance, changelog (marketing consent).
- Billing: **payment_failed**, invoice_paid, trial_ending.

Severity: info | warning | error. Defaults drive channel behavior (e.g., errors trigger email instant by default).

---

## 6. Data Model (Prisma proposal)

```prisma
model Notification {
  id          String   @id @default(cuid())
  userId      String
  orgId       String?
  type        String              // e.g., 'publishing.post_failed'
  category    String              // 'publishing' | 'accounts' | 'collaboration' | 'system' | 'billing'
  severity    String              // 'info' | 'warning' | 'error'
  title       String
  body        String?
  linkUrl     String?
  actorId     String?
  resourceType String?            // 'post' | 'brand' | 'account' | ...
  resourceId  String?
  metadata    Json?
  dedupeKey   String?   @unique
  groupKey    String?
  createdAt   DateTime  @default(now())
  seenAt      DateTime?
  readAt      DateTime?
  archivedAt  DateTime?
  expiresAt   DateTime?

  @@index([userId, createdAt])
  @@index([userId, readAt])
  @@index([orgId, category])
}

model NotificationPreference {
  id        String   @id @default(cuid())
  userId    String
  orgId     String?
  category  String
  type      String
  channel   String              // 'in_app' | 'email' | 'digest' | 'push' | 'slack'
  enabled   Boolean  @default(true)
  frequency String?             // 'instant' | 'daily' | 'weekly'
  digestTime String?            // '09:00'
  dndStart  String?             // '22:00'
  dndEnd    String?             // '07:00'
  timezone  String?             // 'America/Los_Angeles'
  allowMentionOverride Boolean @default(true)

  @@unique([userId, orgId, category, type, channel])
}

model NotificationDelivery {
  id             String   @id @default(cuid())
  notificationId String
  channel        String
  status         String             // 'queued' | 'sent' | 'failed'
  attempts       Int      @default(0)
  lastError      String?
  sentAt         DateTime?
  createdAt      DateTime @default(now())

  @@index([notificationId])
  @@index([channel, status])
}

model UserNotificationState {
  userId       String   @id
  lastSeenAt   DateTime @default(now())
  unreadCount  Int      @default(0)
  updatedAt    DateTime @updatedAt
}
```

Notes:

- `dedupeKey` allows preventing duplicates across retries (e.g., same post failing repeatedly within a window).
- `groupKey` supports roll‑ups (e.g., “5 posts failed in the last hour”).
- Retain notifications 180 days by default; purge via background job.

---

## 7. API Specification

Base path: `/api/notifications`

- GET `/` — List notifications
  - Query: `cursor`, `limit` (default 20), `filter` (unread|all|archived), `category`, `type`, `since` (ISO)
  - Response: `{ items: NotificationDTO[], nextCursor?: string, unreadCount: number }`

- PATCH `/:id`
  - Body: `{ read?: boolean, archived?: boolean, seen?: boolean }`
  - Response: `{ success: boolean }`

- POST `/mark-all-read`
  - Body: `{ before?: string /* ISO */ }`
  - Response: `{ success: boolean, marked: number }`

- GET `/preferences`
  - Response: `{ items: PreferenceDTO[], defaults: DefaultPreferenceDTO[] }`

- PATCH `/preferences`
  - Body: `{ updates: Array<{ category, type, channel, enabled, frequency?, digestTime? }> }`
  - Response: `{ success: boolean }`

- GET `/stream` (WebSocket topic join or SSE)
  - Query: `cursor?` — last seen event id
  - Response: event stream with `notification_created`, `notification_updated`, `unread_count` updates.

DTOs include: `id, type, category, severity, title, body, linkUrl, resource, createdAt, readAt, seenAt`.

---

## 8. Delivery & Real‑Time

- In‑app: Reuse existing WebSocket + Redis Streams infra (`StatusBroadcaster`) with a new `NotificationsBroadcaster` (similar API). Maintain an `events:notifications:<userId>` stream for catch‑up.
- Email: Use `EmailQueueService` with a new job type `notification` and digest generator job that aggregates per‑user.
- DND: Preferences applied at delivery time (email) and presentation time (UI). Mentions can override DND if enabled.
- Fallback: Poll `/notifications` every 30–60 seconds when sockets unavailable.

---

## 9. UX Specifications

### 9.1 Entry Point

- Add a bell icon with badge to `packages/apps/web/src/components/Layout.tsx` header next to the user dropdown.
- Badge shows unread count (max 99+). A small dot animates on new arrivals.
- Keyboard: Trigger opens dropdown; Esc closes; Up/Down navigates; Enter activates CTA.

### 9.2 Dropdown

- `NotificationsDropdown.tsx` shows last 10–20 items, grouped by day. Each item: icon, title, subtext, timestamp, CTA.
- Controls: Mark all as read; View all.
- Empty state: illustration + “You’re all caught up”.

### 9.3 Notification Center

- Route `/notifications` with tabs (All, Mentions, Approvals, System) and filters (category/type/date/search).
- Virtualized list for performance, skeleton placeholders during load.
- Bulk actions: mark read/unread; archive.

### 9.4 Preferences UI

- Settings → Notifications tab (existing placeholder) to host preferences.
- Per category/type matrix with channel toggles and frequency. DND window setting with timezone awareness (use existing timezone context).
- “Test notification” button to verify delivery.

### 9.5 Toaster vs Durable

- Continue using toast for ephemeral success states. Durable/critical events go to the notification feed.

Accessibility: ARIA roles for `list`, `listitem`, `status`; focus styles and screen reader labels.

---

## 10. Email Content

- Critical (errors, billing failures, disconnects) default to email instant. Subject templates:
  - “[Action required] Post failed to publish to {Platform}”
  - “[Reconnect needed] {Account} disconnected”
  - “Payment failed — update your Postolio payment method”
- Include “Manage notification preferences” footer linking to Settings.

---

## 11. Observability & Metrics

- Per‑user: unread count, last seen at, per‑channel delivery counts.
- Queue: queued/active/completed/failed; retry counts; DLQ size.
- Timeliness: event → in‑app display latency; event → email sent latency.
- Error budgets: delivery success rate ≥ 99.5%; time‑to‑notify p95 < 2s (in‑app), < 60s (email instant).

---

## 12. Privacy, Compliance, Security

- Operational vs marketing emails separated; marketing requires explicit opt‑in.
- Retention: 180 days (configurable) for notifications; purge job; GDPR export/delete support.
- Security: AuthZ scoped by `userId` and (if applicable) `orgId`/brand; API guarded by JWT/session; server‑side validation.

---

## 13. Rollout Phases

- Phase 1 (MVP): In‑app feed + preferences storage, real‑time updates, post_failed/account_disconnected/token_expiring/payment_failed, email instant for critical.
- Phase 2: Daily/weekly digests, approval workflow notifications, mentions/comments.
- Phase 3: Advanced filters, saved views, snooze, archive, admin org defaults.
- Phase 4: Browser push and Slack integration.

---

## 14. Open Questions

1. Do we need org‑wide default preferences that admins can enforce? (Phase 3)
2. Should approval workflow be part of Phase 1 or Phase 2? (Recommendation: Phase 2)
3. What is acceptable unread count cache staleness? (Propose ≤ 5s)
4. Are marketing product updates desired in‑app? (Default off, digest only)
