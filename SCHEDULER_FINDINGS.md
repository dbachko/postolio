# Scheduler Microservice - Key Findings Summary

## Critical Facts

### Time Format Expected
- **Input to Schedule-Management**: ISO 8601 UTC format
- **Examples**: `"2025-01-15T22:30:00Z"` or `"2025-01-15T22:30:00+00:00"`
- **Current Validation**: Accepts both with and WITHOUT timezone indicator (potential issue)

### Data Flow
```
API (converts local → UTC)
  ↓ via schedulerAdapter.ts
Schedule-Management Service (assumes UTC)
  ↓ stores in DynamoDB
EventBridge (interprets as UTC)
```

### Two Separate Timezone Layers
1. **API Layer** (`scheduler-adapter.ts`): Handles all timezone conversions
   - Gets brand's timezone
   - Converts user input from local to UTC
   - Sends UTC ISO 8601 string

2. **Schedule-Management** (`schedule-service.ts`): No timezone handling
   - Assumes all times are already UTC
   - Does not perform conversions
   - Stores strings as-is

## Critical Issues Found

### Issue 1: Missing Timezone Indicator Validation (HIGH RISK)
**Problem**: Schedule validator accepts ambiguous formats
- Accepts: `"2025-01-15T22:30:00"` (no timezone indicator)
- Should validate: Must have Z or ±HH:mm

**Impact**: If API sends local time instead of UTC, schedule fires at wrong time

**Location**: `packages/services/schedule-management/src/validators/schedule-validator.ts:50-63`

### Issue 2: JavaScript Date Parsing Ambiguity (MEDIUM RISK)
```typescript
new Date("2025-01-15T22:30:00");    // Parsed as LOCAL server time!
new Date("2025-01-15T22:30:00Z");   // Parsed as UTC
```

**Impact**: If schedule-management runs in EST and receives time without Z:
- Intended UTC time: 2025-01-15T22:30:00Z
- Gets parsed as: 2025-01-15T22:30:00 EST = 2025-01-16T03:30:00Z
- Off by 5 hours!

### Issue 3: No Documentation/Assumptions (MEDIUM RISK)
**Problem**: No comments explaining that schedule-management expects UTC
**Impact**: Maintenance errors, integration mistakes

**Locations**:
- `schedule-service.ts:120` - receives scheduledAt
- `schedule-validator.ts:50` - validates format
- `config.ts:36` - converts to EventBridge

### Issue 4: Milliseconds Silently Dropped (LOW RISK)
**Location**: `config.ts:36-45` `formatEventBridgeScheduleTime()`
```typescript
// Input:  "2025-01-15T22:30:00.123Z"
// Output: "2025-01-15T22:30:00"     // Milliseconds gone
```
**Note**: This is intentional (EventBridge operates at second precision), but undocumented

## Current Safety Nets

### What Works Correctly
1. API Layer (`scheduler-adapter.ts:399-420`)
   - Uses `.toISOString()` which ALWAYS adds Z suffix
   - Converts local time to UTC correctly
   - Stores brand timezone in metadata

2. EventBridge Format Conversion (`config.ts:36-45`)
   - Correctly uses `getUTC*` methods
   - Properly formats for EventBridge

3. DynamoDB Storage
   - Stores strings exactly as received
   - Uses as sort key (allows querying by time)

### Recent Improvements (Commit 2b7d6cf)
- Fixed frontend date handling issues
- Added timezone conversion tests at API layer
- **Gap**: No tests for schedule-management service timezone handling

## Recommendations (Priority Order)

### 1. CRITICAL: Add Timezone Validation
**File**: `schedule-validator.ts`
```typescript
const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
if (!iso8601Pattern.test(request.scheduledAt)) {
  errors.push('scheduledAt must be ISO 8601 UTC with timezone indicator');
}
```

### 2. CRITICAL: Add Documentation
**File**: Top of `schedule-service.ts`
```typescript
/**
 * CRITICAL ASSUMPTION: All scheduledAt times MUST be UTC ISO 8601 with timezone indicator
 * Examples: "2025-01-15T22:30:00Z" or "2025-01-15T22:30:00+00:00"
 * 
 * This service does NOT perform timezone conversions.
 * Timezone handling is done by scheduler-adapter.ts (API layer).
 */
```

### 3. HIGH: Add Runtime Validation
**File**: `schedule-service.ts:155`
```typescript
if (!request.scheduledAt.includes('Z') && !request.scheduledAt.includes('+')) {
  logger.warn('WARNING: scheduledAt missing timezone indicator', {
    contentId: request.contentId,
    scheduledAt: request.scheduledAt,
  });
}
```

### 4. HIGH: Add Unit Tests
**File**: Create `schedule-service.test.ts`
- Test with Z suffix (should pass)
- Test with ±HH:mm (should pass)
- Test without timezone (should fail or warn)
- Test reschedule scenarios

### 5. MEDIUM: Document in CLAUDE.md
Add section explaining time format expectations and flow

## Files Changed Recently

From commit `2b7d6cf`:
- ✓ `timezone-conversion.test.ts` - API layer tests
- ✓ `campaign-date-validation.test.ts` - Campaign date tests
- ✗ No changes to schedule-management service tests

## Key File Locations

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| Validation | `schedule-validator.ts` | 50-63 | Validates format |
| Storage | `schedule-service.ts` | 120-307 | Stores and schedules |
| Conversion | `config.ts` | 36-45 | EventBridge format |
| API Flow | `scheduler-adapter.ts` | 176-420 | Timezone conversion |
| Routes | `content/updates.ts` | 101, 149-151 | Accepts scheduledAt |

## Testing Priorities

Before production deployment:

1. **CRITICAL**
   - [ ] Validate API actually sends Z suffix consistently
   - [ ] Test schedule-management with/without Z
   - [ ] Verify EventBridge times are correct

2. **HIGH**
   - [ ] Test across different server timezones
   - [ ] Test reschedule operations
   - [ ] Verify DynamoDB queries work correctly

3. **MEDIUM**
   - [ ] Load test with 1000+ concurrent schedules
   - [ ] Test DST transitions
   - [ ] Test month boundary queries

## Deployment Impact

### No Changes Needed To:
- EventBridge format conversion (working correctly)
- API layer timezone conversion (working correctly)
- DynamoDB storage (working correctly)

### Changes Needed In:
- Schedule-management validator (add timezone check)
- Schedule-management documentation (add assumptions)
- Unit tests (add format validation tests)

### Backward Compatibility:
- Current system accepts ambiguous formats
- Adding validation might reject previously accepted times
- **Recommendation**: Add warning logs before strict validation

## Summary

The scheduler system correctly uses UTC ISO 8601 format with proper timezone handling at the API layer. However, the schedule-management service has **insufficient validation** to catch timezone errors early. Adding explicit timezone indicator validation and clear documentation will significantly improve reliability.

**Risk Level**: MEDIUM (Current safeguards work but insufficient documentation/validation)
**Effort to Fix**: LOW (Simple regex validation + comments)
**Impact of Not Fixing**: MEDIUM (Could accept incorrectly formatted times silently)
