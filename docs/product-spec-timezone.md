# Timezone & Date Handling Product Specification

## Executive Summary
Fix inconsistent date/time handling across Postolio to ensure scheduled posts execute in users' local timezone, not UTC, following industry standards from Buffer, Hootsuite, and Later.

## Product Overview

- **Purpose**: Enable accurate timezone-aware scheduling for global users
- **Target Users**: Content creators and businesses across different timezones
- **Key Scenarios**: 
  1. User in New York schedules post for 9 AM EST
  2. Team members in different timezones see consistent scheduling
  3. Analytics show performance in user's local time

## Core Features

- **FEAT-1**: User Timezone Preferences — Users can set their default timezone
- **FEAT-2**: Timezone-Aware Scheduling — Posts schedule in user's local time, not UTC
- **FEAT-3**: Visual Timezone Indicators — Clear display of timezone context everywhere
- **FEAT-4**: Brand-Specific Timezones — Set posting timezone per brand/account
- **FEAT-5**: Daylight Saving Time Handling — Automatic DST adjustments

## Jobs To Be Done

- When I schedule a post for 9 AM, I want it to publish at 9 AM in my timezone, so I can reach my audience at optimal times
- When I view my content calendar, I want to see times in my timezone, so I can understand my schedule at a glance
- When I manage multiple brands in different regions, I want per-brand timezone settings, so I can optimize for local audiences
- When daylight saving time changes, I want my scheduled posts to adjust automatically, so I don't miss posting times

## Current Issues (Research Findings)

### Database Issues
- **ISSUE-1**: Using `timestamp` without timezone (stores ambiguous local time)
- **ISSUE-2**: No user timezone preference storage
- **ISSUE-3**: No brand-specific timezone settings

### Frontend Issues
- **ISSUE-4**: Inconsistent date display (toLocaleString, date-fns without TZ)
- **ISSUE-5**: Calendar hardcodes 2 AM for autopilot without timezone context
- **ISSUE-6**: No visual timezone indicators

### Backend Issues
- **ISSUE-7**: Campaign scheduling ignores user timezone
- **ISSUE-8**: Date validation has flawed timezone logic
- **ISSUE-9**: API returns dates without timezone information

## Technical Requirements

### Database Schema Updates
```sql
-- Required changes:
- Change all timestamp columns to timestamptz
- Add users.timezone VARCHAR(50) DEFAULT 'UTC'
- Add brands.postingTimezone VARCHAR(50) DEFAULT 'UTC'
```

### API Standards
- **Format**: ISO 8601 with timezone (`2025-01-15T14:30:00Z`)
- **Storage**: Always UTC in database
- **Response**: Include both UTC and local times with timezone

### Frontend Requirements
- **Library**: date-fns-tz for timezone handling
- **Display**: Always show timezone context (e.g., "9:00 AM EST")
- **Picker**: Timezone selector in user settings

## Success Metrics

- **METRIC-1**: Zero timezone-related scheduling errors — Target: 100% accuracy
- **METRIC-2**: User timezone adoption — Target: 80% set custom timezone within 30 days
- **METRIC-3**: Support tickets for date issues — Target: <5 per month

## Implementation Approach

### Phase 1: Foundation (Week 1)
- Database migration to timestamptz
- Add timezone columns to users/brands tables
- Create timezone utility functions

### Phase 2: Backend (Week 2)
- Update campaign scheduling logic
- Fix date validation
- Standardize API responses

### Phase 3: Frontend (Week 3)
- Add timezone selector component
- Update all date displays
- Add visual timezone indicators

### Phase 4: Testing & Migration (Week 4)
- Migrate existing scheduled content
- Test across multiple timezones
- Deploy with monitoring

## Risks

- **RISK-1**: Data migration of existing schedules → Mitigation: Backup and gradual migration
- **RISK-2**: DST transition bugs → Mitigation: Use battle-tested date-fns-tz library
- **RISK-3**: User confusion during transition → Mitigation: Clear communication and default to UTC

## Constraints

- **Technical**: Must maintain backward compatibility with existing scheduled posts
- **Business**: Complete before Q2 2025 peak scheduling season
- **Performance**: Timezone conversions must not impact page load times

## Industry Standards (Research)

### Buffer Approach
- User-level timezone settings
- Visual calendar with timezone indicator
- Optimal time suggestions per timezone

### Hootsuite Approach
- Account-level timezone settings
- Team timezone coordination
- Bulk scheduling with timezone preservation

### Later Approach
- Visual drag-and-drop with timezone awareness
- Best time to post by timezone
- Multi-timezone preview

## Decisions

- **UX**: Auto-detect timezone from browser + manual override in profile settings
- **Teams**: Each team member sees times in their own timezone (with indicator)
- **Migration**: Grandfather existing schedules (assume they're in UTC)
- **Defaults**: Auto-detect from browser (Intl.DateTimeFormat API)

## Traceability

| Feature | Implementation | Status |
|---------|---------------|---------|
| FEAT-1 | Add user.timezone column with auto-detect, settings UI | Ready |
| FEAT-2 | Update scheduling logic, timezone conversion service | Ready |
| FEAT-3 | Add TZ indicators with team member context | Ready |
| FEAT-4 | Add brand.postingTimezone, per-brand UI | Ready |
| FEAT-5 | Use date-fns-tz for DST handling | Ready |

## Implementation Status

✅ **Product decisions finalized**
✅ **Implementation plan created** (see `timezone-implementation-plan.md`)
✅ **Migration strategy defined** (grandfather existing data)
✅ **5-day rollout plan ready**

---

**Ready to Execute**: Start with Phase 1 - Database migration (safe, non-breaking)