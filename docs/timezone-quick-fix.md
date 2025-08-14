# Timezone Quick Fix Guide

## 🔥 Critical Fixes (Do These First!)

### 1. Database Migration (URGENT)
```sql
-- Create migration file: prisma/migrations/fix_timezones/migration.sql

-- Fix all timestamp columns to use timezone
ALTER TABLE "content" 
  ALTER COLUMN "scheduledAt" TYPE timestamptz USING "scheduledAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "postedAt" TYPE timestamptz USING "postedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "campaigns"
  ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "startedAt" TYPE timestamptz USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "completedAt" TYPE timestamptz USING "completedAt" AT TIME ZONE 'UTC';

-- Add timezone preferences
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(50) DEFAULT 'America/New_York';
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "postingTimezone" VARCHAR(50) DEFAULT 'America/New_York';
```

### 2. Update Prisma Schema
```prisma
model User {
  // ... existing fields
  timezone          String   @default("America/New_York")
}

model Brand {
  // ... existing fields  
  postingTimezone   String   @default("America/New_York")
}
```

### 3. Install Required Package
```bash
cd frontend
npm install date-fns-tz
```

### 4. Create Timezone Utility
```typescript
// frontend/src/lib/timezone.ts
import { formatInTimeZone, zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz'
import { format, parseISO } from 'date-fns'

// Get user's timezone (with fallback)
export const getUserTimezone = (): string => {
  // Later: get from user preferences
  // For now: detect from browser
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
}

// Format UTC date for display in user's timezone
export const formatInUserTimezone = (
  utcDate: string | Date,
  formatStr: string = 'MMM d, yyyy h:mm a'
): string => {
  const timezone = getUserTimezone()
  const date = typeof utcDate === 'string' ? parseISO(utcDate) : utcDate
  return formatInTimeZone(date, timezone, formatStr) + ' ' + getTimezoneAbbr(timezone)
}

// Convert user's local time to UTC for storage
export const convertLocalToUTC = (localDate: Date, timezone?: string): Date => {
  return zonedTimeToUtc(localDate, timezone || getUserTimezone())
}

// Get timezone abbreviation (EST, PST, etc)
export const getTimezoneAbbr = (timezone: string): string => {
  const date = new Date()
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short'
  }).format(date)
  return formatted.split(' ').pop() || timezone
}
```

### 5. Fix Campaign Scheduling (Backend)
```typescript
// src/services/campaign.ts - Update generatePostingSchedule method

private generatePostingSchedule(
  startDate: Date,
  endDate: Date,
  frequency: string,
  postingTime: string = '10:00',
  timezone: string = 'America/New_York' // Add timezone parameter
): Date[] {
  const schedule: Date[] = []
  const [hours, minutes] = postingTime.split(':').map(Number)
  
  let current = new Date(startDate)
  
  while (current <= endDate) {
    // Create date in user's timezone
    const scheduledDate = new Date(current)
    scheduledDate.setHours(hours, minutes, 0, 0)
    
    // Convert to UTC for storage (using date-fns-tz on backend too)
    const utcDate = zonedTimeToUtc(scheduledDate, timezone)
    schedule.push(utcDate)
    
    // Move to next date based on frequency
    switch (frequency) {
      case 'daily':
        current.setDate(current.getDate() + 1)
        break
      case 'every-other-day':
        current.setDate(current.getDate() + 2)
        break
      case 'weekly':
        current.setDate(current.getDate() + 7)
        break
    }
  }
  
  return schedule
}
```

### 6. Fix Frontend Display Components

#### CalendarView.tsx
```typescript
import { formatInUserTimezone } from '@/lib/timezone'

// Replace line 44
const displayDate = formatInUserTimezone(item.scheduledAt || item.postedAt!)

// Replace line 122 (autopilot time)
const userTimezone = getUserTimezone()
const nextRun = formatInTimeZone(
  new Date().setHours(2, 0, 0, 0),
  userTimezone,
  'h:mm a zzz'
)
```

#### CampaignCard.tsx
```typescript
import { formatInUserTimezone } from '@/lib/timezone'

// Replace line 285
<span>Started {formatInUserTimezone(campaign.startedAt, 'MMM d')}</span>
```

#### Dashboard.tsx
```typescript
// Update all date displays to use formatInUserTimezone
{formatInUserTimezone(content.scheduledAt)}
```

### 7. Add Timezone Selector Component
```typescript
// frontend/src/components/TimezoneSelector.tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona Time' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'UTC', label: 'UTC' },
]

export function TimezoneSelector({ 
  value, 
  onChange 
}: { 
  value: string
  onChange: (value: string) => void 
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select timezone" />
      </SelectTrigger>
      <SelectContent>
        {TIMEZONES.map(tz => (
          <SelectItem key={tz.value} value={tz.value}>
            {tz.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

## 🎯 Testing Checklist

1. [ ] Create campaign in EST, verify schedules correctly
2. [ ] View from PST browser, confirm shows PST times
3. [ ] Schedule for 11 PM, verify handles day rollover
4. [ ] Test DST transition dates (March/November)
5. [ ] Verify autopilot runs at correct local time
6. [ ] Check calendar shows correct timezone indicator

## ⚠️ Migration Considerations

1. **Existing scheduled content**: Will need to be migrated with assumed timezone
2. **Default timezone**: Suggest America/New_York for US users
3. **API changes**: Ensure mobile apps handle new date format
4. **Communication**: Notify users of timezone feature update

## 📅 Rollout Plan

1. **Day 1**: Deploy database migration
2. **Day 2**: Update backend services
3. **Day 3**: Deploy frontend with timezone support
4. **Day 4**: Enable user timezone settings
5. **Day 5**: Monitor and fix edge cases

---

**Remember**: The golden rule is **STORE IN UTC, DISPLAY IN LOCAL**