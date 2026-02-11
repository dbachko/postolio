# Demo Mode & Onboarding Architecture

This document describes how **Demo Mode** and the **first‑time onboarding flow** work end‑to‑end, including:

- Per‑user demo brands and content seeding
- Analytics/metrics seeding for realistic dashboards
- Demo images stored in the repo and synced to S3
- Frontend onboarding UX and route guards

It is intended for future developers and agents working on onboarding, demo experiences, and related experiments.

---

## High‑Level Flow

1. A new user signs up and logs in.
2. On first navigation to any app route, `OnboardingGuard` checks onboarding status via `/api/onboarding/status` and redirects to `/onboarding` if:
   - The user has **no brands**, or
   - They have a brand but **no social accounts**.
3. On `/onboarding` the user chooses between:
   - **Set up your brand** (real brand + social connect), or
   - **Explore Demo Mode** (per‑user demo workspace).
4. Choosing **Demo Mode**:
   - Calls `POST /api/onboarding/demo`.
   - Creates (or reuses) a **demo brand** and **demo Instagram social account**.
   - Seeds posts, analytics, and demo images.
   - Redirects the user into the main app in Demo Mode.
5. In Demo Mode:
   - A top banner is shown across the app.
   - Email verification banner is hidden.
   - All content is editable but never publishes to real social platforms.
6. When the user clicks “Exit demo & set up my brand”:
   - They are sent back to `/onboarding`.
   - Onboarding detects `status === 'demo'` and shows **Step 1 (create real brand)** directly.

---

## Backend – Onboarding Status & Demo Brand

### Onboarding status endpoint

**File:** `packages/apps/api/src/routes/onboarding.ts`

**Endpoint:** `GET /api/onboarding/status`

- Computes an onboarding summary per user from the main DB:
  - `status`: `'no_brand' | 'brand_no_social' | 'complete' | 'demo'`
  - `realBrandCount`: number of non‑demo brands
  - `instagramConnected`: true if any real brand has an Instagram `SocialAccount`
  - `activeBrandId`: recommended brand to focus on
  - `demoBrandId`: demo brand (if any)
- Uses `Brand.preferences` to detect demo brands:

  ```ts
  {
    isDemo: true,
    demoVariant: 'default',
    onboarding: { isDemo: true, createdAt: ... }
  }
  ```

### Demo mode endpoint

**File:** `packages/apps/api/src/routes/onboarding.ts`

**Endpoint:** `POST /api/onboarding/demo`

Behavior:

1. Loads the current user’s brands.
2. If any non‑demo brand exists, returns:
   - `demo_not_allowed_with_real_brand`
   - This prevents mixing demo workspaces with accounts that already started real setup.
3. Otherwise:
   - Reuses an existing demo brand or creates a new one:

     ```ts
     const variant: DemoVariantId = 'default';
     demoBrand = await prisma.brand.create({
       data: {
         name: 'Postolio Demo Brand',
         description: 'Sample brand for exploring Postolio features with demo data.',
         userId,
         preferences: {
           isDemo: true,
           demoVariant: variant,
           onboarding: { isDemo: true, createdAt: new Date().toISOString() },
         },
       },
       ...
     });
     ```

   - Ensures a **demo Instagram SocialAccount** exists for this brand with `metadata.isDemo = true`.
   - Calls `seedDemoWorkspace({ brandId, userId, variantId: 'default' })`.
   - Returns a structured `onboarding` payload with `status: 'demo'`.

---

## Backend – Demo Workspace Seeding

### Demo seed service

**File:** `packages/apps/api/src/services/demo-seed.ts`

**Exported API:**

```ts
export type DemoVariantId = 'default';

export interface SeedDemoWorkspaceOptions {
  brandId: string;
  userId: string;
  variantId?: DemoVariantId;
  includeAnalytics?: boolean; // default true
}

export async function seedDemoWorkspace(options: SeedDemoWorkspaceOptions): Promise<void>;
```

### Idempotency

`seedDemoWorkspace` is **per‑brand idempotent**:

- It checks `content` count for the brand:

  ```ts
  const contentCount = await prisma.content.count({ where: { brandId } });

  if (contentCount > 0) {
    return;
  }
  ```

- If either is non‑zero, **no further seeding occurs**.
- This allows multiple calls to `/api/onboarding/demo` without duplicating data.

### Seeded posts

For `variantId: 'default'`, `seedDemoWorkspace` seeds:

- **Posts**
  - 2 published posts in the recent past (launch).
  - 1 scheduled post in the near future (launch).
  - 2 drafts for evergreen education.
  - Each post:
    - Uses `generationParams.isDemo = true`.
    - Gets a demo image (see below).

---

## Backend – Demo Analytics & Metrics

If `includeAnalytics !== false`, `seedDemoWorkspace` also seeds:

1. **Publications and latest metrics** for each published demo post:
   - Creates `ContentPublication` rows tied to the demo `SocialAccount`.
   - Creates `PublicationMetricsLatest` rows with realistic metrics:
     - impressions, reach, likes, comments, saves, shares, engagement, engagementRate.

2. **Account‑level metric samples (`AccountMetricSample`):**
   - 7‑day follower timeline (`metricName: 'followers'`).
   - 7‑day impressions and reach per day.

3. **Account metrics snapshot (`AccountMetricsLatest`):**
   - Latest followers, impressions, reach, profileViews, lastUpdated.

These feed existing analytics v2 endpoints:

- `GET /api/analytics/brands/:brandId/summary`
- `GET /api/analytics/brands/:brandId/account/series`
- `GET /api/analytics/brands/:brandId/audience`
- `GET /api/analytics/brands/:brandId/top-publications`

You can turn analytics seeding off (for testing) by passing `includeAnalytics: false` when calling `seedDemoWorkspace`.

---

## Demo Images – Storage & S3 Sync

### Goals

- Keep demo images in the **codebase** for traceability and version control.
- Sync them to the S3 assets bucket **once per environment**, idempotently.
- Support adding/removing images over time without manual S3 work.

### Local demo images (in repo)

- Place demo images under:
  - `packages/apps/assets-api/demo-assets/`

  Example (current default set aligned with seed mapping):
  - `post-welcome.png`
  - `post-testimonial.png`
  - `post-bts.png`
  - `post-tip.png`
  - `post-checklist.png`

These filenames are referenced by the demo seed service and the image generator script.

### S3 sync script

**File:** `packages/apps/assets-api/src/scripts/sync-demo-assets.ts`  
**Script:** `pnpm --filter @postolio/assets-api run sync:demo-assets`

Behavior:

- Reads all files in `demo-assets/`.
- Maps each file to an S3 key:

  ```ts
  const DEMO_S3_PREFIX = process.env.DEMO_ASSETS_PREFIX || 'system/demo/default';
  // Files → `${DEMO_S3_PREFIX}/${fileName}`
  ```

- Lists existing objects under that prefix in `assetsBucketName`.
- **Uploads/overwrites** all local files via `PutObjectCommand`.
- **Deletes** any remote keys under that prefix that are no longer present locally.
- Supports **dry run**:

  ```bash
  DRY_RUN=1 pnpm --filter @postolio/assets-api run sync:demo-assets
  ```

  This only logs intended changes.

**Environment variables:**

- `ASSETS_S3_BUCKET` or `S3_BUCKET`: the target assets bucket.
- `ASSETS_CDN_DOMAIN` or `CDN_DOMAIN` (optional, for URL construction).
- `DEMO_ASSETS_PREFIX` (optional, default `system/demo/default`).
- `DRY_RUN=1` for non‑destructive preview.

### Mapping S3 keys to demo posts

The demo seed service uses a simple mapping from **post index → demo image file name**.

In `demo-seed.ts`:

```ts
const DEMO_IMAGE_FILES = [
  'post-welcome.png',
  'post-testimonial.png',
  'post-bts.png',
  'post-tip.png',
  'post-checklist.png',
];

function getDemoAssetUrlByIndex(index: number): string | null {
  const fileName = DEMO_IMAGE_FILES[index % DEMO_IMAGE_FILES.length];
  const s3Key = `${DEMO_ASSETS_PREFIX}/${fileName}`;
  // Build CDN URL from env (ASSETS_CDN_DOMAIN / ASSETS_S3_BUCKET / S3_BUCKET)
}
```

When creating posts, `seedDemoWorkspace` calls `getDemoAssetUrlByIndex` and sets:

```ts
primaryAssetId: null,
primaryAssetCdnUrl: cdnUrl,
```

So, by default:

- First published post (welcome) → `post-welcome.png`
- Second published (testimonial) → `post-testimonial.png`
- Scheduled BTS post → `post-bts.png`
- Educational tip draft → `post-tip.png`
- Checklist/evergreen draft → `post-checklist.png`

These URLs are rendered in the calendar, content library, and post detail UI just like real assets.

### Adding/Removing demo images – workflow

1. Add or remove image files in:
   - `packages/apps/assets-api/demo-assets/`

   and, if needed, update `DEMO_IMAGE_FILES` in `demo-seed.ts` to reflect new names/order.

2. Run sync in the target environment:

   ```bash
   # Preview:
   DRY_RUN=1 pnpm --filter @postolio/assets-api run sync:demo-assets

   # Apply:
   pnpm --filter @postolio/assets-api run sync:demo-assets
   ```

3. New demo users (or freshly seeded demo brands) will now see the updated images.

---

## Frontend – Onboarding UX & Guards

### Route guard

**File:** `packages/apps/web/src/App.tsx`

- `OnboardingGuard` wraps all authenticated app routes:
  - Fetches `/api/onboarding/status` via `useOnboardingStatus`.
  - If status is `'no_brand'` or `'brand_no_social'`, redirects to `/onboarding`.
  - If status is `'demo'`, allows full navigation (but shows Demo Mode banner).

### Onboarding page

**File:** `packages/apps/web/src/pages/Onboarding.tsx`

- Uses:
  - `useOnboardingStatus` (onboarding state).
  - `brandApi.getBrands()` (brands list).
  - `onboardingApi.startDemo()` (POST `/api/onboarding/demo`).
- Steps:
  - **Choice** (only when status is `'no_brand'`):
    - Card 1: “Set up your brand”.
    - Card 2: “Explore Demo Mode”.
  - **Brand creation** (Step 1 of 2):
    - When status is `'no_brand'` or `'demo'`.
    - No back button to demo once a brand is in progress.
  - **Connect social accounts** (Step 2 of 2):
    - Always shown for `step === 'connect'`.
    - Back button only when status is still `'no_brand'`.

### Demo loading UI

When the user clicks **Enter demo mode**:

- `demoMutation.isPending` becomes true.
- A helper card appears below the choices:
  - “Preparing your demo workspace…”
  - A short list of tips:
    - Edit demo posts freely (never publish).
    - Try scheduling posts.
    - When ready, create your own brand to switch to a real workspace.

### Demo Mode banner

**File:** `packages/apps/web/src/components/DemoModeBanner.tsx`

- Visible when:
  - User is authenticated, and
  - `onboarding.status === 'demo'`, and
  - Route is **not** `/onboarding`.
- Copy:

  > You’re in Demo Mode. Explore a sample brand with fake social data, or switch to your own brand when you’re ready.

- CTA:
  - “Exit demo & set up my brand” → navigates to `/onboarding`.

### Email verification banner behavior

**File:** `packages/apps/web/src/components/EmailVerificationBanner.tsx`

- Fetches onboarding status.
- If `onboarding.status === 'demo'`, returns `null`.
- This avoids confusing demo users with a “Verify your email” gate when they’re just exploring.

---

## Future Extensions & Experiments

### Multiple demo variants

The seed service is designed to support multiple demo scenarios:

- Extend `DemoVariantId`:

  ```ts
  export type DemoVariantId = 'default' | 'ecommerce' | 'creator';
  ```

- Add new seed definitions and post captions/styles to reflect different use cases.
- In `/api/onboarding/demo`, choose a variant (e.g., via hash on `userId` and configured weights) and store it in `Brand.preferences.demoVariant`.

### Experiment instrumentation

When you add variant assignment, log key events with `demoVariant`:

- `demo_started`
- `demo_brand_seeded`
- `real_brand_created`
- `social_connected`

This will let you compare conversion funnels between demo variants.

---

## Quick Reference – Key Files

- Backend:
  - `packages/apps/api/src/routes/onboarding.ts`
  - `packages/apps/api/src/services/demo-seed.ts`
  - `packages/libs/database/prisma/schema.prisma` (Brand, SocialAccount, metrics models)
  - `packages/apps/assets-api/src/utils/s3.ts`
  - `packages/apps/assets-api/src/scripts/sync-demo-assets.ts`

- Frontend:
  - `packages/apps/web/src/App.tsx` (OnboardingGuard + routes)
  - `packages/apps/web/src/pages/Onboarding.tsx`
  - `packages/apps/web/src/components/DemoModeBanner.tsx`
  - `packages/apps/web/src/components/EmailVerificationBanner.tsx`
  - `packages/apps/web/src/hooks/useOnboardingStatus.ts`

Use this doc as the starting point before making changes to onboarding, demo seeding, or demo assets. It should help keep demo behavior consistent and understandable as the feature evolves.+
