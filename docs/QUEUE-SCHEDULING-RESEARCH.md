# Queue Scheduling & Slot-Based Publishing (Research + Plan)

## Why this document exists

Today, Postolio’s composer schedules posts by selecting an exact `scheduledAt` timestamp. Many social media automation tools add a second model: a **queue** backed by **posting time slots** (recurring schedule templates). Users can then:

- Add a post to the “next available” slot (no manual date picking)
- Pick from upcoming available slots (“Tue 9:00 AM”, “Wed 1:30 PM”, …)
- Reorder/prioritize (bump to top, move to next open slot)
- Pause/resume queue scheduling
- Optionally fill gaps and recycle evergreen content

This doc:

1. Summarizes how competitors implement queue slots and prioritization
2. Audits how scheduling works in Postolio today
3. Proposes an implementation approach aligned with our scheduler architecture
4. Lists open questions for brainstorming before we build

**Update (new requirements):**

- Schedule templates need to be **per social account** (not just per platform). We’ll manage these schedules inside each social account’s settings (no separate templates page). For v1 we keep it simple (no copy UI).
- Queue scheduling needs **post-type routing** (e.g., Instagram **Reels-only** time slots), so “Add to queue” places the post into the next available slot that matches its post type.

---

## Glossary (shared language)

- **Schedule (fixed time):** A post has an explicit publish timestamp (e.g., `2025-02-10 09:00`). It’s “locked” to that time unless the user reschedules it.
- **Queue:** An ordered list of posts that will be assigned to future time slots automatically.
- **Slot template:** A recurring rule that defines _when posts can go out_ (e.g., “Mon 09:00”, “Wed 14:30”). Stored as _pattern data_, not a concrete datetime.
- **Slot instance:** A concrete datetime derived from a slot template (e.g., “Mon 09:00 next week” in a specific timezone).
- **Queue-managed scheduling:** `scheduledAt` becomes a _derived_ value computed from queue order + slot templates (typically only for a rolling window).
- **Bump to top / “Next”:** Move a queued post earlier so it is assigned to the earliest available slot instance.
- **Fill gaps:** If there’s an empty slot instance but nothing to publish, show a gap and/or fill it automatically from a pool.
- **Queue category / lane (routing):** a “track” within a queue schedule. In v1, lanes map to `Content.contentType`: `post`, `reel`, `story`. Slots belong to a lane; queued posts are routed to a lane based on post type.

---

## Competitor research (what “queue slots” mean in practice)

### 1) Buffer (Queue + fixed-time scheduling)

Key patterns from Buffer’s docs:

- Multiple scheduling modes in composer: “next available” (append to queue), “top of queue”, “custom day/time”, “now”.
  - Source: https://support.buffer.com/article/642-scheduling-posts
- Queue limits are enforced per channel:
  - Free plans: up to **10** scheduled posts queued at a time
  - Paid plans: up to **5,000** scheduled posts queued at a time
  - Source: https://support.buffer.com/article/642-scheduling-posts
- Multi-channel scheduling creates **separate posts per channel**; you can’t schedule to multiple channels by clicking a specific queue time slot (slots are channel-specific), and edits/deletes are performed per channel after scheduling.
  - Source: https://support.buffer.com/article/644-how-do-i-schedule-posts-for-multiple-social-channels-at-the-same-time
- Queue ordering is a first-class interaction:
  - Drag & drop reordering, swap, move into empty time slot
  - Custom scheduled posts are locked in place
  - “Move to top of queue” and “move to next open publishing time”
  - Source: https://support.buffer.com/article/652-re-ordering-posts-in-your-queue
- Pause/resume is per-channel; resuming re-flows items into the next available time slots while keeping order.
  - Source: https://support.buffer.com/article/515-pausing-your-queue

Takeaway: Buffer treats “queue” as a _schedule template + ordered list_, plus an exception path for fixed-time posts.

---

### 2) SocialPilot (Queues as weekly timeslots + templates)

Key patterns:

- “Schedule queues are timeslots allocated to each day of the week.”
- “Add to Queue” assigns the post to the next timeslot; “Share Next” assigns to the upcoming timeslot from now.
- Queue templates can be created and applied across accounts.
  - Source: https://help.socialpilot.co/article/813-how-to-set-up-auto-scheduling-queues

Takeaway: A queue is fundamentally **per social account**, with reusable schedule templates.

---

### 3) Publer (Posting schedule + queue + labels)

Key patterns:

- Each social account has its own posting schedule; after setup, posts “will simply be added to the posting queue on the next available time slot”.
- Time slots can be associated with labels/types.
  - Source: https://publer.com/help/en/article/how-to-set-up-a-posting-schedule-cxg8y2/
- Time slots can be configured by **post type** (e.g., photos vs videos vs links) to create a “content mix”; auto-scheduling places a post into the next available slot that matches its type (and optionally a label).
  - Source: https://publer.com/blog/auto-scheduling/
- Posting schedules can be duplicated across multiple social accounts (“Duplicate Settings”), which we can add later as a convenience feature.
  - Source: https://publer.com/blog/auto-scheduling/
- Queue limits are enforced per social account on the free plan:
  - Free plans: up to **10** pending scheduled posts at a time per social account
  - Source: https://publer.com/blog/auto-scheduling/
- Special actions:
  - Auto-schedule “at the top of the queue”
  - “Schedule after” a specific date, then publish on the first available time slot after that
  - Source: https://publer.com/help/en/article/how-to-auto-schedule-content-at-the-top-of-the-queue-94pfsu/

Takeaway: Publer supports **post-type filtered time slots** (and optional labels), which enables “different kinds of posts at different times.”

---

### 4) CoSchedule ReQueue (Groups + gap filling)

Key patterns:

- ReQueue is organized around groups:
  - **Placeholder groups:** publish on specific days/times
  - **Intelligent groups:** “fill gaps” in the calendar with frequency controls/limits
- Pause ReQueue while keeping settings; manage gaps when groups run out of messages.
  - Source: https://coschedule.com/support/social-media/requeue/get-started-with-requeue

Takeaway: This is a “queue + automation layer” model: the system schedules messages to _meet a cadence_ and surfaces gaps explicitly.

---

### 5) SocialBee + MeetEdgar (Category-based scheduling / lanes)

Key patterns:

- Users put posts into **categories**, then add those categories into a **weekly posting schedule**. At each scheduled time slot, the system publishes the next post from that category.
  - SocialBee: https://help.socialbee.com/hc/en-us/articles/29979201786903-Content-Categories-All-You-Need-to-Know
- Scheduling UI is effectively “time slots + category to pull from”, enabling a deliberate mix of content types (and evergreen rotation).
  - MeetEdgar: https://www.youtube.com/watch?v=0-cemdhFygg

Takeaway: Many tools model “post type routing” as a more general concept: **category lanes** with their own schedules + ordered content lists.

---

## Competitive feature matrix (high level)

Legend: ✅ supported, ◐ partial/variant, — not emphasized

| Capability                         | Buffer | SocialPilot | Publer | CoSchedule ReQueue |
| ---------------------------------- | -----: | ----------: | -----: | -----------------: |
| Slot templates (weekly schedule)   |     ✅ |          ✅ |     ✅ |                 ✅ |
| Add to next available slot         |     ✅ |          ✅ |     ✅ |                 ✅ |
| “Share next” (upcoming slot)       |      ◐ |          ✅ |      ◐ |                  ◐ |
| “Schedule at top of queue” / bump  |     ✅ |           ◐ |     ✅ |                  ◐ |
| Reorder queue (drag/drop)          |     ✅ |           ◐ |      ◐ |                  ◐ |
| Fixed-time posts treated as locked |     ✅ |           ◐ |      ◐ |                  ◐ |
| Pause/resume queue scheduling      |     ✅ |           ◐ |      ◐ |                 ✅ |
| Categories/labels/groups           |      — |           ◐ |     ✅ |                 ✅ |
| Slot routing by post type/category |      — |           — |     ✅ |                  ◐ |
| Gap visibility / gap filling       |      — |           — |      ◐ |                 ✅ |

---

## How Postolio works today (current state audit)

### Composer scheduling UI

- The composer uses a `datetime-local` input for `scheduledAt` and a “Schedule” button (fixed-time scheduling only today).
  - Web: `packages/apps/web/src/components/post-editor/WriteItBar.tsx`

### API + database scheduling model

- Postgres stores schedule time directly on content:
  - `Content.scheduledAt` (nullable) in `packages/libs/database/prisma/schema.prisma`
- Content creation sets `status = scheduled` when `scheduledAt` is provided.
  - API: `packages/apps/api/src/routes/content/management.ts`
- After create/update, AWS scheduling is performed by calling `schedulerService.scheduleContent(contentId)` which reads `Content.scheduledAt` and creates an EventBridge schedule via the schedule-management service.
  - API: `packages/apps/api/src/utils/content-management.ts` (`handleScheduling`)
  - API: `packages/apps/api/src/services/scheduler.ts`
  - Scheduler microservice: `packages/services/schedule-management/src/services/schedule-service.ts`

### “Publish now”

- We already have publish-now routes (`POST /api/content/:id/publish-now` and group variants) which bypass future scheduling and enqueue publishing immediately through the scheduler pipeline.
  - API: `packages/apps/api/src/routes/content/publish-now.ts`

### Campaign “slots” (we already have a close analog)

We already operate with a “slot” mental model in campaigns:

- Campaign config supports `postingTime` / `postingTimes` and a `frequency`, then we compute upcoming “slots” in brand timezone:
  - API: `packages/apps/api/src/services/slot-utils.ts`
- We generate calendar placeholders for future campaign posts (slots that will be filled later):
  - API: `packages/apps/api/src/services/placeholderService.ts`
- We maintain a rolling window of future campaign posts by selecting slots and scheduling content into them:
  - API: `packages/apps/api/src/services/campaign-sliding-window.ts`

This is very similar to how queue-based schedulers work in competitors: **store cadence rules, then fill upcoming slots with content**.

### Posting time recommendations exist, but aren’t wired into scheduling

- API computes “best times” recommendations in a week-like representation (day-of-week + hour), not concrete datetimes:
  - API: `packages/apps/api/src/services/recommendations.ts` (`PostingTimeRecommendation`)
- Web displays these recommendations in analytics (“Optimal Posting Schedule”) but they are not currently used inside the composer scheduling UI.
  - Web: `packages/apps/web/src/components/analytics/PostingScheduleOptimizer.tsx`

---

## What we should build (product capabilities)

### Minimum set to match the “queue slot” paradigm

1. **Queue schedule configuration**
   - Create **multiple queues per social account** (e.g., Default, Evergreen)
   - For each queue, define weekly time slots by **post type lane** (`post` / `reel` / `story`)
   - Manage schedules inside **Social Account Settings** (no separate templates UI)
     - Create additional queues as needed; each queue starts with an empty weekly calendar
2. **Composer options**
   - Schedule at a fixed datetime (existing)
   - Add to queue (next available slot)
   - Share next (upcoming slot)
   - Schedule at top of queue / bump
   - Publish now (existing)
3. **Queue visibility**
   - Show upcoming slots (and which are available)
   - Show queued items and their predicted slot assignment
4. **Queue operations**
   - Reorder (drag/drop), bump to top, move to next open slot
   - Pause/resume queue scheduling

### “Smart suggestion” integration (timing recommendations)

We should surface “why this time?” directly in scheduling:

- If we have posting time recommendations for a brand, show:
  - Next 3–5 recommended slot instances (local time)
  - Confidence/score explanation
  - One-click “Use recommended slot” actions in the composer

This mirrors competitor “recommended times / autoschedule” UX, while leveraging our existing data.

---

## Proposed implementation approach (aligned with our architecture)

## Decisions (confirmed)

- **Queue scope:** per social account, with **multiple queues per account** (e.g., “Default”, “Evergreen”)
- **Schedule configuration UX:** schedules live in **Social Account Settings** (no separate templates page). Users can configure weekly slots per queue and create additional queues as needed. (We can add a copy-from UX later if needed.)
- **Multi-destination groups + queue:** when a user “adds to queue” for a multi-destination post, we **fan out** and enqueue the **per-destination `Content` rows** into each destination account’s queue (Buffer-style). This means a group can end up with **different scheduled times per destination** (group becomes an identity/UX wrapper, not a scheduling constraint).
- **Post type routing (queue lanes):** lanes map to `Content.contentType` only: `post` / `reel` / `story`. Queue assignment happens per lane so Reels-only slots stay reserved for Reels (Publer/SocialBee-style).
- **Wildcard slot type:** slots can optionally be marked as `laneKey = "any"` (“Any post”). When the scheduler hits an `any` slot, it pulls the **next queued item across lanes** (v1 rule: pick the oldest head item by `PublishingQueueItem.createdAt`).
- **Collision policy:** treat fixed-time and campaign-managed scheduled content as **reserved** time (non-movable by queue engine), scoped **per social account**; queue assignment skips occupied times and offers “Find next available” when a user picks an occupied slot.
- **Limits model:**
  - **Scheduled-ahead cap:** only scheduled posts count against limits; queued drafts do not.
  - **Queue depth cap (includes drafts):** cap the total queued items per social account (across queues) to match competitor expectations (Buffer/Publer). Default:
    - Free: **10** queued posts per social account
    - Paid: **5,000** queued posts per social account
    - Enterprise: effectively unlimited
- **Timezones:** store all `DateTime` values in UTC; compute slot instances using the brand timezone (to respect `dayOfWeek + localTime`), convert to UTC for storage/comparison, and present times in brand timezone in the UI.
- **Failure handling:** publishing failures stay `failed`; users can reschedule (fixed time) or re-queue the post.
- **User mental model:** queue-managed items are **Queued (estimated)** until inside the AWS window, then become **Scheduled** (concrete `scheduledAt` + AWS schedule).
- **Lane edits:** if `contentType` changes, move the item to the **end** of the new lane and recompute; if the lane has no slots, block/convert and prompt the user to add slots.
- **Scheduled edits:** if content changes without changing `scheduledAt`, sync AWS schedule payload via `schedulerService.updateScheduledContent(contentId)`.
- **Queue selection in composer:** for v1, “Add to queue” uses the destination account’s **Default** queue (no multi-queue picker yet). Multi-destination posts still fan out into each destination account’s Default queue.

Recommended default for **K** (tunable):

- `K_global = remainingScheduledCapacityForUser` (plan cap minus current scheduled content), bounded by a sane max like `K_global <= 100`
- Also bound by a time horizon (e.g., “schedule at most the next 14–30 days worth of slots”) to reduce churn when templates change
- When multiple queues exist, schedule the **earliest upcoming** queue-managed posts across queues first until `K_global` is exhausted (everything else remains queued).

This aligns with competitor behavior (queue can be long; only near-term items are “real”) and with our existing “sliding window” campaign model.

### Core design choice: derive time from slot templates + queue order

Competitors store _the pattern_ (slot templates) and _the ordering_ (queue), then compute actual datetimes for publishing.

For Postolio:

- Keep `Content.scheduledAt` as the **derived** timestamp for items that are “queue-managed”
- Keep “fixed-time” scheduling as a separate mode that locks a post to a chosen datetime

### Suggested data model (Postgres)

We likely need 3 concepts (plus optional UI-only “account groups”):

1. **Queue** (per social account; multiple per account)
   - `brandId`, `socialAccountId`, `name`, `paused`
2. **Queue slots** (the queue’s weekly schedule)
   - `dayOfWeek` (0–6), `localTime` (`HH:mm`), `enabled`, `laneKey` (`post` / `reel` / `story` / `any`)
   - must be unique per social account per `(dayOfWeek, localTime)` to prevent two queues scheduling the same account at the same moment
3. **Queue items**
   - `contentId` (per-destination post), `laneKey`, `position` (per lane), `mode` (`queue` vs `fixed`)
   - optionally: `notBefore` (implements “schedule after date”)

Optional: if we want reuse without a separate “templates” UI, we can add a “Copy schedule from…” action that clones queue slots from another queue/account.

Important: this matches what competitors do (account-scoped schedules; post-type filtered slots; category lanes; locked custom schedules).

### Lane routing (how a post lands in the right slots)

We need a deterministic way to assign each queued post to a `laneKey`, so the scheduler can pull the “next post for this slot.”

Recommended v1 approach (simple, matches our current composer):

- Use `Content.contentType` as the primary lane:
  - `post` → `laneKey = "post"`
  - `reel` → `laneKey = "reel"`
  - `story` → `laneKey = "story"`
- Carousels stay in the `post` lane for v1 (no separate `carousel` lane).

If a user tries to “Add to queue” but the target queue has **no slots** for that lane, we should surface a clear error and link them to Settings to add those slots (Publer/SocialBee behave similarly: schedules must exist for the chosen routing).

### Collision policy (confirmed)

We **do** need a collision policy because a given **social account’s** queue slots will inevitably overlap with:

- fixed-time posts (`scheduledAt` chosen by user) targeting that same social account
- campaign/autopilot scheduled posts targeting that same social account
- manual ad-hoc schedules targeting that same social account

Competitor signal (Buffer) strongly suggests this approach:

- Fixed-time (“custom scheduled”) items are **locked** (can’t be dragged in the queue).
- Queue items can be moved around; when repositioned, they can move into **empty time slots** and there are shortcuts to “move to top” and “move to next open publishing time”.
  - Source: https://support.buffer.com/article/652-re-ordering-posts-in-your-queue

**Confirmed approach for Postolio v1 (simple, low-risk):**

- Treat fixed-time and campaign-managed scheduled content as **reserved** time (non-movable by queue engine), scoped **per social account**.
- When assigning queue items to slot instances:
  - compute next slot instances from the queue schedule (brand timezone), including each slot’s `laneKey`
  - **skip reserved/occupied times for that social account**
  - walk slots in chronological order:
    - for lane-specific slots (`post`/`reel`/`story`), assign the next queued item from that lane
    - for `any` slots, assign the next queued item across lanes (oldest head item)
- If a user tries to pick a slot that is occupied, the UI offers **“Find next available”** (default).

**Optional v2 (power-user conflict resolution):**

- If the conflict is with another **queue-managed** item:
  - allow **swap** (swap queue order) or **bump** (push the other one to next free slot)
- If the conflict is with a **fixed/campaign** item:
  - no swap; only “find next available” (or convert to fixed-time override explicitly)

#### Draft Prisma sketch (for discussion)

```prisma
model PublishingQueue {
  id             String   @id @default(cuid())
  brandId         String
  socialAccountId String
  name            String
  paused         Boolean  @default(false)
  copiedFromQueueId String? // audit only ("Copy schedule from…")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  slots         PublishingQueueSlot[]
  items         PublishingQueueItem[]

  @@index([brandId])
  @@index([brandId, socialAccountId])
  @@index([socialAccountId])
  @@map("publishing_queues")
}

model PublishingQueueSlot {
  id             String   @id @default(cuid())
  queueId        String
  socialAccountId String  // denormalize for uniqueness across queues per account
  dayOfWeek      Int      // 0=Sun..6=Sat
  localTime      String   // "HH:mm"
  enabled        Boolean  @default(true)
  laneKey        String   @default("post") // "post" | "reel" | "story" | "any"
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  queue PublishingQueue @relation(fields: [queueId], references: [id], onDelete: Cascade)

  @@index([queueId])
  // Prevent double-booking: one social account can only have one slot at a given day+time across all queues.
  @@unique([socialAccountId, dayOfWeek, localTime])
  @@map("publishing_queue_slots")
}

model PublishingQueueItem {
  id         String   @id @default(cuid())
  queueId    String
  contentId  String
  laneKey    String   @default("post") // "post" | "reel" | "story"
  position   Int      // order within lane
  mode       String   // "queue" | "fixed"
  notBefore  DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  queue PublishingQueue @relation(fields: [queueId], references: [id], onDelete: Cascade)

  @@index([queueId, laneKey, position])
  @@unique([queueId, contentId])
  @@map("publishing_queue_items")
}
```

This is intentionally minimal; we can extend for:

- `locked`/`lockedReason` (fixed-time scheduling)
- fractional ordering / “rank” strategy instead of integer `position`
- `assignedScheduledAt` cache field (if we don’t want to rely on `Content.scheduledAt` for predicted times)
- richer lane routing (e.g., user-defined categories beyond post types; per-platform lane sets)

### Algorithm: compute “available slot instances” and assign them

Given:

- Queue slots across all **active** queues for a social account (weekly; each slot belongs to a `queueId` and has a `laneKey`)
- Brand timezone (slot rules are authored in local time)
- Social account (`socialAccountId`) for conflict checks and uniqueness
- Existing fixed-time scheduled posts (and campaign posts) for that social account that should be treated as occupied
- Queue items per queue (ordered per lane)
- Subscription limits (“max scheduled ahead”)

We compute:

1. Next N slot instances from the queue slots (e.g., next 200), preserving each instance’s `queueId` + `laneKey`
2. Remove occupied/conflicting instances for that social account (conflict window rules)
3. Iterate slot instances in chronological order; for each slot instance, pull the next queue item from that slot’s `queueId` + `laneKey` and assign it until:
   - we hit the subscription scheduling cap, or
   - we hit a rolling “window size” (see below)

### Rolling window scheduling (avoid re-scheduling the entire queue)

We already have a pattern for this via campaigns (sliding window):

- Only schedule the next `K_global` queue-managed items into AWS schedules (earliest upcoming across all queues)
- Keep the rest as queued drafts without `scheduledAt` (but enforce a queue depth cap per social account)
- When one publishes (or a user reorders), recompute only the window

This avoids:

- Massive rescheduling operations when a user drags an item
- Scheduling too far ahead when slot templates may change

### User mental model: “queued” vs “scheduled”

Competitors split into two common models:

- **Time-slot queue (Buffer/SocialPilot/Publer):** adding to queue immediately assigns a concrete datetime (it’s effectively “scheduled” with queue ordering controls).
- **Category/library scheduling (SocialBee/MeetEdgar):** posts can live in a category/queue without a concrete datetime; time slots pull “the next post” at publish time.

For Postolio (because we enforce a scheduled-ahead cap and use a rolling AWS window), the most understandable hybrid is:

- **Queued** (outside the AWS window): visible in the queue with an **estimated** publish time; does **not** count against scheduled-ahead limits; no AWS schedule exists.
- **Scheduled** (inside the AWS window): has a concrete `scheduledAt` + AWS schedule; counts against scheduled-ahead limits.
- **Fixed-time scheduled**: locked to the user-selected `scheduledAt` and treated as reserved time for queues.

### Lane edits (changing a post’s type after queueing)

When `Content.contentType` changes, the post’s `laneKey` changes.

Recommended v1 behavior (simple + predictable):

- If the post is queue-managed:
  - move it to the **end** of the new lane (don’t try to preserve “relative time” across lanes)
  - recompute the rolling window for that social account
- If the new lane has no slots, block the change (or auto-convert to fixed-time) and prompt the user to add lane slots in Settings.

This matches the spirit of category-based schedulers: moving content to another “bucket/lane” changes when it will go out (and some tools let you choose whether new items go to the top or bottom of the list).

- Source: https://help.socialbee.com/hc/en-us/articles/29979201786903-Content-Categories-All-You-Need-to-Know

### Editing scheduled content (AWS schedule payload)

When a post has an AWS schedule, we need to ensure the publisher uses the **latest** caption/media/settings at publish time.

Our current API already supports this pattern:

- If a post is scheduled and the user edits content (caption/media/type/etc) **without changing `scheduledAt`**, we call `schedulerService.updateScheduledContent(contentId)` to sync the AWS schedule payload.
- If `scheduledAt` changes (reschedule), we create/update the AWS schedule as part of scheduling operations, so the new schedule will publish the latest content.

For queue-managed posts, the rule is the same:

- Inside the window: edits should sync the schedule payload.
- Outside the window: no AWS schedule exists yet, so no sync is needed.

### Where “we store data not in time anymore” fits

Slot templates can be stored as “non-time” keys:

- `socialAccountId + dayOfWeek + localTime` (with `laneKey` + `queueId` as metadata) as a canonical slot identifier
- Then compute the next concrete datetime in brand timezone when needed

This is also consistent with our existing posting-time recommendations model (day-of-week/hour).

### Draft API surface (for discussion)

We can implement queue scheduling either by extending the existing composer endpoints or by introducing a dedicated queue API. Two viable directions:

#### Option A: Extend content create/update to support queue modes

- `POST /api/content`
  - existing `scheduledAt` keeps working (fixed-time)
  - new `schedulingMode`:
    - `fixed` (use `scheduledAt`)
    - `queue_next` (assign next available slot in this post’s lane)
    - `queue_top` (insert at top of lane + recompute window)
    - `queue_pick` (client chooses a specific slot instance in this post’s lane)
  - new `queueId` (optional; defaults to the destination account’s “Default” queue)
  - Multi-destination groups: when `targetSocialAccountIds.length > 1` and `schedulingMode` is queue-based, **fan out** and enqueue each destination post into its destination account’s default queue (unless we later add per-destination queue selection).
  - (optional) `notBefore` / `slotInstance` for `queue_pick`

Pros: one entry point for composer flows.  
Cons: mixes queue concerns into content routes.

#### Option B: Dedicated queue endpoints

- `GET /api/queues/:queueId/slots?laneKey=reel&limit=20&after=2025-02-01T00:00:00Z`
  - returns slot instances for a lane, and whether they’re free/occupied + why
- `POST /api/queues/:queueId/items`
  - `{ contentId, laneKey?, mode, position?, notBefore? }`
- `POST /api/queues/:queueId/items/:id/bump`
- `POST /api/queues/:queueId/pause` / `POST /api/queues/:queueId/resume`
- `POST /api/queues/:queueId/recompute` (admin/internal; used by UI + webhooks)

Queue schedule management (account settings UX):

- `GET /api/social-accounts/:socialAccountId/queues`
  - list queues for an account (e.g., “Default”, “Evergreen”)
- `POST /api/social-accounts/:socialAccountId/queues`
  - `{ name }`
- `PUT /api/queues/:queueId`
  - `{ name?, paused? }`
- `PUT /api/queues/:queueId/slots`
  - set/replace a queue schedule (weekly slots; laneKey-aware)
- Optional: `POST /api/queues/:queueId/copy-slots-from`
  - `{ fromQueueId }` (copy schedule from another queue/account)

Pros: clearer separation; easier to evolve.  
Cons: composer needs multi-step interaction (create content → add to queue).

---

## Implementation plan (phased; we should agree before coding)

### Phase 0 — Decisions + RFC (1–2 days)

- Document decisions (this section) in a short RFC and align the code model:
  - Multiple queues per social account
  - Queue schedules live in Social Account Settings (simple, per-account; no copy UI in v1)
  - Collision policy: reserved fixed/campaign times → skip
  - Lane mapping: `Content.contentType` (`post`/`reel`/`story`)
  - Limits: scheduled-ahead cap + queue depth cap
  - Timezones: store UTC; compute using brand tz; present in brand tz
  - Multi-destination: fan out per destination queue
  - Failure handling: stay failed; user reschedules/requeues

Deliverable: internal RFC with data model + slot assignment algorithm + API shapes.

### Phase 1 — MVP: “Add to queue” + “Pick a slot” (1–2 weeks)

- Backend:
  - Add models for:
    - queues (multiple per social account)
    - queue slots (laneKey-aware)
    - queue items (laneKey-aware ordering)
  - Enforce limits:
    - scheduled-ahead cap (existing)
    - queue depth cap per social account (matches Buffer/Publer-style expectations)
  - Optional endpoint: “copy schedule from…” (clone queue slots from another queue/account)
  - Endpoint: “get next available slots” for a queue + lane (conflicts checked per social account)
  - Endpoint: “add to queue” (adds to the correct lane, assigns next available slot in that lane)
  - Multi-destination: when creating a group with “Add to queue”, enqueue each destination `Content` into its destination account queue (fan-out)
  - Implement slot computation using brand timezone (for slot rules) and UTC (for storage/comparisons)
- Web:
  - In Social Account Settings:
    - create/manage queues per social account (Default + custom queues like Evergreen)
    - edit queue schedules by lane (e.g., “Posts / Reels / Stories” tabs for Instagram)
  - In composer, add scheduling modes:
    - Fixed datetime (current)
    - Add to queue (next available slot in this post’s lane)
    - Pick from next 5 available slot instances in this post’s lane
  - Add explanation UI: “This time is recommended because …” (if we have recommendations)

No reorder UI yet; queue is append-only in MVP.

### Phase 2 — Queue management + prioritization (1–3 weeks)

- Queue page/panel:
  - list queue items with predicted assignment
  - bump to top, move to next slot, drag/drop reorder
  - pause/resume queue scheduling
- Backend:
  - windowed re-assignment + reschedule/cancel schedules as needed
  - idempotency + concurrency controls (transaction + deterministic ordering)

### Phase 3 — Advanced lanes + gap handling (optional; 2–4 weeks)

- Add user-defined lanes/categories (SocialBee/MeetEdgar-style) beyond post types
- Expose “gaps” (no content available for a slot) and optionally auto-fill:
  - from evergreen pool
  - from campaign auto-generation (if appropriate)

---

## Suggested next step

With the core decisions above locked in, write a short RFC (data model + endpoints + slot assignment algorithm) and then implement Phase 1 incrementally (social account settings → queues → slots → add-to-queue).
