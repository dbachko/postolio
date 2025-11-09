# Timezone Auto-Detection: Comprehensive Trace & Analysis

## Executive Summary

When a user relies on auto-detected timezone (not manually set), the system follows this flow:

1. **Frontend detects** browser timezone via `Intl.DateTimeFormat`
2. **Frontend sends** timezone via `X-Timezone` header on ALL API requests
3. **Backend receives** header and uses it to interpret dates
4. **Brand timezone** gets auto-set on first campaign creation if not explicitly set
5. **Display** shows brand timezone (not user's personal timezone)

**Result:** Correct scheduling (stored as UTC), but potential confusion about which timezone is being displayed.

---

## Key Files Involved

### Frontend

- `/packages/apps/web/src/lib/timezone.ts` - Browser timezone detection + session caching
- `/packages/apps/web/src/lib/http/timezone.ts` - HTTP layer timezone caching (30s)
- `/packages/apps/web/src/lib/http/http.ts` - Adds X-Timezone header to all requests
- `/packages/apps/web/src/contexts/TimezoneContext.tsx` - React context for timezone
- `/packages/apps/web/src/components/ContentCard.tsx` - Display with brand timezone
- `/packages/apps/web/src/components/ContentCalendar.tsx` - Calendar shows both TZs

### Backend

- `/packages/apps/api/src/services/timezone.ts` - Timezone business logic
- `/packages/apps/api/src/routes/campaign.ts` - Campaign creation (auto-sets brand TZ)
- `/packages/apps/api/src/routes/user.ts` - User/brand timezone CRUD
- `/packages/apps/api/src/routes/auth.ts` - Login auto-detection
- `/packages/apps/api/src/routes/brands.ts` - Calendar endpoint (uses brand TZ)

---

## Complete Timezone Detection Flow

### Step 1: User Registration or Login

**Frontend:** Detects browser timezone via Intl API

```
Browser TZ: America/Los_Angeles (detected)
```

**Backend:** Receives X-Timezone header

```
POST /api/auth/login
Headers: { X-Timezone: "America/Los_Angeles" }
```

**Backend Logic (auth.ts:225-246):**

- If user has no timezone OR `timezoneAutoDetected = true`
- Call `TimezoneService.detectTimezone(request, userId)`
- Save to DB: `user.timezone = "America/Los_Angeles"`, `timezoneAutoDetected = true`

---

### Step 2: User Opens Calendar

**Frontend:**

1. Calls `useTimezone()` hook from TimezoneContext
2. Gets `userTimezone = getUserTimezone()`
3. Queries backend for brand timezone
4. Falls back to user timezone if brand has none

**Display:**

```
Times shown in PST (America/Los_Angeles).
Brand posting timezone: PST (America/Los_Angeles).
```

---

### Step 3: User Creates Campaign

**Frontend sends:**

```
POST /api/campaigns
X-Timezone: America/Los_Angeles
Body: { duration: { start: "2025-01-15", end: "2025-02-15" }, ... }
```

**Backend Processing:**

1. Get brand timezone: `TimezoneService.getBrandTimezone(brandId)`
   - If brand has `postingTimezone`: use it
   - Else: returns "UTC"

2. If brand TZ is UTC, detect from header:

   ```
   const detectedTimezone = TimezoneService.detectTimezone(request)
   // Returns X-Timezone header value
   ```

3. Auto-save to brand:

   ```
   await prisma.brand.update({
     data: { postingTimezone: detectedTimezone }
   })
   ```

4. Parse dates in brand timezone:
   ```
   parseTimezoneAwareDate("2025-01-15", "America/Los_Angeles")
   // = 2025-01-15T00:00:00 PST
   // Converts to UTC: 2025-01-15T08:00:00Z
   ```

**Result:** Campaign stored with correct UTC time

---

## Critical Issues Identified

### Issue #1: Session-Level Cache Doesn't Detect Runtime Timezone Changes

**File:** `/packages/apps/web/src/lib/timezone.ts:7-26`

```typescript
let cachedUserTimezone: string | null = null;

export const getUserTimezone = (): string => {
  if (cachedUserTimezone) {
    return cachedUserTimezone; // ❌ Never refreshes
  }
  // First call detects, caches forever
  cachedUserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return cachedUserTimezone;
};
```

**Problem:** If user's browser timezone changes mid-session (travel, system settings), app won't detect it.

**Scenario:** User travels PST → EST

- Session cache returns PST indefinitely
- API calls still send PST timezone
- Campaign created with PST dates
- Requires page reload to fix

---

### Issue #2: Campaign Dates Use Brand Timezone, Not User Timezone

**Files:** `campaign.ts:245`, `timezone.ts:182-219`

**Problem:** When user submits campaign with posting time "14:00", backend interprets in brand timezone, not user timezone.

**Scenario:**

- User in PST, brand timezone EST
- User submits: `"2025-01-15"`, postingTime `"14:00"` (meaning 14:00 PST)
- Backend parses as: `2025-01-15 14:00 EST` (wrong!)
- Actual difference: 3 hours off from user's intent

**Why:** Backend uses `getBrandTimezone()` priority:

1. Brand timezone (EST)
2. Detected timezone from header (would be PST)
3. UTC fallback

It picks brand TZ instead of user TZ.

---

### Issue #3: Display Shows Brand Timezone, User Sees Wrong Time

**File:** `ContentCard.tsx:156`

```typescript
formatInUserTimezone(content.scheduledAt, format, brandTimezone);
// Function name says "UserTimezone" but uses passed timezone (brand)
```

**Scenario:**

- User in PST, Brand EST
- Content scheduled for 14:00 EST
- Display shows: "Jan 15, 2:00 PM EST"
- User thinks: "That's 11:00 AM PST for me"
- Confusing because showing brand time, not user time

---

### Issue #4: Brand Timezone Auto-Set Without User Confirmation

**File:** `campaign.ts:173-202`

```typescript
if (brandTimezone === 'UTC') {
  const detectedTimezone = await TimezoneService.detectTimezone(request, userId);

  // Auto-saves without asking
  await prisma.brand.update({
    data: { postingTimezone: detectedTimezone },
  });
}
```

**Problem:** User doesn't explicitly set brand timezone, but it's set automatically based on detected TZ.

Could be wrong if:

- User on VPN in different timezone
- Corporate proxy reports different timezone
- User prefers brand in specific timezone

---

### Issue #5: Two Layers of Caching Don't Sync

**Caching layers:**

1. **Session cache** (lib/timezone.ts) - Never expires, never checks actual browser TZ
2. **HTTP layer cache** (lib/http/timezone.ts) - 30-second cache using localStorage

When these disagree, behavior is inconsistent.

---

## Data Flow Examples

### Example 1: PST User Creates Campaign

```
1. Frontend: getUserTimezone() = "America/Los_Angeles"
2. Frontend: POST /api/campaigns with X-Timezone header
3. Backend: detectTimezone() reads X-Timezone = "America/Los_Angeles"
4. Backend: Brand has no TZ, so auto-set to "America/Los_Angeles"
5. Backend: Parse "2025-01-15" as PST → 2025-01-15T08:00:00Z (UTC)
6. Display: Shows "Jan 15, 2025 12:00 AM PST" ✓ Correct
```

### Example 2: PST User, EST Brand

```
1. Frontend: getUserTimezone() = "America/Los_Angeles"
2. Frontend: POST /api/campaigns with X-Timezone header
3. Backend: getBrandTimezone() returns "America/New_York" (EST)
4. Backend: Ignores X-Timezone header, uses brand TZ (EST)
5. Backend: Parse "2025-01-15" as EST → 2025-01-15T05:00:00Z (UTC)
6. Frontend: Parses UTC time, displays in brand TZ: "Jan 15, 2025 12:00 AM EST"
7. User in PST: Sees "midnight EST" which is 9 PM previous day for them
8. Result: 3-hour discrepancy from user intent ❌
```

### Example 3: User Changes Browser Timezone Mid-Session

```
1. User in PST, cache = "America/Los_Angeles"
2. User changes system timezone to EST
3. Frontend: getUserTimezone() returns cached PST ❌
4. Frontend: X-Timezone header still sends PST for entire session
5. User creates campaign with wrong timezone
6. Result: Campaign dates off by 5 hours ❌
```

---

## Recommendations

### 1. Fix Timezone Caching (MEDIUM PRIORITY)

```typescript
// packages/apps/web/src/lib/timezone.ts
export const getUserTimezone = (): string => {
  const currentTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Check if browser timezone changed
  if (cachedUserTimezone && cachedUserTimezone !== currentTz) {
    console.warn('Browser timezone changed, updating cache');
    cachedUserTimezone = currentTz;
    setLocalSetting('detectedTimezone', currentTz);
  } else if (!cachedUserTimezone) {
    cachedUserTimezone = currentTz;
    setLocalSetting('detectedTimezone', currentTz);
  }

  return cachedUserTimezone;
};
```

### 2. Use User Timezone for Campaign Date Parsing (HIGH PRIORITY)

Currently: Brand timezone
Proposed: User timezone (from X-Timezone header)

```typescript
// campaign.ts:245
const dateParsingTz =
  request.headers['x-timezone'] ||
  (await TimezoneService.getBrandTimezone(brandId)) ||
  DEFAULT_TIMEZONE;

const config: CampaignConfig = {
  duration: {
    start: TimezoneService.parseTimezoneAwareDate(
      body.duration.start,
      dateParsingTz // Use user/detected TZ, not brand TZ
    ),
  },
};
```

### 3. Show Relative Timezone in Display (MEDIUM PRIORITY)

```typescript
// Instead of formatInUserTimezone(..., brandTimezone)
formatWithRelativeTimezone(
  scheduledAt,
  userTimezone, // "America/Los_Angeles"
  brandTimezone // "America/New_York"
);
// Output: "2:00 PM EST (11:00 AM your time)"
```

### 4. Require Explicit Brand Timezone (LOW PRIORITY)

```typescript
// Don't auto-set on campaign creation
// Show user confirmation dialog instead:
if (brand.postingTimezone === null) {
  Show: 'Set brand timezone to America/Los_Angeles?'[('Yes', 'Set manually', 'Cancel')];
}
```

### 5. Add Timezone Mismatch Warning (LOW PRIORITY)

```typescript
if (userTimezone !== brandTimezone) {
  Display warning: "You're in PST but this brand posts in EST"
}
```

---

## Testing Checklist

- [ ] User in PST creates campaign → stored with correct UTC time
- [ ] User changes browser timezone mid-session → app uses new timezone
- [ ] User in PST, brand in EST → dates parsed in PST (user intent)
- [ ] Display shows "time (your time)" when TZs differ
- [ ] Brand timezone doesn't get auto-set without confirmation
- [ ] X-Timezone header present on all requests
- [ ] Timezone persists across page reloads

---

## Files to Monitor

1. `packages/apps/web/src/lib/timezone.ts` - Session caching
2. `packages/apps/web/src/lib/http/timezone.ts` - HTTP caching
3. `packages/apps/api/src/routes/campaign.ts` - Campaign creation timezone logic
4. `packages/apps/web/src/components/ContentCard.tsx` - Display timezone
5. `packages/apps/api/src/services/timezone.ts` - Backend timezone logic
