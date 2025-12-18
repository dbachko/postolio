# API Scripts

This directory contains utility scripts for seeding and managing development data.

## Scripts

### `seed-dev.ts` - Development Database Seeding

Seeds the database with a complete test user, brand, campaigns, and content for development.

**Updated Features:**

- ✅ Creates Instagram account connection data for brands
- ✅ Creates Facebook Page connection data for brands
- ✅ Generates realistic Instagram profile metadata
- ✅ Creates varied campaigns with different statuses
- ✅ Generates content across all content statuses

**Usage:**

```bash
# Basic usage (creates random user with default data)
pnpm --filter=api tsx scripts/seed-dev.ts

# Custom user and brand
pnpm --filter=api tsx scripts/seed-dev.ts \
  --email user@example.com \
  --password MyPassword123 \
  --name "John Doe" \
  --brand "My Brand" \
  --posts 10
```

**Parameters:**

- `--email` - User email (default: random `demo+xxxxx@example.com`)
- `--password` - User password (default: `Test123!@#`)
- `--name` - User name (default: `Demo User`)
- `--brand` - Brand name (default: `Demo Brand`)
- `--posts` - Number of brand-only posts to create (default: `10`)

**What Gets Created:**

1. **User Account**
   - Email, password (bcrypt hashed)
   - Premium subscription tier
   - UTC timezone

2. **Brand with Social Accounts (Instagram + Facebook Page)**
   - Brand name and description
   - Instagram account ID (random, format: `IG_xxxxxxxxxxxxx`)
   - Facebook Page ID (random, format: `FB_xxxxxxxxxxxxx`)
   - Instagram profile data:
     - Username (derived from brand name)
     - Display name
     - Account type (BUSINESS)
     - Follower/following counts (random)
     - Biography and website
     - Profile picture URL
   - Brand defaults:
     - `preferences.primarySocialAccountIds.instagram`
     - `preferences.primarySocialAccountIds.facebook`

3. **7 Demo Campaigns** (all statuses):
   - Onboarding Preview (preview)
   - Launch Momentum (active)
   - Evergreen Education (paused)
   - Winter Seasonal (completed)
   - Thought Leadership Sprint (creating)
   - Experimental Ideas (failed)
   - Batch Processing Queue (processing)

4. **Content Posts** (varied statuses):
   - Published posts with analytics
   - Scheduled posts
   - Draft posts
   - Failed posts with errors
   - Skipped posts

**Output:**

The script prints credentials and IDs after completion:

```
✅ Seed complete
--- Credentials ---
Email:    demo+abc123@example.com
Password: Test123!@#
-------------------
User ID:  cuid_user_123
Brand ID: cuid_brand_456
```

---

### `generate-brand-analysis.ts` - Random Brand Analysis Generator

Generates random brand analysis data including visual styles, voice tones, content topics, and audience insights.

**Usage:**

```bash
# Generate brand analysis for a brand (DynamoDB required)
pnpm --filter=api tsx scripts/generate-brand-analysis.ts \
  --brandId <brand-id> \
  --version 1
```

**Parameters:**

- `--brandId` (required) - The brand ID from your database
- `--version` (optional) - Analysis version number (default: `1`)

**Prerequisites:**

To store data in DynamoDB, set the `BRAND_STYLE_PROFILES_TABLE` environment variable:

```bash
export BRAND_STYLE_PROFILES_TABLE=YourTableName
```

**What Gets Generated:**

1. **Brand Archetype** (e.g., "Minimalist Modern", "Bold & Vibrant")
2. **Voice Profile**
   - 3 primary tones (e.g., professional, casual, inspirational)
   - Style guide description
   - Dos and Don'ts

3. **Visual Identity**
   - 5-color palette (hex codes)
   - Motifs (recurring visual elements)
   - Composition techniques
   - 3-4 inferred visual styles with:
     - Emoji identifier
     - Style title (e.g., "Clean Minimal", "Product Focus")
     - DALL-E optimized description

4. **Content Analysis**
   - Top 5 content topics with frequency scores
   - 2 emerging topics
   - Hashtag strategy
   - Engagement patterns (posting times, avg metrics)

5. **Audience Demographics**
   - Primary age group
   - Gender distribution
   - Top 3 locations
   - Interest categories

6. **Recommendations**
   - Content type suggestions
   - Posting schedule
   - Engagement tactics

**Example Output:**

```json
{
  "brandId": "cuid_brand_123",
  "version": 1,
  "archetype": "Minimalist Modern",
  "voice": {
    "primaryTones": ["professional", "inspirational", "friendly"]
  },
  "visual": {
    "inferredStyles": [
      {
        "emoji": "✨",
        "title": "Clean Minimal",
        "description": "minimalist photography, soft natural lighting, centered composition, white and pastel color palette"
      }
    ]
  }
}
```

**Without DynamoDB:**

If `BRAND_STYLE_PROFILES_TABLE` is not set, the script will print the generated analysis to console without storing it:

```bash
pnpm --filter=api tsx scripts/generate-brand-analysis.ts --brandId <brand-id>
# Prints: Generated analysis (would be stored in DynamoDB):
# { ... full JSON ... }
```

---

## Workflow Example

Complete setup for a new development brand:

```bash
# 1. Seed a brand with Instagram connection
pnpm --filter=api tsx scripts/seed-dev.ts --brand "Coffee Shop Co"

# Output shows Brand ID: cuid_brand_xyz

# 2. Generate brand analysis (if DynamoDB is available)
pnpm --filter=api tsx scripts/generate-brand-analysis.ts \
  --brandId cuid_brand_xyz \
  --version 1
```

Now you have a fully seeded brand with:

- ✅ Instagram connection
- ✅ Campaigns and content
- ✅ Brand analysis with visual styles

---

## Notes

- **Database:** Both scripts require a PostgreSQL database connection via `DATABASE_URL`
- **Instagram Data:** The generated Instagram IDs are random and for development only
- **Brand Analysis:** Analysis data is stored in DynamoDB (optional)
- **Randomization:** Each run generates different random data for variety
