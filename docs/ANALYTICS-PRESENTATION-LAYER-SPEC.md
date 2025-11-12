# Analytics Presentation Layer — Comprehensive Feature Specification

**Status**: Proposed
**Owner**: Core
**Created**: 2025-01-09
**Last Updated**: 2025-01-09

## Executive Summary

This document defines the presentation layer for Postolio's analytics features. While the data collection infrastructure (Analytics v2) is complete with the ingestor service fetching metrics every minute, we need to design and implement how to present this data to users in an intuitive, actionable, and intelligent way.

### Current State

- ✅ Analytics v2 database schema (SocialAccount, ContentPublication, MetricSample, PublicationMetricsLatest, etc.)
- ✅ Analytics ingestor service (ECS, fetches every minute)
- ✅ API v2 endpoints for data access
- ✅ Basic UI with 3 tabs (Overview, Instagram, Scheduling)
- ✅ Instagram-only support (multi-platform ready)

### Goals

- Design a comprehensive, scalable analytics presentation layer
- Leverage AI to provide actionable insights and recommendations
- Create best-in-class UX for understanding social media performance
- Support multi-platform analytics (prepared for LinkedIn, Facebook, X, TikTok)
- Enable campaign-driven decisions based on analytics

---

## Market Research Summary

### Competitor Analysis

#### 1. **Buffer** (buffer.com/analyze)

**Strengths:**

- Clean, unified dashboard across all platforms (Instagram, Facebook, X, LinkedIn)
- "Best Time to Post" AI recommendations
- Custom branded reports (PDF/image export)
- Organic vs. boosted post comparison
- 14-day free trial, simple pricing

**Key Metrics Displayed:**

- Engagement rate, follower growth, clicks
- Daily audience activity patterns
- Post-level performance with visual cards

**UI Pattern:**

- Overview → Detailed reports → Custom export flow
- KPI cards at top, charts below, post grid at bottom

#### 2. **Later** (later.com)

**Strengths:**

- Visual-first approach (perfect for Instagram)
- Hashtag analytics (performance by hashtag)
- 12-month historical data
- Audience demographics and active times
- CSV export for deeper analysis

**Limitations:**

- Limited by Meta API changes (lost Profile Views, Video Views)
- Primarily Instagram-focused
- Limited cross-platform insights

**UI Pattern:**

- Visual grid with performance overlays
- Filter by engagement metrics (likes, reach, comments, saves)

#### 3. **Sprout Social** (sproutsocial.com)

**Strengths:**

- **Enterprise-grade AI insights**
- Sentiment analysis (positive/negative/neutral)
- Trend detection with anomaly alerts
- Competitor intelligence
- Demand forecasting
- Report scheduling (weekly/monthly email)

**AI Features:**

- Automated pattern recognition
- Proactive alerts for unusual activity
- Predictive analytics for engagement trends
- Natural language insights

**UI Pattern:**

- Dashboard → Insights → Reports hierarchy
- Heavy emphasis on data-driven recommendations

#### 4. **Hootsuite** (hootsuite.com)

**Strengths:**

- Real-time analytics across 8+ platforms
- Competitive analysis tool
- Social listening with Net Sentiment widget
- Performance score that tracks improvement
- Multiple export formats (.csv, .xlsx, .pdf, .ppt)

**Recent 2025 Updates:**

- Enhanced color contrast for accessibility
- Metric detail tooltips (organic vs paid, refresh rate)
- Net Sentiment KPI widget

**UI Pattern:**

- Overview → Post Performance → Reports
- Custom dashboards for role-based KPIs

### AI-Powered Analytics Trends (2025)

Based on research, the market is moving toward:

1. **Predictive Analytics**: Forecast future engagement, optimal posting times, content performance
2. **Sentiment Analysis**: Automatically categorize feedback/comments as positive/negative/neutral
3. **Trend Detection**: Alert on sudden spikes in metrics (viral posts, negative sentiment waves)
4. **Natural Language Summaries**: GPT-powered insights like "Your engagement increased 23% this week due to Reels outperforming static posts"
5. **Actionable Recommendations**: "Post more video content on Thursdays at 6 PM for 34% higher engagement"
6. **Anomaly Detection**: Flag unusual patterns (sudden follower drop, engagement spike)

### Key Learnings

1. **Visual Hierarchy**: KPI cards → Charts → Detailed tables → Export
2. **Progressive Disclosure**: Show high-level overview first, allow drill-down
3. **Actionable First**: Don't just show data—tell users what to do with it
4. **AI as Co-pilot**: Surface insights automatically, don't make users hunt for patterns
5. **Multi-timeframe**: Support 7d, 30d, 90d views consistently
6. **Export Everything**: Users want to share reports (PDF, CSV, images)

---

## Proposed Analytics Architecture

### Information Hierarchy (3-Tier)

```
┌─────────────────────────────────────────────────────────┐
│ TIER 1: OVERVIEW DASHBOARD (Home)                       │
│ - Health score / performance indicator                  │
│ - Key metrics summary (4-6 KPI cards)                   │
│ - Quick trends (7-day sparklines)                       │
│ - AI-generated insights (top 3)                         │
│ - Platform breakdown (if multi-platform)                │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ TIER 2: PLATFORM/CAMPAIGN ANALYTICS                     │
│ - Platform-specific deep dive (Instagram, LinkedIn)     │
│ - Campaign performance view                             │
│ - Time-series charts (impressions, reach, engagement)   │
│ - Top posts (sorted by engagement rate)                 │
│ - Audience insights (demographics, active times)        │
│ - Hashtag/content analysis                              │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ TIER 3: POST-LEVEL ANALYTICS                            │
│ - Individual post metrics (in Post Detail view)         │
│ - Comments sentiment analysis                           │
│ - Engagement timeline (when did likes/comments happen)  │
│ - Comparison to brand average                           │
│ - AI content analysis (what made this post perform)     │
└─────────────────────────────────────────────────────────┘
```

### Navigation Structure

```
Analytics (Main)
├── Overview (Default tab)
│   ├── Brand Health Score
│   ├── KPI Summary Cards
│   ├── AI Insights Panel
│   ├── Performance Charts
│   └── Top Posts Grid
│
├── Platforms (Dropdown or tabs)
│   ├── Instagram
│   │   ├── Account Overview
│   │   ├── Posts Performance
│   │   ├── Audience Insights
│   │   └── Hashtag Analysis
│   ├── LinkedIn (Future)
│   ├── Facebook (Future)
│   └── X / Twitter (Future)
│
├── Campaigns
│   ├── Active Campaigns
│   ├── Campaign Comparison
│   └── Historical Campaigns
│
├── Content Performance
│   ├── Top Performers
│   ├── Underperformers
│   └── Content Type Analysis
│
└── Reports
    ├── Scheduled Reports
    ├── Custom Report Builder
    └── Export Center
```

---

## Feature Specifications

### 1. Overview Dashboard

**Purpose**: Provide at-a-glance understanding of overall social media health.

**Components:**

#### A. Brand Health Score (NEW)

- **Visual**: Large circular progress indicator (0-100 score)
- **Algorithm**: Weighted composite of:
  - Engagement rate (30%)
  - Follower growth rate (20%)
  - Content consistency (20%)
  - Response rate to comments (15%)
  - Publishing frequency (15%)
- **Color coding**:
  - 80-100: Green (Excellent)
  - 60-79: Yellow (Good)
  - 40-59: Orange (Needs Improvement)
  - 0-39: Red (Action Required)
- **AI Insight**: Show primary factor affecting score ("Improve comment response time to increase score")

#### B. KPI Summary Cards (6 cards)

1. **Total Posts** (period)
   - Show vs. previous period: "↑ 12% from last month"
2. **Total Impressions** (formatted: 45.2K)
   - Sparkline chart (last 7 days)
3. **Total Reach** (formatted)
   - % of audience reached
4. **Engagement Rate** (%)
   - Industry benchmark comparison
5. **Follower Growth** (net change)
   - Growth rate %
6. **Best Performing Post** (thumbnail + metric)
   - Click to view details

**Design Pattern**:

- Grid layout: 3 cols desktop, 2 cols tablet, 1 col mobile
- Hover state shows detailed tooltip
- Click opens relevant deep-dive view

#### C. AI Insights Panel (NEW - Flagship Feature)

**Visual**: Prominent card with gradient background, icon (✨ or 🤖)

**Content**: 3-5 AI-generated insights, auto-refreshed daily

**Example Insights:**

- "Your Reels get 3.4x more engagement than photos. Consider posting more video content."
- "Posts published on Thursday at 6 PM perform 28% better than your average."
- "Your audience engagement peaks at 9 AM and 7 PM EST. Schedule content accordingly."
- "Hashtags with 5-10 tags get 15% more reach than posts with 20+ tags."
- "Your engagement rate (4.2%) is 12% above the industry average for your follower count."

**Technical Implementation:**

- Backend service: `/api/analytics/brands/:brandId/ai-insights`
- Cache insights for 24 hours
- Use GPT-4o to analyze:
  - Top performing posts (content type, caption style, hashtags)
  - Engagement patterns by time/day
  - Audience behavior trends
  - Comparison to previous periods
  - Anomalies or notable changes

**Prompt Template**:

```
Analyze the following social media analytics data and provide 3-5 actionable insights in bullet points:

Brand: {brandName}
Period: Last 30 days
Total Posts: {totalPosts}
Engagement Rate: {engagementRate}% (Industry avg: {industryAvg}%)
Top Performing Posts: {topPosts with metrics}
Engagement by Day/Time: {timeSeriesData}
Content Type Performance: {imageVsVideoVsCarousel}
Hashtag Performance: {hashtagStats}

Provide specific, data-driven recommendations that help increase engagement.
```

#### D. Performance Charts (2 side-by-side)

1. **Reach Over Time** (line chart)
   - 30-day view by default
   - Toggle: 7d, 30d, 90d, All Time
   - Hover shows exact date + value
2. **Engagement Over Time** (area chart)
   - Same timeframe options
   - Stacked: Likes, Comments, Saves, Shares

**Library**: Recharts or Chart.js (already using in TimeSeriesChart.tsx)

#### E. Top Posts Grid (NEW)

- **Layout**: 3-column grid (responsive)
- **Sort options**:
  - Engagement Rate (default)
  - Total Engagement
  - Reach
  - Impressions
- **Card Design**:
  - Thumbnail image
  - Engagement rate badge (top-right corner)
  - Quick metrics: 👁️ impressions, ❤️ likes, 💬 comments
  - Platform icon
  - Click → Post Detail view

---

### 2. Platform-Specific Analytics (Instagram)

**Current State**: Basic Instagram tab with account metrics and top posts.

**Enhancements:**

#### A. Account Overview (Enhanced)

- **Profile Stats Card**:
  - Profile picture + username + verified badge
  - Followers (with growth indicator)
  - Following
  - Average engagement rate
  - Posts published (period)
- **Activity Heatmap** (NEW):
  - Visual grid showing when audience is most active
  - Days of week × hours of day
  - Color intensity = activity level
  - Recommended posting times highlighted

#### B. Posts Performance (Enhanced)

- **Filter Bar**:
  - Date range picker
  - Content type: All, Image, Video, Carousel, Reel, Story
  - Sort: Most recent, Top performing, Lowest performing
- **Performance Table** (sortable):
  - Thumbnail | Caption (truncated) | Published | Impressions | Reach | Engagement | Eng. Rate | Actions
  - Actions: View Detail, Compare, Export
- **Bulk Actions**:
  - Select multiple posts → Compare side-by-side
  - Export selected posts to CSV

#### C. Audience Insights (NEW)

**Data Source**: `AccountMetricSample` + Meta Insights API

**Widgets:**

1. **Demographics**:
   - Age distribution (bar chart)
   - Gender split (pie chart)
   - Top locations (map or list)
2. **Activity Patterns**:
   - Best times to post (heatmap)
   - Days of week comparison (bar chart)
   - Follower growth timeline
3. **Content Preferences**:
   - Engagement by content type
   - Top hashtags by reach
   - Average watch time (for videos)

#### D. Hashtag Analysis (NEW)

**Purpose**: Understand which hashtags drive performance.

**Table Columns**:

- Hashtag | Uses | Avg. Reach | Avg. Engagement | Best Performing Post

**Sort Options**:

- Most used
- Highest reach
- Highest engagement rate

**Recommendations** (AI):

- "Use #[hashtag] more often—it increases reach by 45% on average"
- "Avoid #[hashtag]—it's too broad and reduces visibility"

---

### 3. Campaign Analytics (Enhanced)

**Current**: Basic aggregates by campaign.

**Enhancements:**

#### A. Campaign List View

- **Cards per campaign**:
  - Campaign name + color indicator
  - Status badge (Active, Completed, Paused)
  - Date range
  - Key metrics: Posts, Total Engagement, Avg. Eng. Rate
  - Performance vs. goal (if goal was set)
  - Trend indicator (↑↓↔)

#### B. Campaign Detail View (NEW)

**Layout**: Full-page view for single campaign

**Components:**

1. **Campaign Header**:
   - Name, description, dates
   - Goal (if defined): "Increase engagement by 20%"
   - Progress bar toward goal
2. **Performance Summary**:
   - KPI cards specific to campaign
   - Comparison to brand average
   - Platform breakdown (if multi-platform)
3. **Posts Timeline**:
   - Chronological view of all campaign posts
   - Visual timeline with engagement markers
   - Identify gaps in publishing schedule
4. **AI Campaign Analysis** (NEW):
   - Overall campaign performance summary
   - What worked / what didn't
   - Recommendations for future campaigns
   - Content themes that resonated

**API Enhancement**: Extend `/api/analytics/campaigns/:campaignId` to include AI summary.

---

### 4. AI-Powered Features (Detailed Specs)

#### A. Automated Insights Engine

**Backend Service**: `/api/analytics/brands/:brandId/insights`

**Insight Types:**

1. **Performance Insights**:
   - "Your engagement rate increased 23% this week"
   - "Reels outperform static images by 3.4x"
   - "Thursday posts get 28% more engagement"

2. **Audience Insights**:
   - "Your audience is most active at 9 AM and 7 PM EST"
   - "67% of your followers are age 25-34"
   - "Top locations: New York (23%), Los Angeles (18%)"

3. **Content Insights**:
   - "Posts with 5-7 hashtags perform best"
   - "Captions between 100-150 characters get more engagement"
   - "Questions in captions increase comment rate by 42%"

4. **Trend Detection**:
   - "Your reach dropped 15% this week—investigate algorithm changes"
   - "Your latest post went viral (5x normal engagement)"
   - "Follower growth slowed—consider running a campaign"

5. **Recommendations**:
   - "Post more Reels to increase reach"
   - "Schedule content on Thursdays at 6 PM"
   - "Respond to comments within 2 hours to boost visibility"

**Implementation**:

```typescript
// Service: packages/apps/api/src/services/ai-insights.ts
export async function generateInsights(brandId: string, period: '7d' | '30d' | '90d') {
  // 1. Fetch analytics data
  const summary = await getBrandSummary(brandId);
  const topPosts = await getTopPublications(brandId, 10);
  const timeSeries = await getBrandAccountSeries(brandId, period);

  // 2. Calculate trends and patterns
  const trends = analyzeTrends(timeSeries);
  const contentAnalysis = analyzeContentTypes(topPosts);
  const timeAnalysis = analyzePostingTimes(topPosts);

  // 3. Generate insights with GPT-4o
  const prompt = buildInsightsPrompt({ summary, trends, contentAnalysis, timeAnalysis });
  const insights = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a social media analytics expert...' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  // 4. Parse and structure insights
  return parseInsights(insights.choices[0].message.content);
}
```

#### B. Sentiment Analysis (Comments)

**Trigger**: When viewing post details or campaign summary.

**Process**:

1. Fetch comments from `PublicationComment` table
2. Analyze sentiment with GPT-4o or dedicated sentiment model
3. Categorize: Positive, Neutral, Negative
4. Extract themes (what people are talking about)

**Display**:

- Sentiment distribution (pie chart)
- Sample positive/negative comments
- Word cloud of frequent terms
- Overall sentiment trend over time

**API**: `/api/analytics/publications/:publicationId/sentiment`

#### C. Performance Prediction (Future)

**Goal**: Predict how a post will perform based on historical data.

**Use Cases**:

1. **Before Publishing**: "This post is predicted to get 450 likes and 2.3% engagement rate"
2. **Optimal Scheduling**: "Publishing on Thursday at 6 PM will increase engagement by 28%"

**ML Model** (Phase 2):

- Train on historical post performance
- Features: time of day, day of week, caption length, hashtags, content type, current follower count
- Model: XGBoost or simple linear regression

#### D. Campaign Recommendations (AI)

**Goal**: Help users create effective campaigns based on analytics.

**Flow**:

1. User clicks "Create Campaign from Insights"
2. AI analyzes recent performance
3. Suggests:
   - Campaign theme (e.g., "Behind-the-scenes content")
   - Content types to use (e.g., "60% Reels, 40% Carousels")
   - Posting frequency (e.g., "3 posts/week")
   - Optimal posting times
   - Hashtag strategy
4. Pre-fill campaign creation form with recommendations
5. User can edit before confirming

**API**: `/api/analytics/brands/:brandId/campaign-recommendations`

---

### 5. Post-Level Analytics (Enhanced)

**Location**: Post Detail page → Metrics tab

**Current**: Basic metrics from `PublicationMetricsLatest`.

**Enhancements:**

#### A. Metrics Overview

- **Hero Card**: Large engagement rate with visual indicator
- **Metrics Grid** (4x2):
  - Impressions | Reach
  - Likes | Comments
  - Saves | Shares
  - Video Views (if video) | Profile Visits

#### B. Engagement Timeline (NEW)

**Visual**: Line chart showing when engagement happened.

- X-axis: Time since published (hours/days)
- Y-axis: Cumulative engagement
- Hover: Show exact count at that time
- Annotations: "Peak engagement at 3 hours after posting"

**Data Source**: `MetricSample` with `period = 'hour'` or `'day'`

#### C. Performance Comparison

- **Compare to**:
  - Brand average
  - Similar content type average
  - Previous post
- **Visual**: Bar chart or percentage indicators

#### D. AI Content Analysis (NEW)

**Purpose**: Explain why this post performed well (or poorly).

**Insights**:

- "This Reel performed 2.3x better than your average due to:"
  - ✓ Posted at optimal time (Thursday 6 PM)
  - ✓ Used trending audio
  - ✓ Caption included a question
  - ✓ 5 hashtags (optimal count)
  - ✗ Could improve: Add more text overlay for accessibility

**Implementation**: GPT-4o analyzes:

- Post metadata (time, day, caption, hashtags, content type)
- Performance metrics
- Comparison to brand benchmarks
- Returns structured analysis

#### E. Comments Section (Enhanced)

- **Sentiment Badge**: "😊 85% Positive"
- **Filter**: All / Positive / Negative / Unanswered
- **Reply Status**: Show which comments you've replied to
- **AI Summary**: "Most users love the color palette and are asking about product availability"

---

### 6. Reports & Export

**Goal**: Enable users to share analytics with stakeholders.

#### A. Quick Export

- **From any view**: Click "Export" button
- **Options**:
  - CSV (raw data)
  - PDF (formatted report with charts)
  - PNG (dashboard screenshot)
  - Email (schedule weekly/monthly)

#### B. Custom Report Builder (Future - Phase 2)

**Visual**: Drag-and-drop interface

**Components**:

- Cover page (logo, date range, branding)
- KPI summary section
- Chart widgets (select from available charts)
- Top posts grid
- AI insights section
- Text blocks (add commentary)

**Templates**:

- Monthly Performance Report
- Campaign Results Report
- Quarterly Review
- Client Presentation

#### C. Scheduled Reports

- **Configure**: Weekly or monthly
- **Recipients**: Email addresses
- **Format**: PDF or CSV
- **Content**: Auto-generate from template

---

## Technical Implementation Plan

### Phase 1: Foundation & Core UI (Weeks 1-3)

**Goal**: Rebuild Analytics page with new architecture, no AI yet.

#### Week 1: Overview Dashboard

- [ ] Design and implement Brand Health Score algorithm
- [ ] Create KPI Summary Cards component (reusable)
- [ ] Enhance performance charts with time range selector
- [ ] Build Top Posts Grid component
- [ ] Add "Insights Panel" placeholder (static content for now)

**New Components**:

- `packages/apps/web/src/components/analytics/BrandHealthScore.tsx`
- `packages/apps/web/src/components/analytics/KPICard.tsx`
- `packages/apps/web/src/components/analytics/TopPostsGrid.tsx`
- `packages/apps/web/src/components/analytics/InsightsPanel.tsx`

**API Endpoints** (extend existing):

- Enhance `/api/analytics/brands/:brandId/summary` to include health score

#### Week 2: Platform Analytics (Instagram)

- [ ] Create Activity Heatmap component
- [ ] Build Posts Performance Table (sortable, filterable)
- [ ] Implement Audience Insights widgets
- [ ] Add Hashtag Analysis view
- [ ] Create reusable chart components

**New Components**:

- `packages/apps/web/src/components/analytics/ActivityHeatmap.tsx`
- `packages/apps/web/src/components/analytics/PostsPerformanceTable.tsx`
- `packages/apps/web/src/components/analytics/AudienceInsights.tsx`
- `packages/apps/web/src/components/analytics/HashtagAnalysis.tsx`

**API Endpoints** (new):

- `GET /api/analytics/brands/:brandId/audience` - Demographics, activity patterns
- `GET /api/analytics/brands/:brandId/hashtags` - Hashtag performance

#### Week 3: Campaign Analytics

- [ ] Redesign Campaign list view with enhanced cards
- [ ] Create Campaign Detail page
- [ ] Build Posts Timeline component
- [ ] Add campaign comparison tool
- [ ] Implement performance vs. goal tracking

**New Components**:

- `packages/apps/web/src/pages/CampaignAnalytics.tsx` (enhanced)
- `packages/apps/web/src/components/analytics/CampaignCard.tsx`
- `packages/apps/web/src/components/analytics/CampaignTimeline.tsx`

**API Endpoints** (enhance existing):

- Enhance `/api/analytics/campaigns/:campaignId` with detailed breakdown

---

### Phase 2: AI Integration (Weeks 4-6)

**Goal**: Add AI-powered insights, sentiment analysis, and recommendations.

#### Week 4: AI Insights Engine

- [ ] Create AI insights service
- [ ] Implement insight generation with GPT-4o
- [ ] Build insight caching system (24-hour TTL)
- [ ] Integrate insights into Overview Dashboard
- [ ] Add "Refresh Insights" button

**New Services**:

- `packages/apps/api/src/services/ai-insights.ts`
- `packages/apps/api/src/services/insight-generator.ts`

**API Endpoints** (new):

- `GET /api/analytics/brands/:brandId/insights` - Get AI-generated insights
- `POST /api/analytics/brands/:brandId/insights/refresh` - Regenerate insights

**Database** (optional - cache insights):

```prisma
model AnalyticsInsight {
  id          String   @id @default(cuid())
  brandId     String
  type        String   // 'performance' | 'audience' | 'content' | 'trend' | 'recommendation'
  title       String
  description String
  priority    Int      // 1-5
  metadata    Json?
  generatedAt DateTime @default(now())
  expiresAt   DateTime

  @@index([brandId, expiresAt])
  @@map("analytics_insights")
}
```

#### Week 5: Sentiment Analysis & Post-Level AI

- [ ] Implement comment sentiment analysis
- [ ] Create AI content analysis for posts
- [ ] Build Engagement Timeline component
- [ ] Add sentiment visualization
- [ ] Integrate into Post Detail page

**New Services**:

- `packages/apps/api/src/services/sentiment-analysis.ts`
- `packages/apps/api/src/services/content-analysis.ts`

**API Endpoints** (new):

- `GET /api/analytics/publications/:publicationId/sentiment`
- `GET /api/analytics/publications/:publicationId/content-analysis`
- `GET /api/analytics/publications/:publicationId/engagement-timeline`

#### Week 6: Campaign AI & Recommendations

- [ ] Implement AI campaign analysis
- [ ] Build campaign recommendation engine
- [ ] Create "Create Campaign from Insights" flow
- [ ] Add AI summary to Campaign Detail page
- [ ] Implement performance prediction (basic)

**New Services**:

- `packages/apps/api/src/services/campaign-analysis.ts`
- `packages/apps/api/src/services/campaign-recommendations.ts`

**API Endpoints** (new):

- `GET /api/analytics/campaigns/:campaignId/ai-analysis`
- `GET /api/analytics/brands/:brandId/campaign-recommendations`

---

### Phase 3: Advanced Features (Weeks 7-8)

**Goal**: Reports, exports, multi-platform prep, performance optimizations.

#### Week 7: Reports & Export

- [ ] Implement CSV export for all views
- [ ] Build PDF report generator (with charts)
- [ ] Add email scheduling for reports
- [ ] Create basic report templates
- [ ] Implement dashboard screenshot export

**Libraries**:

- `pdfkit` or `puppeteer` for PDF generation
- `nodemailer` for email delivery

**API Endpoints** (new):

- `POST /api/analytics/reports/generate` - Generate custom report
- `POST /api/analytics/reports/schedule` - Schedule recurring report
- `GET /api/analytics/reports/scheduled` - List scheduled reports

#### Week 8: Polish & Multi-Platform Prep

- [ ] Add loading skeletons for all components
- [ ] Implement error boundaries
- [ ] Add empty states with helpful CTAs
- [ ] Prepare UI for multi-platform (add platform selector)
- [ ] Performance optimization (memoization, lazy loading)
- [ ] Mobile responsive testing and fixes
- [ ] Accessibility audit (WCAG 2.1 AA)

---

### Phase 4: Future Enhancements (Post-Launch)

**Goal**: Advanced AI, multi-platform support, competitive analysis.

#### A. Multi-Platform Support

- [ ] Add LinkedIn connector
- [ ] Add Facebook connector
- [ ] Add X (Twitter) connector
- [ ] Add platform comparison views
- [ ] Unified cross-platform insights

#### B. Advanced AI Features

- [ ] Performance prediction model (ML)
- [ ] Content recommendation engine ("Post something like this")
- [ ] Automated A/B testing suggestions
- [ ] Competitor benchmarking (if data available)
- [ ] Trend forecasting

#### C. Collaboration Features

- [ ] Share reports with team members
- [ ] Commenting on insights
- [ ] Goal setting and tracking
- [ ] Notifications for anomalies
- [ ] Integration with campaign creation

#### D. Custom Report Builder

- [ ] Drag-and-drop report designer
- [ ] Custom branding (logo, colors)
- [ ] White-label reports for agencies
- [ ] Interactive online reports (shareable link)

---

## UI/UX Design Guidelines

### Design Principles

1. **Clarity Over Complexity**: Show high-level insights first, details on demand
2. **Actionable Insights**: Every data point should suggest an action
3. **Visual Hierarchy**: Use size, color, spacing to guide attention
4. **Progressive Disclosure**: Don't overwhelm—reveal complexity gradually
5. **Consistency**: Reuse components, patterns, and terminology
6. **Accessibility**: WCAG 2.1 AA compliance (color contrast, keyboard nav, screen readers)

### Visual Patterns

#### Color Palette

- **Positive**: Green (#10B981) - growth, success, above average
- **Negative**: Red (#EF4444) - decline, below average, errors
- **Neutral**: Gray (#6B7280) - unchanged, baseline
- **Info**: Blue (#3B82F6) - insights, recommendations
- **Warning**: Yellow (#F59E0B) - attention needed

#### Typography

- **Headers**: Bold, large (24-32px)
- **Subheaders**: Semi-bold, medium (18-20px)
- **Body**: Regular, readable (14-16px)
- **Metrics**: Bold, large numbers (28-36px)
- **Labels**: Small, gray (12-14px)

#### Spacing

- **Section gaps**: 48px vertical
- **Component gaps**: 24px vertical
- **Card padding**: 24px all sides
- **Dense tables**: 16px padding

#### Icons

- Use consistent icon library (Lucide React - already in use)
- Pair metrics with intuitive icons:
  - 👁️ / Eye: Impressions
  - 🎯 / Target: Reach
  - ❤️ / Heart: Likes, Engagement
  - 💬 / MessageCircle: Comments
  - 🔖 / Bookmark: Saves
  - 🔄 / Share: Shares
  - 📈 / TrendingUp: Growth
  - 👥 / Users: Followers, Audience

### Component Library

**Reusable Components** (build once, use everywhere):

1. **KPICard**: Metric name, value, change indicator, sparkline
2. **MetricChart**: Line, bar, area charts with consistent styling
3. **DataTable**: Sortable, filterable table with pagination
4. **InsightCard**: AI-generated insight with icon and CTA
5. **PostCard**: Post thumbnail with quick metrics
6. **EmptyState**: Friendly message with illustration and CTA
7. **LoadingSkeleton**: Shimmer effect for loading states
8. **ExportMenu**: Dropdown with export options

### Responsive Design

**Breakpoints**:

- Desktop: 1280px+ (3-4 column grids)
- Tablet: 768px-1279px (2 column grids)
- Mobile: <768px (1 column, stacked)

**Mobile Considerations**:

- Collapsible sections
- Bottom sheet for filters
- Simplified charts (hide less important data)
- Touch-friendly targets (48x48px minimum)
- Horizontal scroll for tables

---

## API Specifications

### New Endpoints Summary

#### Insights & AI

- `GET /api/analytics/brands/:brandId/insights` - AI-generated insights
- `POST /api/analytics/brands/:brandId/insights/refresh` - Regenerate insights
- `GET /api/analytics/campaigns/:campaignId/ai-analysis` - Campaign AI summary
- `GET /api/analytics/brands/:brandId/campaign-recommendations` - Campaign suggestions

#### Audience & Hashtags

- `GET /api/analytics/brands/:brandId/audience` - Demographics, activity patterns
- `GET /api/analytics/brands/:brandId/hashtags` - Hashtag performance

#### Post-Level

- `GET /api/analytics/publications/:publicationId/sentiment` - Comment sentiment
- `GET /api/analytics/publications/:publicationId/content-analysis` - AI post analysis
- `GET /api/analytics/publications/:publicationId/engagement-timeline` - Engagement over time

#### Reports

- `POST /api/analytics/reports/generate` - Generate report
- `POST /api/analytics/reports/schedule` - Schedule recurring report
- `GET /api/analytics/reports/scheduled` - List scheduled reports

#### Enhanced Endpoints

- Extend `GET /api/analytics/brands/:brandId/summary` to include health score
- Extend `GET /api/analytics/campaigns/:campaignId` with detailed breakdown

---

## Success Metrics

### User Engagement Metrics

- **Analytics Page Views**: Track visits to analytics pages
- **Time Spent**: Average session duration on analytics
- **Feature Adoption**: % of users using AI insights, exports, etc.
- **Insight Click-Through**: Do users click on AI recommendations?

### Business Metrics

- **User Retention**: Do analytics features increase retention?
- **Upgrade Conversions**: Do analytics drive paid plan upgrades?
- **Campaign Creation**: Do users create more campaigns after viewing analytics?
- **Content Improvement**: Does avg. engagement rate improve over time?

### Technical Metrics

- **Page Load Time**: < 2s for initial render
- **Time to Interactive**: < 3s
- **AI Insight Generation**: < 5s
- **Cache Hit Rate**: > 80% for insights

---

## Open Questions & Decisions

### 1. AI Model Selection

- **GPT-4o** (current choice): Fast, versatile, good for summaries and insights
- **GPT-4o-mini**: Cheaper, faster, but less nuanced
- **Claude 3.5 Sonnet**: Your current API model, excellent reasoning
- **Decision**: Start with GPT-4o, evaluate cost/quality trade-offs

### 2. Real-Time vs. Cached Insights

- **Real-Time**: Always up-to-date, but slower and more expensive
- **Cached (24-hour)**: Fast, cheap, but may be stale
- **Hybrid**: Real-time for critical metrics, cached for insights
- **Decision**: Cached insights with manual refresh option

### 3. Sentiment Analysis Approach

- **GPT-4o**: High accuracy, expensive, slower (good for small batches)
- **Dedicated Model** (e.g., HuggingFace Transformers): Fast, cheap, less accurate
- **Hybrid**: Pre-trained model for bulk, GPT-4o for summaries
- **Decision**: Start with GPT-4o for MVP, optimize later

### 4. Export Report Design

- **Simple**: Plain tables and charts (easy to implement)
- **Branded**: Custom templates with logo, colors (more work)
- **Decision**: Start simple, add branding in Phase 3

### 5. Multi-Platform Rollout

- **Simultaneous**: Build all platforms at once (slower)
- **Sequential**: Instagram → LinkedIn → Facebook → X (agile)
- **Decision**: Sequential, prove value with Instagram first

### 6. Analytics Data Retention

- **Current**: Indefinite retention (may grow large)
- **Proposed**: Keep raw `MetricSample` for 90 days, aggregated data forever
- **Decision**: TBD based on database growth

---

## Risk Assessment

### Technical Risks

| Risk                                       | Impact | Likelihood | Mitigation                                             |
| ------------------------------------------ | ------ | ---------- | ------------------------------------------------------ |
| AI costs spiral out of control             | High   | Medium     | Implement strict caching, rate limiting, monitor usage |
| Page performance degrades with data growth | High   | Medium     | Pagination, lazy loading, database indexing            |
| Meta API rate limits hit                   | Medium | Low        | Already have rate limiting in ingestor                 |
| GPT-4o generates inaccurate insights       | Medium | Low        | Validate with statistical analysis, user feedback loop |
| Export report generation is slow           | Low    | High       | Async generation, background jobs, notify when ready   |

### User Experience Risks

| Risk                                  | Impact | Likelihood | Mitigation                                                      |
| ------------------------------------- | ------ | ---------- | --------------------------------------------------------------- |
| Too much information overwhelms users | High   | High       | Progressive disclosure, clear hierarchy, onboarding             |
| AI insights are too generic/obvious   | Medium | Medium     | Fine-tune prompts, use user feedback to improve                 |
| Users don't trust AI recommendations  | Medium | Medium     | Show data behind insights, allow feedback ("Was this helpful?") |
| Mobile experience is poor             | Medium | Low        | Mobile-first design, responsive testing                         |

---

## Competitive Differentiation

**What Makes Postolio's Analytics Unique:**

1. **AI-First Approach**: Not just data—actionable insights powered by GPT-4o
2. **Campaign-Centric**: Tie analytics directly to campaign creation and optimization
3. **Content Generation Integration**: Use analytics to inform AI content generation
4. **Simplicity**: No overwhelming dashboards—focus on what matters
5. **Affordable**: Enterprise features at startup pricing

**Gaps vs. Competitors** (to address in future):

- No competitive analysis (yet)
- No white-label reports (yet)
- No API access (yet)
- Limited historical data (currently)

---

## Appendix

### A. Example AI Prompts

#### Insight Generation Prompt

```
You are a social media analytics expert analyzing data for {brandName}.

Data Summary (Last 30 days):
- Total Posts: {totalPosts}
- Engagement Rate: {engagementRate}% (Industry avg: 3.5%)
- Reach: {reach} (up 12% from previous month)
- Top Performing Content Type: {topContentType}
- Best Posting Time: {bestTime}
- Top Hashtags: {topHashtags}

Recent Top Posts:
{topPosts.map(p => `- "${p.caption}" (${p.platform}): ${p.engagement} engagement, ${p.reach} reach`)}

Engagement by Day:
{dayOfWeekData}

Engagement by Hour:
{hourOfDayData}

Generate 5 specific, actionable insights in this format:
- [Emoji] [Concise insight] ([specific data point])

Focus on:
1. What's working well (celebrate wins)
2. Opportunities for improvement
3. Timing optimization
4. Content type recommendations
5. Anomalies or trends

Make insights specific, data-driven, and actionable. Avoid generic advice.
```

#### Campaign Analysis Prompt

```
Analyze this campaign performance and provide a summary:

Campaign: {campaignName}
Goal: {campaignGoal}
Duration: {startDate} to {endDate}
Total Posts: {totalPosts}

Performance Metrics:
- Reach: {reach} (Goal: {goalReach})
- Engagement: {engagement} (Goal: {goalEngagement})
- Engagement Rate: {engagementRate}%
- Follower Growth: +{followerGrowth}

Post Breakdown:
{posts.map(p => `- ${p.caption}: ${p.engagement} engagement`)}

Provide:
1. Overall performance summary (did it meet goals?)
2. Top 3 performing posts and why they worked
3. What didn't work well
4. Key learnings for future campaigns
5. Specific recommendations for improvement

Format as a concise executive summary (3-4 paragraphs).
```

#### Content Analysis Prompt

```
Analyze why this post performed {performanceLevel}:

Post Details:
- Caption: "{caption}"
- Hashtags: {hashtags}
- Content Type: {contentType}
- Published: {publishedAt} ({dayOfWeek} at {hour}:00)
- Platform: {platform}

Performance:
- Impressions: {impressions}
- Reach: {reach}
- Engagement: {engagement}
- Engagement Rate: {engagementRate}%

Brand Benchmarks:
- Avg Engagement Rate: {avgEngagementRate}%
- Avg Reach: {avgReach}
- Best Performing Content Type: {topContentType}

Identify:
1. What made this post perform well/poorly (3-5 specific factors)
2. Timing considerations
3. Content quality factors
4. Audience relevance
5. Specific suggestions for improvement

Format as bullet points with checkmarks (✓) for positives and (✗) for areas to improve.
```

### B. Database Schema Additions (Optional)

```prisma
// packages/libs/database/prisma/schema.prisma

// Cache AI-generated insights
model AnalyticsInsight {
  id          String   @id @default(cuid())
  brandId     String
  type        String   // 'performance' | 'audience' | 'content' | 'trend' | 'recommendation'
  title       String
  description String
  priority    Int      @default(3) // 1-5, higher = more important
  metadata    Json?    // Additional structured data
  generatedAt DateTime @default(now())
  expiresAt   DateTime

  @@index([brandId, expiresAt])
  @@map("analytics_insights")
}

// Track scheduled reports
model ScheduledReport {
  id          String   @id @default(cuid())
  userId      String
  brandId     String?
  name        String
  frequency   String   // 'weekly' | 'monthly'
  format      String   // 'pdf' | 'csv'
  recipients  String[] // Email addresses
  template    String?  // Report template ID
  nextRunAt   DateTime
  lastRunAt   DateTime?
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([nextRunAt, enabled])
  @@map("scheduled_reports")
}

// Track user interactions with insights (for ML training)
model InsightFeedback {
  id         String   @id @default(cuid())
  insightId  String
  userId     String
  helpful    Boolean
  clicked    Boolean  @default(false)
  actedUpon  Boolean  @default(false)
  feedback   String?  // Optional text feedback
  createdAt  DateTime @default(now())

  @@index([insightId])
  @@map("insight_feedback")
}
```

### C. Cost Estimates (AI)

**GPT-4o Pricing** (as of 2025):

- Input: $5 / 1M tokens
- Output: $15 / 1M tokens

**Estimated Costs per Brand per Month**:

| Feature                          | Frequency   | Tokens (avg)                  | Cost/Month       |
| -------------------------------- | ----------- | ----------------------------- | ---------------- |
| Daily Insights (5 insights)      | 30x/month   | 2,000 input + 500 output      | ~$0.37           |
| Post Content Analysis            | 12 posts    | 1,500 input + 300 output × 12 | ~$0.63           |
| Campaign Analysis                | 2 campaigns | 2,500 input + 600 output × 2  | ~$0.34           |
| Comment Sentiment (100 comments) | 30x/month   | 500 input + 50 output × 30    | ~$0.30           |
| **Total per Brand**              |             |                               | **~$1.64/month** |

**At Scale**:

- 100 brands: $164/month (~$2,000/year)
- 1,000 brands: $1,640/month (~$20,000/year)
- 10,000 brands: $16,400/month (~$200,000/year)

**Optimization Strategies**:

1. Cache insights for 24 hours
2. Use GPT-4o-mini for simple tasks (cheaper)
3. Batch processing for sentiment analysis
4. Rate limit AI features per user tier
5. Only generate insights for active users

### D. References

**Competitor Research**:

- Buffer Analyze: https://buffer.com/analyze
- Later Analytics: https://later.com/instagram-scheduler/analytics/
- Sprout Social AI: https://sproutsocial.com/ai/
- Hootsuite Analytics: https://www.hootsuite.com/platform/analytics

**Design Resources**:

- Dashboard Design Best Practices: https://www.uxpin.com/studio/blog/dashboard-design-principles/
- Data Visualization Patterns: https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards
- Social Media Dashboard Examples: https://sproutsocial.com/insights/social-media-dashboard/

**AI/ML Resources**:

- OpenAI GPT-4o Documentation: https://platform.openai.com/docs/models/gpt-4o
- Sentiment Analysis with Transformers: https://huggingface.co/models?pipeline_tag=sentiment-analysis
- Predictive Analytics Guide: https://www.datacamp.com/tutorial/predictive-analytics

---

## Conclusion

This specification provides a comprehensive blueprint for building a best-in-class analytics presentation layer for Postolio. By combining solid data infrastructure (already built) with intelligent AI insights and user-centric design, we can create an analytics experience that not only shows users how they're performing, but actively helps them improve.

**Key Success Factors**:

1. **Start Simple**: Launch MVP (Phase 1) quickly, iterate based on feedback
2. **AI as Differentiator**: Make AI insights the hero feature
3. **Actionable Always**: Every insight should suggest an action
4. **Multi-Platform Ready**: Design for Instagram first, but architect for multi-platform
5. **Measure Everything**: Track usage, gather feedback, improve continuously

**Next Steps**:

1. Review and approve this specification
2. Create detailed design mockups (Figma)
3. Break down Phase 1 into sprint tasks
4. Begin implementation with Week 1 tasks
5. Schedule regular demos and feedback sessions

---

**Document Version**: 1.0
**Prepared by**: AI Assistant
**Date**: 2025-01-09
**Status**: Awaiting Review
