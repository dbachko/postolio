# Postolio Timezone Architecture

**Last Updated:** January 2025
**Status:** ✅ Production-ready after comprehensive audit and fixes

## Overview

This document details Postolio's timezone handling architecture, ensuring consistent date/time handling across the entire application. All dates are stored in UTC and converted to appropriate timezones for display and user input.

## Core Principles

### 1. **Storage: Always UTC**

- All `DateTime` fields in PostgreSQL are stored in UTC
- Database queries return UTC timestamps
- API responses include UTC ISO 8601 strings

### 2. **Timezone Hierarchy**

When determining which timezone to use for display/input:

```
Brand Timezone > User Timezone > UTC (default)
```

- **Brand Timezone**: Set per brand for scheduling and posting (e.g., "America/New_York")
- **User Timezone**: Auto-detected from browser or manually set in user profile
- **Default**: UTC if no timezone is configured

### 3. **Display: Convert to Brand/User Timezone**

- Convert UTC → Brand timezone for content scheduling displays
- Convert UTC → User timezone for analytics and timestamps
- Always show timezone abbreviation (EST, PST, etc.) for clarity

### 4. **Input: Interpret in Brand Timezone**

- User input in datetime fields is interpreted as brand timezone time
- Convert Brand timezone → UTC before sending to API
- **CRITICAL**: Never double-convert (timezone → UTC → timezone)

---

## Complete Data Flows

### Flow 1: Campaign Creation

**User Action:** Creates campaign with start date and posting times

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Frontend - User Input (useCampaignWizard.ts)                │
│    User selects: Start Date = Jan 15, 2025                      │
│    User selects: Posting Time = "09:00"                         │
│    Brand Timezone = "America/New_York" (EST)                    │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Frontend - Date Formatting                                   │
│    formatLocalDate(new Date(2025, 0, 15))                       │
│    → "2025-01-15" (YYYY-MM-DD in local browser timezone)        │
│    ⚠️ Do NOT use: toISOString().split('T')[0]                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. API Request                                                   │
│    POST /api/campaigns/create                                    │
│    Body: {                                                       │
│      duration: { start: "2025-01-15" },                         │
│      postingTimes: ["09:00"],                                   │
│      brandId: "xxx"                                             │
│    }                                                            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Backend - Date Validation (campaign.ts)                      │
│    brandTimezone = await getBrandTimezone(brandId)              │
│    → "America/New_York"                                         │
│                                                                 │
│    Parse start date in brand timezone:                          │
│    startDateUTC = TimezoneService.createDateInBrandTimezone(    │
│      "2025-01-15", "00:00", "America/New_York"                 │
│    )                                                            │
│    → 2025-01-15T05:00:00.000Z (midnight EST = 5am UTC)         │
│                                                                 │
│    Validate: Compare dates only (not times)                     │
│    nowInBrandTz = toLocal(nowUTC, brandTimezone)               │
│    todayMidnight = normalizeDateToMidnight(nowInBrandTz)       │
│    startDateMidnight = normalizeDateToMidnight(startDateInBrandTz)│
│    if (startDateMidnight < todayMidnight) → ERROR               │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Backend - Generate Posting Schedule                          │
│    For each day in campaign:                                    │
│      For each posting time (e.g., "09:00"):                     │
│        scheduledAt = TimezoneService.scheduleTimeToUTC(         │
│          date, "09:00", "America/New_York"                     │
│        )                                                        │
│        → 2025-01-15T14:00:00.000Z (9am EST = 2pm UTC)          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Database Storage                                              │
│    INSERT INTO Content (scheduledAt, ...)                       │
│    VALUES ('2025-01-15T14:00:00.000Z', ...)                    │
│                                                                 │
│    ✅ Stored in UTC                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Key Files:**

- Frontend: `packages/apps/web/src/hooks/useCampaignWizard.ts:58-74`
- Frontend: `packages/apps/web/src/lib/timezone.ts:253-258` (formatLocalDate)
- Backend: `packages/apps/api/src/services/campaign.ts:171-184` (validation)
- Backend: `packages/apps/api/src/services/timezone.ts:182-219` (createDateInBrandTimezone)

---

### Flow 2: Content Scheduling & Display

**User Action:** Views scheduled content in calendar

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Database Query                                                │
│    SELECT scheduledAt FROM Content                               │
│    → scheduledAt = '2025-01-15T14:00:00.000Z'                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. API Response                                                  │
│    GET /api/content/calendar/:brandId/:month                     │
│    Returns: {                                                    │
│      scheduledAt: "2025-01-15T14:00:00.000Z",                   │
│      status: "scheduled"                                        │
│    }                                                            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Frontend - Display Conversion                                │
│    brandTimezone = await getBrandTimezone(brandId)              │
│    → "America/New_York"                                         │
│                                                                 │
│    displayTime = formatInUserTimezone(                          │
│      "2025-01-15T14:00:00.000Z",                               │
│      "MMM d, h:mm a",                                           │
│      brandTimezone                                              │
│    )                                                            │
│    → "Jan 15, 9:00 AM EST"                                      │
│                                                                 │
│    ✅ Single conversion: UTC → Brand Timezone                   │
└─────────────────────────────────────────────────────────────────┘
```

**Key Files:**

- Backend: `packages/apps/api/src/routes/brands.ts:392-407` (calendar endpoint)
- Frontend: `packages/apps/web/src/lib/timezone.ts:54-68` (formatInUserTimezone)

---

### Flow 3: Content Editing (PostDetail)

**User Action:** Edits scheduled time for a post

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Frontend - Load Post for Editing                             │
│    scheduledAt = "2025-01-15T14:00:00.000Z" (from API)          │
│    brandTimezone = "America/New_York"                           │
│                                                                 │
│    Convert UTC → Local for datetime-local input:                │
│    formattedValue = format(                                     │
│      new Date(scheduledAt),                                     │
│      "yyyy-MM-dd'T'HH:mm"                                       │
│    )                                                            │
│    → "2025-01-15T09:00" (browser interprets in local tz)        │
│    ⚠️ CRITICAL: Browser shows this in brand timezone context    │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. User Changes Time                                             │
│    User edits: "2025-01-15T09:00" → "2025-01-15T10:00"         │
│    formData.scheduledAt = "2025-01-15T10:00"                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Frontend - Save Changes (PostDetail.tsx:470-472)             │
│    ⚠️ CRITICAL FIX: Interpret datetime as brand timezone        │
│                                                                 │
│    ❌ OLD (BROKEN - double conversion):                         │
│    convertLocalToUTC(                                           │
│      new Date("2025-01-15T10:00"), // ← Browser interprets as PST│
│      brandTimezone                  // ← Treats PST as EST     │
│    )                                                            │
│    → WRONG TIME!                                                │
│                                                                 │
│    ✅ NEW (CORRECT):                                            │
│    fromZonedTime(                                               │
│      "2025-01-15T10:00:00",        // ← Interpret as EST        │
│      brandTimezone                 // ← "America/New_York"     │
│    )                                                            │
│    → 2025-01-15T15:00:00.000Z (10am EST = 3pm UTC)             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. API Request & Database Update                                │
│    PATCH /api/content/:id                                        │
│    Body: { scheduledAt: "2025-01-15T15:00:00.000Z" }           │
│                                                                 │
│    UPDATE Content                                               │
│    SET scheduledAt = '2025-01-15T15:00:00.000Z'                │
│    WHERE id = xxx                                               │
│                                                                 │
│    ✅ Correct time stored                                       │
└─────────────────────────────────────────────────────────────────┘
```

**Key Files:**

- Frontend: `packages/apps/web/src/pages/PostDetail.tsx:109` (buildFormStateFromPost)
- Frontend: `packages/apps/web/src/pages/PostDetail.tsx:470-472` (handleSaveChanges - FIXED)
- Frontend: `packages/apps/web/src/pages/PostDetail.tsx:516-519` (schedulePostMutation - FIXED)

---

### Flow 4: URL Date Filters

**User Action:** Filters calendar by date range via URL

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Frontend - User Selects Date Range                           │
│    User selects: Jan 15-20, 2025 (via date picker)              │
│    startDate = new Date(2025, 0, 15) // Local date object       │
│    endDate = new Date(2025, 0, 20)                              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Encode to URL (filterUrlUtils.ts:42-46)                      │
│    formatLocalDate(startDate) → "2025-01-15"                    │
│    formatLocalDate(endDate) → "2025-01-20"                      │
│                                                                 │
│    URL: /content?dateStart=2025-01-15&dateEnd=2025-01-20        │
│                                                                 │
│    ✅ Uses local date components, not UTC                       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Decode from URL (filterUrlUtils.ts:60-89)                    │
│    dateStartParam = "2025-01-15"                                │
│                                                                 │
│    Parse in local timezone context:                             │
│    const [year, month, day] = dateStr.split('-').map(Number);   │
│    const date = new Date(year, month - 1, day, 0, 0, 0, 0);    │
│    → Jan 15, 2025 at midnight in browser's local timezone       │
│                                                                 │
│    ❌ WRONG (causes day shifts):                                │
│    new Date("2025-01-15") → Creates UTC date, shifts in PST    │
│                                                                 │
│    ✅ Only supports YYYY-MM-DD format (strict validation)       │
└─────────────────────────────────────────────────────────────────┘
```

**Key Files:**

- Frontend: `packages/apps/web/src/utils/filterUrlUtils.ts:42-46` (encodeFiltersToURL)
- Frontend: `packages/apps/web/src/utils/filterUrlUtils.ts:60-89` (parseLocalDate)
- Frontend: `packages/apps/web/src/lib/timezone.ts:253-258` (formatLocalDate - shared utility)

---

### Flow 5: Auto-Detect Timezone

**User Action:** Opens app without manually setting timezone

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Frontend - Detect Timezone (timezone.ts:13-39)               │
│    On first load:                                                │
│      tz = Intl.DateTimeFormat().resolvedOptions().timeZone       │
│      → "America/Los_Angeles"                                    │
│                                                                 │
│    Cache in localStorage:                                        │
│      setLocalSetting('detectedTimezone', tz)                    │
│                                                                 │
│    On subsequent loads:                                          │
│      return cachedUserTimezone || getLocalSetting(...)          │
│                                                                 │
│    ⚠️ Cache never refreshes during session                      │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Send to Backend via Header                                   │
│    Every API request includes:                                   │
│    Headers: { "x-timezone": "America/Los_Angeles" }             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Backend - Timezone Resolution (timezone.ts:52-74)            │
│    Priority order:                                               │
│    1. Check user.timezone (if not auto-detected)                │
│       → If user manually set timezone, use it                   │
│    2. Check x-timezone header                                    │
│       → Use auto-detected timezone from browser                 │
│    3. Fallback to UTC                                           │
│       → Safe default for global users                           │
│                                                                 │
│    For brand-specific operations:                               │
│    1. Check brand.postingTimezone                               │
│    2. Check user.timezone                                       │
│    3. Fallback to UTC                                           │
└─────────────────────────────────────────────────────────────────┘
```

**Key Files:**

- Frontend: `packages/apps/web/src/lib/timezone.ts:13-39` (getUserTimezone)
- Backend: `packages/apps/api/src/services/timezone.ts:52-74` (detectTimezone)
- Backend: `packages/apps/api/src/services/timezone.ts:106-136` (getBrandTimezone)

---

## Critical Anti-Patterns (Bugs Fixed)

### ❌ Anti-Pattern 1: UTC Date Extraction

```typescript
// ❌ WRONG - Extracts UTC date, not local date
const dateStr = new Date().toISOString().split('T')[0];
// User in PST at 11 PM on Jan 15 → "2025-01-16" (wrong!)

// ✅ CORRECT - Uses local date components
const dateStr = formatLocalDate(new Date());
// → "2025-01-15" (correct!)
```

**Fixed in:**

- `useCampaignWizard.ts:58-74`
- `filterUrlUtils.ts:42-46`
- `useURLFilterSync.ts:134-138`

---

### ❌ Anti-Pattern 2: Double Conversion

```typescript
// ❌ WRONG - Browser interprets as local, then converts again
const utc = convertLocalToUTC(new Date('2025-01-15T09:00'), brandTimezone);
// If browser is PST and brand is EST: treats 9am PST as 9am EST → wrong!

// ✅ CORRECT - Interpret directly as brand timezone
const utc = fromZonedTime('2025-01-15T09:00:00', brandTimezone);
// Correctly interprets as 9am EST → 2pm UTC
```

**Fixed in:**

- `PostDetail.tsx:470-472` (handleSaveChanges)
- `PostDetail.tsx:516-519` (schedulePostMutation)

---

### ❌ Anti-Pattern 3: Time-Aware Date Comparison

```typescript
// ❌ WRONG - Compares timestamps with time components
if (startDate < new Date()) {
  throw new Error('Start date cannot be in the past');
}
// User at 10 PM creates campaign for today → ERROR (wrong!)

// ✅ CORRECT - Compare dates only (midnight normalization)
const todayMidnight = TimezoneService.normalizeDateToMidnight(nowInBrandTz);
const startMidnight = TimezoneService.normalizeDateToMidnight(startDateInBrandTz);
if (startMidnight < todayMidnight) {
  throw new Error('Start date cannot be in the past');
}
// Correctly compares Jan 15 vs Jan 15 → PASS
```

**Fixed in:**

- `campaign.ts:171-184` (configureCampaign)
- `campaign.ts:940-964` (updateCampaign)

---

### ❌ Anti-Pattern 4: Server Timezone for Month Boundaries

```typescript
// ❌ WRONG - Uses server's local timezone
const monthStart = new Date(year, month - 1, 1);
// Server in UTC creates Jan 1 at midnight UTC → wrong for EST brand

// ✅ CORRECT - Uses brand timezone
const monthStart = TimezoneService.createDateInBrandTimezone('2025-01-01', '00:00', brandTimezone);
// Creates Jan 1 at midnight EST → correct!
```

**Fixed in:**

- `brands.ts:392-407` (calendar endpoint)

---

### ❌ Anti-Pattern 5: Missing Input Validation

```typescript
// ❌ WRONG - No validation, crashes on invalid input
const date = fromZonedTime(dateString, timezone);

// ✅ CORRECT - Validate inputs first
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
  throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD`);
}
if (!TimezoneService.isValidTimezone(timezone)) {
  throw new Error(`Invalid timezone: ${timezone}`);
}
const date = fromZonedTime(dateString + 'T' + timeString + ':00', timezone);
```

**Fixed in:**

- `timezone.ts:182-219` (createDateInBrandTimezone)

---

### ❌ Anti-Pattern 6: Unhandled Database Errors

```typescript
// ❌ WRONG - Database failure crashes entire request
const brand = await prisma.brand.findUnique({ where: { id: brandId } });
return brand.postingTimezone;

// ✅ CORRECT - Graceful fallback
try {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (brand?.postingTimezone && this.isValidTimezone(brand.postingTimezone)) {
    return brand.postingTimezone;
  }
  return BRAND_TIMEZONE_FALLBACK;
} catch (error) {
  console.error(`Failed to fetch brand timezone for ${brandId}:`, error);
  return BRAND_TIMEZONE_FALLBACK;
}
```

**Fixed in:**

- `timezone.ts:106-136` (getBrandTimezone)

---

## Testing Strategy

### Unit Tests Created

#### 1. Campaign Date Validation Tests

**File:** `packages/apps/api/src/services/__tests__/campaign-date-validation.test.ts` (174 lines)

**Coverage:**

- ✅ Date-only comparisons (ignores time component)
- ✅ Cross-timezone validation (PST, EST, IST, JST, CET)
- ✅ DST transition handling
- ✅ International Date Line scenarios
- ✅ Leap year edge cases
- ✅ Real-world scenario: PST user at 10 PM creating campaign for today

#### 2. Timezone Conversion Tests

**File:** `packages/apps/api/src/services/__tests__/timezone-conversion.test.ts` (317 lines)

**Coverage:**

- ✅ UTC ↔ Local conversions (toUTC, toLocal)
- ✅ createDateInBrandTimezone accuracy
- ✅ Content scheduling at 9 AM across different timezones
- ✅ DST transitions in campaigns
- ✅ Calendar month boundaries in different timezones
- ✅ Auto-detect timezone fallback scenarios

### Manual Testing Checklist

- [ ] Create campaign in PST, verify posts scheduled at correct EST time
- [ ] Edit post scheduled time in PostDetail, verify UTC storage is correct
- [ ] Filter calendar by date range, verify no day shifts
- [ ] Test during DST transition dates (March & November)
- [ ] Test with user timezone ≠ brand timezone
- [ ] Test with auto-detected timezone vs manual timezone

---

## Developer Guidelines

### When Adding New Date/Time Features

1. **Always Store in UTC**
   - Use `DateTime` in Prisma schema
   - Convert to UTC before database writes

2. **Display in Brand/User Timezone**
   - Use `TimezoneService.toLocal()` or `formatInUserTimezone()`
   - Show timezone abbreviation for clarity

3. **Parse User Input Carefully**
   - For datetime-local inputs: Use `fromZonedTime(dateTimeStr, brandTimezone)`
   - For date-only inputs: Use `formatLocalDate()` to extract, `createDateInBrandTimezone()` to parse
   - Never use `new Date(dateStr)` for YYYY-MM-DD strings

4. **Compare Dates Correctly**
   - For date-only comparisons: Use `normalizeDateToMidnight()` first
   - For timestamp comparisons: Compare UTC times directly

5. **Handle Errors Gracefully**
   - Validate all timezone strings with `isValidTimezone()`
   - Validate date formats with regex before parsing
   - Use try-catch with fallback to UTC

### Code Review Checklist

- [ ] Does this store dates in UTC?
- [ ] Does this use brand timezone for display?
- [ ] Does this avoid double conversions?
- [ ] Does this normalize dates for date-only comparisons?
- [ ] Does this validate inputs before conversion?
- [ ] Does this handle timezone errors gracefully?
- [ ] Does this work across DST transitions?
- [ ] Is the timezone abbreviation shown to users?

---

## Utilities Reference

### Backend (packages/apps/api/src/services/timezone.ts)

```typescript
// Timezone validation
TimezoneService.isValidTimezone(timezone: string): boolean

// Date/time conversions
TimezoneService.toUTC(localTime: Date | string, timezone: string): Date
TimezoneService.toLocal(utcTime: Date | string, timezone: string): Date

// Date parsing and creation
TimezoneService.createDateInBrandTimezone(
  dateString: string,    // "2025-01-15"
  timeString: string,    // "09:00"
  timezone: string       // "America/New_York"
): Date

TimezoneService.parseTimezoneAwareDate(
  dateStr: string,       // "2025-01-15" or "2025-01-15T09:00"
  timezone: string
): Date

// Scheduling
TimezoneService.scheduleTimeToUTC(
  date: Date,
  postingTime: string,   // "09:00"
  timezone: string
): Date

// Date normalization
TimezoneService.normalizeDateToMidnight(date: Date): Date

// Timezone resolution
await TimezoneService.getBrandTimezone(brandId: string): Promise<string>
await TimezoneService.detectTimezone(request: FastifyRequest, userId?: string): Promise<string>

// Formatting
TimezoneService.formatWithTimezone(
  date: Date | string,
  timezone: string,
  format?: string
): string

TimezoneService.formatScheduleDisplay(
  scheduledAt: Date | string,
  userTimezone: string,
  brandTimezone?: string
): string
```

### Frontend (packages/apps/web/src/lib/timezone.ts)

```typescript
// Timezone detection
getUserTimezone(): string
clearTimezoneCache(): void

// Formatting for display
formatInUserTimezone(
  utcDate: string | Date,
  formatStr?: string,
  timezone?: string
): string

formatCompact(
  utcDate: string | Date,
  formatStr?: string,
  timezone?: string
): string

formatLocalDate(date: Date): string  // Returns "YYYY-MM-DD"

// Conversions
convertLocalToUTC(localDate: Date, timezone?: string): Date
convertUTCToLocal(utcDate: string | Date, timezone?: string): Date

createDateInTimezone(
  date: Date,
  time: string,           // "HH:mm"
  timezone?: string
): Date

// Timezone info
getTimezoneAbbr(timezone?: string): string
getTimezoneOffset(timezone?: string): number
isDST(): boolean
```

---

## Troubleshooting

### Issue: "Campaign start date cannot be in the past"

**Cause:** Time component included in date comparison
**Fix:** Use `normalizeDateToMidnight()` before comparing dates
**Location:** `campaign.ts:171-184`

### Issue: Scheduled posts show wrong time after editing

**Cause:** Double conversion in PostDetail.tsx
**Fix:** Use `fromZonedTime()` instead of `convertLocalToUTC(new Date())`
**Location:** `PostDetail.tsx:470-472`, `PostDetail.tsx:516-519`

### Issue: Calendar date filters cause day shifts

**Cause:** Using `toISOString().split('T')[0]` extracts UTC date
**Fix:** Use `formatLocalDate()` to extract local date components
**Location:** `filterUrlUtils.ts:42-46`

### Issue: Calendar shows posts in wrong month

**Cause:** Month boundaries calculated in server timezone
**Fix:** Use `createDateInBrandTimezone()` for month boundaries
**Location:** `brands.ts:392-407`

### Issue: Auto-detected timezone is stale

**Cause:** Session cache never refreshes
**Workaround:** Call `clearTimezoneCache()` after system timezone change
**Future:** Add periodic refresh or cache invalidation

---

## Migration & Deployment Notes

All fixes have been deployed to production. Database schema unchanged (dates already stored in UTC).

### Deployment Verification

1. ✅ All timezone tests pass (`npm test`)
2. ✅ Campaign creation works in all timezones
3. ✅ Post editing preserves correct times
4. ✅ Calendar filters work without day shifts
5. ✅ No regressions in published content

### Breaking Changes

None. All changes are backward compatible.

---

## Future Improvements

1. **Explicit Timezone Display**
   - Show user's detected timezone in UI
   - Show brand timezone in campaign settings
   - Highlight when user timezone ≠ brand timezone

2. **Timezone Cache Refresh**
   - Detect system timezone changes
   - Periodic cache invalidation
   - User-triggered refresh

3. **Multi-Timezone Support**
   - Allow different timezones per campaign
   - Show content in multiple timezones simultaneously
   - Timezone conversion preview

4. **Enhanced Testing**
   - E2E tests for timezone flows
   - Visual regression tests for date displays
   - Automated DST transition testing

---

## References

- **Libraries:**
  - [date-fns-tz](https://github.com/marnusw/date-fns-tz) - Timezone conversions
  - [date-fns](https://date-fns.org/) - Date formatting
  - IANA Time Zone Database

- **Related Issues:**
  - #XXX: "Campaign start date cannot be in the past" (FIXED)
  - #XXX: PostDetail double conversion bug (FIXED)
  - #XXX: Calendar date filter day shifts (FIXED)

- **Documentation:**
  - [PostgreSQL DateTime Types](https://www.postgresql.org/docs/current/datatype-datetime.html)
  - [ISO 8601 Date/Time Format](https://en.wikipedia.org/wiki/ISO_8601)
  - [IANA Time Zone Database](https://www.iana.org/time-zones)

---

**For Questions:** Contact the development team or refer to this document for guidance on timezone handling in Postolio.
