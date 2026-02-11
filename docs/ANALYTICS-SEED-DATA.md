# Analytics Seed Data Reference

## ✅ Seed Status

**Last Seeded**: December 22, 2024
**Status**: Complete - All analytics data successfully created

## 🔐 Test Credentials

```bash
Email:    demo+k4kyqc@example.com
Password: Test123!@#
```

**Note**: Email changes each time you run `pnpm dev:seed`. Check console output for latest credentials.

## 📊 Analytics Data Created

### Social Accounts

- **Instagram**: `@demo_brand_official`
  - Followers: ~1,000-10,000 (randomized)
  - Full audience demographics (age, gender, location, locales)
  - Account metadata (bio, website, profile picture)

- **Facebook**: `Demo Brand Page`
  - Linked to Instagram account
  - Ready for Facebook-specific analytics

### Published Content

- **50 Total Published Posts** across 90 days
  - **38 Historical Posts**: Spanning last 90 days for time-series analytics
  - **12 Recent Posts**: A mix of content to exercise sorting and charts

### Publication Metrics

Each published post has complete metrics:

- ✅ **Impressions**: How many times post was viewed
- ✅ **Reach**: Unique accounts that saw the post
- ✅ **Likes**: Engagement metric (varies 0.03-0.07% of reach)
- ✅ **Comments**: Varies 5-15% of likes
- ✅ **Saves**: Varies 10-30% of likes
- ✅ **Shares**: Varies 2-8% of likes
- ✅ **Engagement**: Total (likes + comments + saves + shares)
- ✅ **Engagement Rate**: Calculated (engagement / reach) × 100

**Metric Variety**:

- **5% Viral Posts**: 10-20x normal engagement
- **10% Underperforming**: 0.2-0.5x normal engagement
- **Time-of-Day Variations**: Morning (8-10am), Evening (6-8pm), Lunch (12-2pm) peaks
- **Recency Boost**: Recent posts get higher engagement

### Account-Level Metrics

#### Daily Aggregates (`AccountMetricSample`)

**74 Daily Sample Records** for time-series charts:

- **Impressions per day**: Aggregated from all posts published that day
- **Reach per day**: Aggregated unique reach
- **Period**: 'day'
- **Date Range**: Last 90 days

#### Account Snapshot (`AccountMetricsLatest`)

Latest account-level metrics:

- **Followers**: Current follower count
- **Impressions**: Last day's impressions
- **Reach**: Last day's reach
- **Profile Views**: ~20% of reach
- **Last Updated**: Current timestamp

## 🎯 What Analytics Will Show

### Overview Tab

- **KPI Cards**: Posts, Views (impressions), Reach, Engagement Rate
- **Health Score**: Calculated from engagement rate, follower growth, consistency
- **AI Insights**: Analyzing your 50 published posts
- **Recommendations**: Based on post performance patterns
- **Forecasts**: Predictive analytics using 90 days of data
- **Top Posts**: Grid of best-performing content

### Posts Tab

- **Top Posts Grid**: Sorted by engagement rate
- **Performance Table**: All 50 posts with sortable columns
  - Published date
  - Impressions
  - Reach
  - Likes
  - Comments
  - Saves
  - Shares
  - Engagement Rate
- **Server-Side Sorting**: By date, engagement, reach, or engagement rate

### Insights Tab

- **AI-Generated Insights**: Pattern analysis across your posts
- **Content Themes**: What's working vs. not working
- **Optimal Timing**: Best posting times based on engagement

### Recommendations Tab

- **Optimization Tips**: Improve engagement rate
- **Content Strategy**: What to post more/less of
- **Hashtag Suggestions**: Based on top-performing posts

### Forecasts Tab

- **Growth Projections**: Follower, engagement, reach predictions
- **Trend Analysis**: 30-day forecast based on 90-day history
- **Performance Charts**: Visual time-series data

## 🔄 Re-Seeding

If you need fresh data or different metrics:

```bash
# Full reseed (deletes existing data)
pnpm dev:seed

# Custom seed with parameters
pnpm dev:seed -- --email=custom@example.com --password=CustomPass123! --posts=20
```

**Parameters**:

- `--email`: Custom email address
- `--password`: Custom password
- `--name`: User name
- `--brand`: Brand name
- `--posts`: Number of draft posts to create (default: 10)

**Note**: Historical analytics data is auto-generated regardless of `--posts` parameter.

## 🧪 Testing Analytics Features

### Test Scenarios

1. **Account Switching**
   - Instagram account has full analytics
   - Facebook account has structure (ready for FB-specific data)
   - Switch between accounts to verify routing

2. **Time Periods**
   - 7d period: ~8 posts
   - 30d period: ~16 posts
   - 90d period: All 50 posts

3. **Post Performance Variations**
   - Look for viral posts (10x+ engagement)
   - Check underperforming posts (low engagement)
   - Verify time-of-day impact on metrics

4. **Charts & Visualizations**
   - Impressions Daily chart (74 data points)
   - Reach Daily chart (74 data points)
   - Engagement Rate trends
   - Top Posts grid (visual thumbnails)

5. **Sorting & Filtering**
   - Sort posts by: publishedAt, engagement, reach, engagementRate
   - Toggle ascending/descending order
   - Pagination (20 posts per page)

## 📈 Expected Analytics Values

### Typical Metrics (for ~5,000 followers)

**Average Post**:

- Impressions: 7,500-15,000
- Reach: 5,000-10,000
- Likes: 150-500
- Comments: 8-75
- Saves: 15-150
- Shares: 3-40
- Engagement Rate: 3-8%

**Viral Post** (5% chance):

- Engagement Rate: 30-80%
- Reach: 50,000-100,000+
- Likes: 1,500-7,000+

**Underperforming** (10% chance):

- Engagement Rate: 0.6-2.5%
- Reach: 1,000-3,000
- Likes: 20-100

## 🐛 Troubleshooting

### "Failed to load analytics summary"

**Cause**: Database not running or seed data missing

**Fix**:

```bash
# 1. Start PostgreSQL
docker compose up -d postgres
# OR if using local PostgreSQL, ensure it's running

# 2. Run seed script
pnpm dev:seed

# 3. Restart API server
pnpm dev
```

### "No connected accounts found"

**Cause**: Social accounts not created

**Fix**: Run `pnpm dev:seed` to create Instagram + Facebook accounts

### Empty charts or "No data"

**Cause**: AccountMetricSample records missing

**Check**:

```sql
-- Connect to database
psql postgresql://postgres:postgres@localhost:5432/postolio

-- Verify account_metric_samples
SELECT COUNT(*) FROM account_metric_samples;
-- Should return 74

-- Verify publications
SELECT COUNT(*) FROM content_publications;
-- Should return 50+
```

**Fix**: Run `pnpm dev:seed` again

### Wrong period data

**Cause**: Posts outside selected time range

**Check**: The seed creates posts across 90 days. Change period selector to see more data.

## 📚 Database Structure

### Key Tables

```
social_accounts
├── id (socialAccountId)
├── platform ('instagram' | 'facebook')
├── externalAccountId
├── username
└── metadata (JSON with demographics)

content_publications
├── id (publicationId)
├── contentId
├── socialAccountId
├── externalPostId
├── publishedAt
└── permalink

publication_metrics_latest
├── publicationId
├── impressions
├── reach
├── likes
├── comments
├── saves
├── shares
├── engagement
├── engagementRate
└── lastUpdated

account_metric_samples
├── socialAccountId
├── metricName ('impressions' | 'reach')
├── value
├── period ('day')
├── windowStart (date)
└── asOf (timestamp)

account_metrics_latest
├── socialAccountId
├── followers
├── impressions (last day)
├── reach (last day)
├── profileViews
└── lastUpdated
```

## 🎓 Next Steps

1. **Start the dev server**: `pnpm dev`
2. **Navigate to**: http://localhost:5173/analytics
3. **Login with**: Credentials from seed output
4. **Explore**:
   - Account selector dropdown
   - All 5 tabs (Overview, Posts, Insights, Recommendations, Forecasts)
   - Different time periods (7d, 30d, 90d)
   - Sorting and filtering
   - Post performance variations

---

**Questions?** Check the main analytics documentation: `docs/ANALYTICS-ARCHITECTURE.md`
