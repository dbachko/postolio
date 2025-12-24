# Analytics Architecture (Account-First Redesign)

**Status**: ✅ Implemented
**Date**: December 22, 2024
**Version**: 2.0.0

## Overview

The analytics system has been redesigned to follow an "Account-First" architecture that scales seamlessly across multiple social media platforms (Instagram, Facebook, LinkedIn, X, YouTube, TikTok, etc.).

### Key Principles

1. **Account-First**: Analytics always viewed at the per-account level
2. **Platform Agnostic**: Common components work across all platforms
3. **Scalable**: Easy to add new platforms without architectural changes
4. **No Overview Tab**: Removed platform-specific tabs (Instagram, Facebook, etc.)

## Architecture

### Routing Structure

```
/analytics
  → Redirects to /analytics/accounts/:firstAccountId

/analytics/accounts/:socialAccountId
  → Main analytics page with tabs:
     - Overview (rich dashboard)
     - Posts (performance table)
     - Insights (AI analysis)
     - Recommendations (optimization tips)
     - Forecasts (predictive analytics)
```

### Component Organization

```
packages/apps/web/src/
├── components/
│   ├── analytics-common/           # Platform-agnostic components
│   │   ├── index.ts               # Barrel export
│   │   ├── KPICard.tsx
│   │   ├── AccountHealthScore.tsx
│   │   ├── TopPostsGrid.tsx
│   │   ├── PostsPerformanceTable.tsx
│   │   ├── InsightsPanel.tsx
│   │   ├── RecommendationsPanel.tsx
│   │   ├── ForecastCharts.tsx
│   │   ├── GrowthProjectionCard.tsx
│   │   ├── MultiMetricTimeSeriesChart.tsx
│   │   ├── TimeSeriesChart.tsx
│   │   └── MetricsCard.tsx
│   │
│   └── analytics/                  # Legacy brand-level components
│       ├── BrandHealthScore.tsx
│       ├── ActivityHeatmap.tsx
│       ├── PostingScheduleOptimizer.tsx
│       └── CampaignCard.tsx
│
├── features/analytics/
│   ├── platforms/                  # Platform-specific components
│   │   ├── instagram/
│   │   │   ├── index.ts
│   │   │   └── HashtagAnalysis.tsx
│   │   ├── facebook/
│   │   │   └── index.ts           # Placeholder for Facebook components
│   │   └── common/
│   │       ├── index.ts
│   │       └── AudienceInsights.tsx
│   │
│   ├── components/
│   │   └── AnalyticsAccountOverviewTab.tsx  # Simplified tab component
│   │
│   ├── hooks.ts                    # React Query hooks
│   ├── types.ts                    # TypeScript types
│   ├── platforms.ts                # Platform configuration module
│   └── utils.ts                    # Utility functions
│
└── pages/
    ├── Analytics.tsx               # Redirect to first account
    └── AnalyticsAccount.tsx        # Main analytics page
```

## Data Flow

### 1. Page Load

```
User → /analytics
  ↓
Analytics.tsx loads connected accounts
  ↓
Redirects to /analytics/accounts/:firstAccountId
  ↓
AnalyticsAccount.tsx loads with account selector
```

### 2. Data Fetching (React Query)

```typescript
// hooks.ts provides all data fetching hooks
useAccountSummary(accountId, period); // KPI metrics
useAccountHealth(accountId, period); // Health score
useAccountPosts(accountId, options); // Posts data
useAccountTopPosts(accountId, period); // Top performing posts
useAccountAIInsights(accountId, days); // AI-generated insights
useAccountRecommendations(accountId, days); // Optimization tips
useAccountForecasts(accountId, days, historical); // Predictions
```

### 3. Backend API Routes

```
GET /api/analytics/social-accounts/:id/summary?period=30d
GET /api/analytics/social-accounts/:id/health?period=30d
GET /api/analytics/social-accounts/:id/posts?period=30d&sortBy=engagement
GET /api/analytics/social-accounts/:id/ai-insights?days=30
GET /api/analytics/social-accounts/:id/recommendations?days=90
GET /api/analytics/social-accounts/:id/forecasting?days=30&historical=90
POST /api/analytics/social-accounts/:id/refresh
```

## Platform Support

### Current Platforms

- ✅ **Instagram**: Full support (hashtags, audience insights, stories)
- ✅ **Facebook**: Infrastructure ready (needs platform-specific components)
- 🚧 **LinkedIn**: Backend ready (needs frontend components)
- 🚧 **X (Twitter)**: Backend ready (needs frontend components)
- 🚧 **YouTube**: Backend ready (needs frontend components)
- 🚧 **TikTok**: Backend ready (needs frontend components)

### Platform Configuration (`platforms.ts`)

```typescript
const MODULES: Record<Platform, PlatformAnalyticsModule> = {
  instagram: {
    platform: 'instagram',
    likesLabel: 'Likes',
    postColumns: [
      { key: 'impressions', label: 'Views' },
      { key: 'reach', label: 'Reach' },
      { key: 'likes', label: 'Likes' },
      { key: 'comments', label: 'Comments' },
      { key: 'saves', label: 'Saves' },
      { key: 'shares', label: 'Shares' },
      { key: 'engagementRate', label: 'Eng. Rate' },
    ],
    tabs: ['overview', 'posts', 'insights', 'recommendations', 'forecasts'],
  },
  facebook: {
    platform: 'facebook',
    likesLabel: 'Reactions',
    postColumns: [...],
    tabs: ['overview', 'posts', 'insights', 'recommendations', 'forecasts'],
  },
  // ... other platforms
};
```

## Adding a New Platform

### Step 1: Backend (Already Done)

Backend API routes in `social-account-analytics-routes.ts` are platform-agnostic. No changes needed!

### Step 2: Frontend Components (If Needed)

Only create platform-specific components if the platform has unique features:

```typescript
// Example: LinkedIn Article Analytics
// packages/apps/web/src/features/analytics/platforms/linkedin/ArticleAnalytics.tsx

export function ArticleAnalytics({ accountId }: { accountId: string }) {
  // LinkedIn-specific article metrics
  return <div>LinkedIn Article Analytics</div>;
}
```

### Step 3: Platform Configuration

Update `platforms.ts`:

```typescript
linkedin: {
  platform: 'linkedin',
  likesLabel: 'Reactions',
  postColumns: [
    { key: 'impressions', label: 'Impressions' },
    { key: 'reach', label: 'Unique Viewers' },
    { key: 'likes', label: 'Reactions' },
    { key: 'comments', label: 'Comments' },
    { key: 'shares', label: 'Reposts' },
    { key: 'engagementRate', label: 'Eng. Rate' },
  ],
  tabs: ['overview', 'posts', 'insights', 'recommendations', 'forecasts'],
},
```

### Step 4: Test

1. Connect a LinkedIn account
2. Navigate to `/analytics`
3. Verify it shows LinkedIn analytics with proper labels
4. Confirm all tabs work correctly

**That's it!** No routing changes, no page modifications needed.

## Component Guidelines

### Platform-Agnostic Components (`analytics-common/`)

**Rules:**

- No platform-specific logic
- Accept generic props
- Use consistent interfaces
- Export through index.ts

**Example:**

```typescript
// KPICard.tsx
interface KPICardProps {
  title: string;
  value: string | number;
  change?: number;
  icon?: React.ReactNode;
  loading?: boolean;
}

export function KPICard({ title, value, change, icon, loading }: KPICardProps) {
  // Platform-agnostic rendering
}
```

### Platform-Specific Components (`platforms/`)

**Rules:**

- Only when truly platform-specific (e.g., Instagram Hashtags, Facebook Reactions breakdown)
- Must have clear use case
- Document why it's platform-specific

**Example:**

```typescript
// platforms/instagram/HashtagAnalysis.tsx
export function HashtagAnalysis({ hashtags }: { hashtags: InstagramHashtag[] }) {
  // Instagram-specific hashtag performance analysis
}
```

## Migration from Old Architecture

### What Changed

| Old Architecture                            | New Architecture                          |
| ------------------------------------------- | ----------------------------------------- |
| `/analytics` with Overview + Instagram tabs | `/analytics` → redirects to account       |
| Platform tabs (Instagram, Facebook)         | Account selector dropdown                 |
| `AnalyticsOverviewTab.tsx` (brand-level)    | `AnalyticsAccount.tsx` (account-level)    |
| `AnalyticsInstagramTab.tsx`                 | Integrated into account overview          |
| `components/analytics/*`                    | Split: `analytics-common/` + `platforms/` |

### Breaking Changes

1. **Removed Components:**
   - `components/analytics-tabs/AnalyticsOverviewTab.tsx`
   - `components/analytics-tabs/AnalyticsInstagramTab.tsx`

2. **Moved Components:**
   - 11 components moved to `analytics-common/`
   - 2 components moved to `platforms/`

3. **Import Changes:**

   ```typescript
   // Old
   import { KPICard } from '@/components/analytics/KPICard';

   // New
   import { KPICard } from '@/components/analytics-common';
   ```

4. **API Client:**
   - Added 7 new social account methods to `AnalyticsClient`

## Performance Considerations

### Data Fetching

- React Query with 30s stale time
- Parallel data fetching for all tabs
- Automatic cache invalidation on refresh
- Optimistic updates on mutations

### Component Rendering

- Lazy loading for platform-specific components
- Skeleton states for loading
- Pagination for posts table
- Memoization for expensive calculations

## Testing Checklist

- [ ] Instagram account analytics loads correctly
- [ ] Facebook account analytics loads correctly
- [ ] Account selector dropdown shows all accounts
- [ ] Switching accounts updates data
- [ ] All tabs render without errors
- [ ] KPI cards show correct metrics
- [ ] Health score displays properly
- [ ] AI insights load
- [ ] Recommendations render
- [ ] Forecasts display charts
- [ ] Posts table sorts and paginates
- [ ] Top posts grid displays
- [ ] Refresh button works
- [ ] Disconnected accounts show proper message
- [ ] No accounts shows "Connect Account" button

## Future Enhancements

### Short Term

- [ ] Add LinkedIn-specific components
- [ ] Add X (Twitter) analytics
- [ ] Implement YouTube metrics
- [ ] Add TikTok support

### Medium Term

- [ ] Cross-account comparison view
- [ ] Export analytics to PDF/CSV
- [ ] Custom date range selection
- [ ] Saved reports functionality

### Long Term

- [ ] Real-time analytics updates
- [ ] Advanced filtering options
- [ ] Custom dashboards
- [ ] Benchmarking against competitors

## Troubleshooting

### Issue: Analytics page shows blank

**Solution:** Check browser console for errors. Ensure social accounts are connected.

### Issue: Data not loading

**Solution:** Check network tab. Verify backend API endpoints are responding. Check Redis and database connections.

### Issue: Type errors after adding platform

**Solution:** Ensure platform module is properly configured in `platforms.ts`. Check that all required fields are present.

### Issue: Components not rendering

**Solution:** Verify imports from `analytics-common`. Check that component is exported from `index.ts`.

## Additional Resources

- [Backend API Routes](/packages/apps/api/src/routes/analytics/social-account-analytics-routes.ts)
- [Frontend Hooks](/packages/apps/web/src/features/analytics/hooks.ts)
- [Platform Configuration](/packages/apps/web/src/features/analytics/platforms.ts)
- [Component Library](/packages/apps/web/src/components/analytics-common/)

---

**Questions?** Check the codebase or refer to this documentation for implementation details.
