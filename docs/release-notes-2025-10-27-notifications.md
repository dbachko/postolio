# Release Notes — Notifications & Preferences (2025-10-27)

This release introduces Phase 1 of Notifications: persistent in‑app notifications, real‑time updates, preferences (in‑app and email), and initial critical event emitters. A Notifications bell is now visible in the app header.

## Summary

- In‑app notifications (bell + dropdown + Notification Center)
- Preferences UI (in Settings) with per‑type toggles for in‑app and email
- Real‑time updates via WebSocket (user room) + Redis Streams
- Email delivery for critical events (via SES/SMTP through EmailQueueService)
- Test endpoint to validate end‑to‑end delivery
- Emitters wired for key events: scheduling failures, Instagram disconnects, token expiring

## Backend Changes

- New models (Prisma, Postgres)
  - `Notification`, `NotificationPreference`, `NotificationDelivery`, `UserNotificationState`
  - File: `packages/libs/database/prisma/schema.prisma`
- Services
  - `notifications.ts`: emit/list/mark/markAllRead/preferences
  - `notifications-broadcaster.ts`: WS broadcast + Redis streams
  - `notification-email.ts`: queues email for critical/default-enabled events
- Routes (Fastify)
  - `GET /api/notifications` — list with cursor/filters
  - `PATCH /api/notifications/:id` — read/unread/archived
  - `POST /api/notifications/mark-all-read`
  - `GET /api/notifications/preferences`, `PATCH /api/notifications/preferences`
  - `POST /api/notifications/test` — send test notification
- Event emitters (Phase 1)
  - Scheduling failure → `publishing.scheduling_failed`
  - Instagram account disconnect → `accounts.account_disconnected`
  - Token expiring (<7d / ≤1d) → `accounts.token_expiring`

## Frontend Changes

- New API client: `src/lib/api/notifications-client.ts`
- Store: `src/stores/notificationsStore.ts`
- Components: `components/notifications/Bell.tsx`, `NotificationsDropdown.tsx`
- Page: `pages/Notifications.tsx` (route `/notifications`)
- Settings: Notifications tab with preferences matrix and “Send test notification”
- WebSocket: subscribes to `user:<userId>` and handles `notification_created` and `unread_count`

## Configuration

- Email
  - SES or SMTP must be configured for outbound email. See `docs/AWS_SES_SETUP.md`.
  - Critical events (post failures, disconnects, billing failure, token expiring) default to email if no explicit preference.
- Optional env (future phases)
  - `NOTIFICATIONS_RETENTION_DAYS` (default 180) — not enforced yet; add purge job in Phase 2.
  - `NOTIFICATIONS_DIGEST_HOUR` (default 9) — used when digest is implemented.

## Migration

- Ensure `DATABASE_URL` is set for your target DB
- Create migration for new models and apply:
  - Local dev: `pnpm --filter @postolio/database db:migrate` (or `prisma migrate dev --name notifications`)
  - Prod: apply deploy process as usual (e.g., `prisma migrate deploy` in CI/CD)

## QA Checklist

- Verify bell shows and unread count increments on new events
- Dropdown shows latest 10–20; mark item read updates count immediately
- /notifications page lists all items; mark all as read works
- Settings → Notifications: toggles persist and affect email sending
- Test endpoint sends in-app and email (when configured)
- Scheduling failure, Instagram disconnect, and token expiring generate notifications

## Next (Phase 2)

- Daily/weekly digests, DND windows, admin defaults
- Collaboration events (mentions/comments)
- Archive view, saved filters, snooze
