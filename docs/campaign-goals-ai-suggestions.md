# AI-Suggested Campaign Goals - Design & Implementation

**Date**: January 2025
**Status**: Proposal
**Related**: Campaign Form Simplification Plan

---

## Executive Summary

Replace free-text goal input with AI-suggested goal cards based on **Brand Analysis** + **Campaign Type**, while preserving the ability to enter custom goals. This reduces cognitive load, provides smart defaults, and maintains the consistent card-based UI pattern established across the wizard.

**Expected Impact**:

- 🎯 **Faster goal selection**: <30 seconds vs 2-3 minutes of thinking
- 📈 **Better goal quality**: Industry-proven goals vs vague user text
- 🤖 **Smarter suggestions**: Leverages existing brand analysis system
- ✨ **Consistent UX**: Same card pattern as Type/Style/Image selection

---

## Problem Statement

**Current**: Users face a blank textarea asking "What are your goals?" This causes:

- Analysis paralysis (blank canvas problem)
- Vague goals like "get more engagement"
- No guidance on best practices
- Time wasted thinking vs doing

**Evidence from Research**:

- 70% of users find multi-step forms more approachable with pre-filled suggestions
- AI-powered goal setting tools show 25% improvement in goal quality
- Users prefer selecting from smart options over writing from scratch

---

## Proposed Solution: Smart Goal Cards

### **Step 2: Goals & Timeline** (Modified UI)

```
┌─────────────────────────────────────────────────────────────────┐
│ Campaign Goals                                                   │
│ Select goals that match your campaign objectives               │
│                                                                   │
│ ✨ Suggested for Promotional Campaigns @ Barber Shop           │
│                                                                   │
│ ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────┐ │
│ │ ☑ Drive Bookings    │  │ ☑ Promote Special   │  │ □ Build  │ │
│ │                     │  │     Offer            │  │   Brand  │ │
│ │ Best for your       │  │                     │  │   Aware. │ │
│ │ business type       │  │ Perfect for promos  │  │          │ │
│ │                     │  │                     │  │          │ │
│ │ ✓ Selected          │  │ ✓ Selected          │  │ Select   │ │
│ └─────────────────────┘  └─────────────────────┘  └──────────┘ │
│                                                                   │
│ ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────┐ │
│ │ □ Showcase New      │  │ □ Increase Social   │  │ ✏️ Custom│ │
│ │     Services        │  │     Engagement      │  │   Goal   │ │
│ │                     │  │                     │  │          │ │
│ │ From your brand     │  │ Recommended for you │  │ Write    │ │
│ │ style               │  │                     │  │ your own │ │
│ │                     │  │                     │  │          │ │
│ │ Select              │  │ Select              │  │ Select   │ │
│ └─────────────────────┘  └─────────────────────┘  └──────────┘ │
│                                                                   │
│ 💡 Based on your brand profile: Professional Barber Shop        │
│                                                                   │
│ [Show More Goals] (if >6 suggestions)                           │
└─────────────────────────────────────────────────────────────────┘

When "Custom Goal" is selected:
┌─────────────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Write Your Custom Goal                                       │ │
│ │                                                               │ │
│ │ ┌───────────────────────────────────────────────────────────┐│ │
│ │ │ Describe what you want to achieve with this campaign...   ││ │
│ │ │                                                             ││ │
│ │ │                                                             ││ │
│ │ └───────────────────────────────────────────────────────────┘│ │
│ │                                                               │ │
│ │ Examples: "Launch new product line" or "Recruit new talent" │ │
│ │                                                               │ │
│ │ [Clear]  [Add Goal]                                          │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### **Key Features**:

1. **Multi-select**: Users can select multiple goal cards (checkboxes, not radio)
2. **Smart sorting**: Top suggestions based on brand + campaign type
3. **Visual badges**: "Best for your business" / "Perfect for promos" / "From your brand style"
4. **Custom fallback**: Always show "Custom Goal" card that reveals textarea
5. **Context awareness**: "Based on your brand profile: Professional Barber Shop"

---

## How It Works: Smart Goal Generation

### **Data Sources** (in priority order):

```typescript
interface GoalSuggestionInput {
  brandId: string;
  campaignType: 'promotional' | 'educational' | 'seasonal' | 'thought_leadership' | 'custom';

  // From brand analysis (if available)
  brandProfile?: {
    classification: {
      brandType: string;        // "Professional Barber Shop"
      confidence: number;
    };
    voice: {
      archetypeScores: {...};   // hero, caregiver, creator, etc.
      toneDimensions: {...};    // formality, enthusiasm, etc.
    };
    topics: {
      keyPhrases: { phrase: string; weight: number }[];
    };
  };
}
```

### **Suggestion Algorithm** (mirrors `theme-suggester.ts` pattern):

```typescript
// packages/apps/api/src/services/goal-suggester.ts

export interface GoalSuggestion {
  value: string; // "Drive online bookings"
  score: number; // 0.85 (0-1)
  source: 'profile' | 'industry' | 'campaign-type' | 'fallback';
  badge?: string; // "Best for your business"
  description?: string; // Short explanation
  kpiSuggestions?: string[]; // ["Booking rate", "Click-through rate"]
}

export async function suggestGoals(input: GoalSuggestionInput): Promise<GoalSuggestion[]> {
  const suggestions: GoalSuggestion[] = [];

  // 1. Brand-specific goals (if brand analysis available)
  if (input.brandProfile) {
    const profileGoals = await getGoalsFromBrandProfile(input.brandProfile, input.campaignType);
    suggestions.push(...profileGoals);
  }

  // 2. Industry + Campaign Type goals (curated templates)
  const industryGoals = getGoalsByIndustryCampaignType(
    input.brandProfile?.classification?.brandType,
    input.campaignType
  );
  suggestions.push(...industryGoals);

  // 3. Campaign type fallbacks (always available)
  const fallbackGoals = FALLBACK_GOALS_BY_TYPE[input.campaignType];
  suggestions.push(...fallbackGoals);

  // 4. Deduplicate, score, and sort
  const unique = deduplicateGoals(suggestions);
  const scored = unique.map((goal) => ({
    ...goal,
    score: calculateGoalScore(goal, input),
  }));

  // Return top 6-8 suggestions
  return scored.sort((a, b) => b.score - a.score).slice(0, 8);
}
```

---

## Goal Templates Library

### **By Campaign Type** (Fallbacks - always available)

```typescript
const FALLBACK_GOALS_BY_TYPE: Record<CampaignType, GoalSuggestion[]> = {
  promotional: [
    {
      value: 'Drive sales and conversions',
      score: 0.9,
      source: 'campaign-type',
      badge: 'Perfect for promos',
      description: 'Increase revenue through promotional offers',
      kpiSuggestions: ['Sales revenue', 'Conversion rate', 'Average order value'],
    },
    {
      value: 'Promote limited-time offer',
      score: 0.85,
      source: 'campaign-type',
      description: 'Create urgency with time-sensitive deals',
      kpiSuggestions: ['Offer redemption rate', 'Click-through rate'],
    },
    {
      value: 'Clear excess inventory',
      score: 0.75,
      source: 'campaign-type',
      description: 'Move seasonal or overstocked products',
    },
    {
      value: 'Acquire new customers',
      score: 0.8,
      source: 'campaign-type',
      description: 'Attract first-time buyers with special offers',
      kpiSuggestions: ['New customer acquisition', 'First purchase rate'],
    },
  ],

  educational: [
    {
      value: 'Establish thought leadership',
      score: 0.9,
      source: 'campaign-type',
      badge: 'Build authority',
      description: 'Position your brand as an industry expert',
      kpiSuggestions: ['Content shares', 'Time on page', 'Return visitors'],
    },
    {
      value: 'Educate customers about products/services',
      score: 0.85,
      source: 'campaign-type',
      description: 'Help customers understand value and usage',
      kpiSuggestions: ['Tutorial completions', 'Support ticket reduction'],
    },
    {
      value: 'Build brand trust and credibility',
      score: 0.8,
      source: 'campaign-type',
      description: 'Share expertise to earn customer confidence',
    },
    {
      value: 'Drive newsletter signups',
      score: 0.75,
      source: 'campaign-type',
      description: 'Grow your email list with valuable content',
      kpiSuggestions: ['Email signups', 'Subscription rate'],
    },
  ],

  seasonal: [
    {
      value: 'Capitalize on seasonal demand',
      score: 0.9,
      source: 'campaign-type',
      badge: 'Timely opportunity',
      description: 'Maximize revenue during peak season',
      kpiSuggestions: ['Seasonal sales lift', 'YoY growth'],
    },
    {
      value: 'Create holiday buzz and engagement',
      score: 0.85,
      source: 'campaign-type',
      description: 'Generate excitement around holiday events',
      kpiSuggestions: ['Social engagement rate', 'Brand mentions'],
    },
    {
      value: 'Promote seasonal products/services',
      score: 0.8,
      source: 'campaign-type',
      description: 'Highlight time-relevant offerings',
    },
  ],

  thought_leadership: [
    {
      value: 'Influence industry conversation',
      score: 0.9,
      source: 'campaign-type',
      badge: 'Lead the discussion',
      description: 'Shape how your industry thinks about key topics',
      kpiSuggestions: ['Industry mentions', 'Media pickups', 'Shares by influencers'],
    },
    {
      value: 'Attract strategic partnerships',
      score: 0.85,
      source: 'campaign-type',
      description: 'Demonstrate expertise to potential partners',
    },
    {
      value: 'Recruit top talent',
      score: 0.8,
      source: 'campaign-type',
      description: 'Showcase company culture and vision',
      kpiSuggestions: ['LinkedIn followers', 'Job applications', 'Quality of applicants'],
    },
  ],

  custom: [
    {
      value: 'Increase brand awareness',
      score: 0.7,
      source: 'fallback',
      description: 'Get your brand in front of more people',
      kpiSuggestions: ['Reach', 'Impressions', 'New followers'],
    },
    {
      value: 'Boost social media engagement',
      score: 0.65,
      source: 'fallback',
      description: 'Get more likes, comments, and shares',
      kpiSuggestions: ['Engagement rate', 'Comments', 'Shares'],
    },
  ],
};
```

### **By Industry × Campaign Type** (Smart Templates)

```typescript
// Industry-specific goal templates
const INDUSTRY_CAMPAIGN_GOALS: Record<string, Record<CampaignType, GoalSuggestion[]>> = {
  'barber|salon|beauty': {
    promotional: [
      {
        value: 'Drive online bookings',
        score: 0.95,
        source: 'industry',
        badge: 'Best for your business',
        description: 'Fill your appointment calendar with new clients',
        kpiSuggestions: ['Booking rate', 'New client bookings', 'Repeat bookings'],
      },
      {
        value: 'Promote new services or stylists',
        score: 0.9,
        source: 'industry',
        description: 'Introduce new offerings to your audience',
      },
      {
        value: 'Fill slow time slots',
        score: 0.85,
        source: 'industry',
        description: 'Boost bookings during off-peak hours',
      },
    ],
    educational: [
      {
        value: 'Share grooming tips and trends',
        score: 0.9,
        source: 'industry',
        description: 'Position yourself as a style expert',
      },
      {
        value: 'Showcase before/after transformations',
        score: 0.85,
        source: 'industry',
        description: 'Demonstrate your skills and results',
      },
    ],
  },

  'restaurant|cafe|food': {
    promotional: [
      {
        value: 'Drive foot traffic and reservations',
        score: 0.95,
        source: 'industry',
        badge: 'Best for your business',
        description: 'Fill tables during peak and off-peak times',
        kpiSuggestions: ['Reservation rate', 'Table turnover', 'Walk-ins'],
      },
      {
        value: 'Promote daily specials or new menu items',
        score: 0.9,
        source: 'industry',
        description: 'Highlight fresh offerings to attract diners',
      },
      {
        value: 'Boost takeout and delivery orders',
        score: 0.85,
        source: 'industry',
        description: 'Increase off-premise sales',
      },
    ],
    seasonal: [
      {
        value: 'Promote holiday menus or catering',
        score: 0.95,
        source: 'industry',
        description: 'Capitalize on seasonal dining occasions',
      },
    ],
  },

  'fitness|gym|wellness': {
    promotional: [
      {
        value: 'Drive membership signups',
        score: 0.95,
        source: 'industry',
        badge: 'Best for your business',
        description: 'Convert prospects into paying members',
        kpiSuggestions: ['Signup rate', 'Trial conversions', 'Member retention'],
      },
      {
        value: 'Fill class schedules',
        score: 0.9,
        source: 'industry',
        description: 'Maximize class attendance and revenue',
      },
      {
        value: 'Promote personal training packages',
        score: 0.85,
        source: 'industry',
        description: 'Upsell high-value services',
      },
    ],
    seasonal: [
      {
        value: 'Capitalize on New Year fitness goals',
        score: 0.95,
        source: 'industry',
        description: 'Maximize January membership surge',
      },
    ],
  },

  'kindergarten|daycare|preschool|education': {
    promotional: [
      {
        value: 'Drive enrollment applications',
        score: 0.95,
        source: 'industry',
        badge: 'Best for your business',
        description: 'Fill available spots with qualified families',
        kpiSuggestions: ['Application rate', 'Tour bookings', 'Enrollment conversions'],
      },
      {
        value: 'Promote open house events',
        score: 0.9,
        source: 'industry',
        description: 'Get families to visit and experience your facility',
      },
    ],
    educational: [
      {
        value: 'Showcase curriculum and learning outcomes',
        score: 0.9,
        source: 'industry',
        description: 'Demonstrate educational value to parents',
      },
      {
        value: 'Build trust with parent community',
        score: 0.85,
        source: 'industry',
        description: 'Establish reputation as caring educators',
      },
    ],
  },

  'retail|ecommerce|shop': {
    promotional: [
      {
        value: 'Drive online and in-store sales',
        score: 0.95,
        source: 'industry',
        badge: 'Best for your business',
        description: 'Increase revenue across all channels',
        kpiSuggestions: ['Sales revenue', 'Conversion rate', 'Average order value'],
      },
      {
        value: 'Clear seasonal inventory',
        score: 0.9,
        source: 'industry',
        description: 'Move stock before new season arrives',
      },
      {
        value: 'Launch new product collection',
        score: 0.85,
        source: 'industry',
        description: 'Generate excitement for latest offerings',
      },
    ],
  },

  'real estate|realtor|property': {
    promotional: [
      {
        value: 'Generate qualified leads',
        score: 0.95,
        source: 'industry',
        badge: 'Best for your business',
        description: 'Find serious buyers and sellers',
        kpiSuggestions: ['Lead quality score', 'Consultation bookings', 'Listings requested'],
      },
      {
        value: 'Showcase new listings',
        score: 0.9,
        source: 'industry',
        description: 'Attract buyers to your properties',
      },
      {
        value: 'Promote open houses',
        score: 0.85,
        source: 'industry',
        description: 'Drive foot traffic to viewings',
      },
    ],
  },

  'tech|saas|software': {
    promotional: [
      {
        value: 'Drive free trial signups',
        score: 0.95,
        source: 'industry',
        badge: 'Best for your business',
        description: 'Convert prospects into trial users',
        kpiSuggestions: ['Trial signup rate', 'Trial-to-paid conversion', 'Activation rate'],
      },
      {
        value: 'Promote product launch or new features',
        score: 0.9,
        source: 'industry',
        description: 'Generate excitement for latest updates',
      },
    ],
    educational: [
      {
        value: 'Educate market on product value',
        score: 0.9,
        source: 'industry',
        description: 'Help prospects understand use cases',
      },
    ],
  },
};
```

---

## Brand Profile Enhancement (AI Layer)

For brands with **Brand Analysis** completed, we can generate even more personalized goals using LLM:

### **API Endpoint**: `POST /api/campaigns/suggest-goals`

**Request**:

```typescript
{
  brandId: string;
  campaignType: 'promotional' | 'educational' | 'seasonal' | 'thought_leadership' | 'custom';
}
```

**Response**:

```typescript
{
  suggestions: GoalSuggestion[];
  brandContext: {
    brandType: string;        // "Professional Barber Shop"
    confidence: number;       // 0.92
    topThemes: string[];      // ["men's grooming", "beard care", "classic cuts"]
  };
}
```

### **LLM Prompt** (for personalized goals):

```typescript
// packages/apps/api/src/services/goal-suggester.ts

async function getGoalsFromBrandProfile(
  profile: BrandProfile,
  campaignType: CampaignType
): Promise<GoalSuggestion[]> {
  const prompt = `
You are analyzing a brand to suggest campaign goals.

Brand Information:
- Type: ${profile.classification.brandType}
- Voice Archetype: ${getTopArchetype(profile.voice.archetypeScores)}
- Tone: ${describeTone(profile.voice.toneDimensions)}
- Top Topics: ${profile.topics.keyPhrases
    .slice(0, 5)
    .map((p) => p.phrase)
    .join(', ')}

Campaign Type: ${campaignType}

Task: Suggest 3-5 specific, actionable goals for a ${campaignType} campaign that:
1. Align with this brand's voice and audience
2. Leverage their existing content themes
3. Are measurable and time-bound
4. Use industry best practices for ${profile.classification.brandType}

Return as JSON array:
[
  {
    "value": "goal statement",
    "description": "1-sentence explanation",
    "rationale": "why this fits this brand",
    "kpiSuggestions": ["metric 1", "metric 2"]
  }
]
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const parsed = JSON.parse(response.choices[0].message.content);

  return parsed.map((goal: any, index: number) => ({
    value: goal.value,
    score: 0.95 - index * 0.05, // Top suggestions get higher scores
    source: 'profile' as const,
    badge: index === 0 ? 'Tailored for your brand' : undefined,
    description: goal.description,
    kpiSuggestions: goal.kpiSuggestions,
  }));
}
```

---

## Even Better Ideas 💡

### **1. Past Campaign Goals (Learning from History)**

Show goals from user's previous successful campaigns:

```typescript
interface HistoricalGoal extends GoalSuggestion {
  source: 'past-campaign';
  badge: '✓ Worked well before';
  campaignName: string;
  performanceMetric?: string; // "3.2% engagement rate"
}

// Example:
{
  value: "Drive Instagram story engagement",
  score: 0.98,
  source: 'past-campaign',
  badge: '✓ Worked well before',
  description: "From your 'Summer Sale 2024' campaign",
  campaignName: "Summer Sale 2024",
  performanceMetric: "5.8% engagement (2x your average)",
}
```

**Implementation**:

```typescript
async function getPastSuccessfulGoals(brandId: string): Promise<HistoricalGoal[]> {
  // Get completed campaigns with high performance
  const campaigns = await prisma.campaign.findMany({
    where: {
      brandId,
      status: 'completed',
      // Filter by performance threshold (top 25%)
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  // Extract goals from successful campaigns
  return campaigns.flatMap((campaign) =>
    parseGoalsFromCampaign(campaign).map((goal) => ({
      ...goal,
      source: 'past-campaign',
      badge: '✓ Worked well before',
      campaignName: campaign.name,
      performanceMetric: formatPerformance(campaign),
    }))
  );
}
```

---

### **2. Trending Goals (What Similar Brands Are Doing)**

Show popular goals among similar brands:

```typescript
interface TrendingGoal extends GoalSuggestion {
  source: 'trending';
  badge: '📈 Popular with similar brands';
  adoptionRate: number; // 0.35 = 35% of similar brands using this
}

// Example:
{
  value: "Build email list with lead magnet",
  score: 0.85,
  source: 'trending',
  badge: '📈 Popular with similar brands',
  description: "35% of similar businesses are focusing on this",
  adoptionRate: 0.35,
}
```

---

### **3. Goal Refinement (AI Polish)**

After user selects goal cards, offer AI refinement:

```
┌─────────────────────────────────────────────────────────────────┐
│ Selected Goals (2)                                               │
│                                                                   │
│ ☑ Drive online bookings                                         │
│ ☑ Promote limited-time offer                                    │
│                                                                   │
│ [✨ Refine with AI]                                             │
└─────────────────────────────────────────────────────────────────┘

After clicking "Refine with AI":

┌─────────────────────────────────────────────────────────────────┐
│ Refined Goals                                                    │
│                                                                   │
│ Goal 1: Drive online bookings                                   │
│ ↓                                                                 │
│ "Increase online booking rate by 30% through Instagram           │
│  Stories featuring limited-time discounts for first-time         │
│  clients, targeting 15 new bookings per week."                  │
│                                                                   │
│ Goal 2: Promote limited-time offer                              │
│ ↓                                                                 │
│ "Promote '20% off first haircut' offer to drive 50 new client   │
│  acquisitions over 14 days, tracking with promo code IG20."     │
│                                                                   │
│ [Accept Refinements]  [Edit Manually]                           │
└─────────────────────────────────────────────────────────────────┘
```

---

### **4. Goal + KPI Suggestion (SMART Goals)**

Automatically suggest KPIs for each selected goal:

```
┌─────────────────────────────────────────────────────────────────┐
│ Goal: Drive online bookings                                      │
│                                                                   │
│ Suggested Metrics to Track:                                     │
│ ☑ Booking conversion rate (target: 5%)                          │
│ ☑ Number of new clients (target: 20/week)                       │
│ □ Average booking value (target: $45)                           │
│                                                                   │
│ [Auto-create dashboard] [Skip for now]                          │
└─────────────────────────────────────────────────────────────────┘
```

---

### **5. Competitive Insights (Industry Benchmarks)**

Show what's working in their industry:

```
┌─────────────────────────────────────────────────────────────────┐
│ 💡 Industry Insight                                             │
│                                                                   │
│ 73% of successful barber shop promotional campaigns focus on    │
│ "Drive online bookings" with an average 4.2% conversion rate.   │
│                                                                   │
│ [See more insights]                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### **Phase 1: Basic Goal Cards** (1 week)

**TASK 1.1**: Create `goal-suggester.ts` service (mirror `theme-suggester.ts`)

- Template library by campaign type
- Basic scoring algorithm
- API endpoint `/api/campaigns/suggest-goals`

**TASK 1.2**: Update Step 2 UI to show goal cards

- Replace textarea with grid of `SelectionCard` components
- Multi-select checkboxes (not radio)
- Custom goal card reveals textarea
- Show "Based on your brand" context

**TASK 1.3**: Update wizard state to store selected goals

- Change from `goals: string` to `goals: string[]` (array)
- Backend accepts array or string for backward compatibility

**TASK 1.4**: Add industry × campaign type templates

- 8-10 industry patterns
- 4 campaign types per industry
- Fallback to campaign-type-only if industry not matched

---

### **Phase 2: Brand Profile Integration** (1 week)

**TASK 2.1**: Integrate brand analysis lookup

- Fetch brand profile on suggestion request
- Extract `brandType` from classification
- Use for industry matching

**TASK 2.2**: Add LLM-powered personalized goals

- Create prompt template
- Call OpenAI for top 3 personalized suggestions
- Merge with template goals and score

**TASK 2.3**: Add confidence scoring

- Score based on: brand profile quality + industry match + campaign type
- Show "✨ Suggested for you" badge for high-confidence matches

---

### **Phase 3: Advanced Features** (2 weeks)

**TASK 3.1**: Past campaign goals

- Query completed campaigns
- Extract and parse goals
- Show "✓ Worked well before" badge

**TASK 3.2**: Goal refinement with AI

- "Refine with AI" button after selection
- LLM polishes into SMART goals
- Show before/after comparison

**TASK 3.3**: KPI suggestions

- Map goals to common KPIs
- Auto-suggest tracking metrics
- Optional: Create dashboard

**TASK 3.4**: Trending goals

- Anonymized aggregation across brands
- Filter by similar brandType
- Show adoption rate

---

## Technical Implementation Details

### **File Structure**

```
packages/apps/api/src/services/
  goal-suggester.ts              # NEW: Core suggestion logic
  goal-templates.ts              # NEW: Industry × type templates

packages/apps/api/src/routes/
  goal-suggestions.ts            # NEW: API endpoint

packages/apps/web/src/components/campaign-wizard/
  steps/
    Step2CampaignBrief.tsx       # MODIFY: Add goal cards UI
  shared/
    GoalCard.tsx                 # NEW: Goal selection card
    GoalRefinementModal.tsx      # NEW: AI refinement (Phase 3)
```

### **API Endpoint**

```typescript
// packages/apps/api/src/routes/goal-suggestions.ts

import { FastifyPluginAsync } from 'fastify';
import { suggestGoals } from '../services/goal-suggester.js';

const goalSuggestionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: { brandId: string; campaignType: string };
  }>('/api/campaigns/suggest-goals', async (request, reply) => {
    const { brandId, campaignType } = request.query;

    const suggestions = await suggestGoals({
      brandId,
      campaignType: campaignType as CampaignType,
    });

    return { success: true, suggestions };
  });
};

export default goalSuggestionRoutes;
```

### **Frontend Component**

```tsx
// packages/apps/web/src/components/campaign-wizard/steps/Step2CampaignBrief.tsx

import { useQuery } from '@tanstack/react-query';
import { SelectionCard } from '../shared/SelectionCard';
import { Textarea } from '@/components/ui/textarea';

export function Step2CampaignBrief() {
  const { campaignType, goals, updateField } = useCampaignWizard();
  const brand = useBrandStore((s) => s.selectedBrand);

  // Fetch goal suggestions
  const { data: suggestions } = useQuery({
    queryKey: ['goal-suggestions', brand?.id, campaignType],
    queryFn: () => campaignApi.suggestGoals(brand!.id, campaignType!),
    enabled: !!brand && !!campaignType,
  });

  const [showCustomGoal, setShowCustomGoal] = useState(false);
  const [customGoalText, setCustomGoalText] = useState('');

  const toggleGoal = (goalValue: string) => {
    const current = goals || [];
    if (current.includes(goalValue)) {
      updateField(
        'goals',
        current.filter((g) => g !== goalValue)
      );
    } else {
      updateField('goals', [...current, goalValue]);
    }
  };

  const addCustomGoal = () => {
    if (customGoalText.trim()) {
      updateField('goals', [...(goals || []), customGoalText.trim()]);
      setCustomGoalText('');
      setShowCustomGoal(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 font-medium">Campaign Goals</h3>
        <p className="text-muted-foreground text-sm">
          Select goals that match your campaign objectives
        </p>
      </div>

      {suggestions?.brandContext && (
        <div className="text-muted-foreground text-sm">
          ✨ Suggested for {suggestions.brandContext.brandType}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {suggestions?.suggestions.map((suggestion) => (
          <SelectionCard
            key={suggestion.value}
            title={suggestion.value}
            description={suggestion.description || ''}
            badge={suggestion.badge}
            selected={(goals || []).includes(suggestion.value)}
            onClick={() => toggleGoal(suggestion.value)}
            multiSelect
          />
        ))}

        {/* Custom Goal Card */}
        <SelectionCard
          icon="✏️"
          title="Custom Goal"
          description="Write your own goal"
          selected={showCustomGoal}
          onClick={() => setShowCustomGoal(!showCustomGoal)}
        />
      </div>

      {showCustomGoal && (
        <Card>
          <CardContent className="pt-6">
            <Label>Write Your Custom Goal</Label>
            <Textarea
              placeholder="Describe what you want to achieve..."
              value={customGoalText}
              onChange={(e) => setCustomGoalText(e.target.value)}
              className="mt-2"
            />
            <div className="mt-3 flex gap-2">
              <Button variant="outline" onClick={() => setShowCustomGoal(false)}>
                Cancel
              </Button>
              <Button onClick={addCustomGoal}>Add Goal</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Show selected goals summary */}
      {goals && goals.length > 0 && (
        <div className="rounded-lg border p-4">
          <h4 className="mb-2 font-medium">Selected Goals ({goals.length})</h4>
          <ul className="space-y-1">
            {goals.map((goal, index) => (
              <li key={index} className="flex items-center gap-2 text-sm">
                <CheckCircle className="text-primary h-4 w-4" />
                {goal}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

---

## Success Metrics

### **Primary Metrics**

- **Goal Selection Speed**: Target <30 seconds (vs 2-3 minutes free-text)
- **Goal Quality Score**: Manual QA of goal specificity (target 4/5)
- **Suggestion Accuracy**: % of users who select suggested goals vs custom (target >70%)

### **Secondary Metrics**

- **Multi-goal adoption**: % of users selecting 2+ goals (target >60%)
- **Custom goal usage**: % still writing custom goals (expect ~20-30%)
- **Step completion**: Completion rate for Step 2 (target >85%)

### **A/B Test Metrics**

Test: Goal Cards vs Free Text

- Completion rate
- Time on step
- Campaign performance (launch to completion)

---

## Edge Cases & Fallbacks

### **No Brand Analysis Available**

If brand hasn't completed brand analysis:

- Skip LLM-personalized goals
- Use campaign type + generic industry fallbacks
- Show message: "Complete brand analysis for personalized suggestions"

### **No Industry Match**

If `brandType` doesn't match any industry template:

- Use campaign type fallbacks only
- Still show LLM-personalized goals if brand profile exists

### **API Failure**

If suggestion endpoint fails:

- Fall back to campaign-type-only templates (hardcoded in frontend)
- Show custom goal card prominently

### **Empty Suggestions**

If somehow zero suggestions returned:

- Always show "Custom Goal" card
- Gracefully degrade to free-text input

---

## User Experience Flow

### **Happy Path**:

1. User selects "Promotional" campaign type in Step 1
2. Arrives at Step 2
3. Sees "✨ Suggested for Professional Barber Shop"
4. 6 goal cards appear with badges ("Best for your business", etc.)
5. User clicks 2-3 goal cards
6. Sees summary: "Selected Goals (3)"
7. Clicks Continue → Strategy generation uses structured goals

### **Custom Goal Path**:

1. User doesn't like suggested goals
2. Clicks "Custom Goal" card
3. Textarea appears
4. Writes custom goal: "Promote new celebrity barber hire"
5. Clicks "Add Goal"
6. Goal added to selection
7. Can still select suggested goals too (mixed)

---

## Why This Approach is Better

### **vs. Free Text**:

✅ Faster (30s vs 2-3min)
✅ Better quality (proven templates)
✅ Consistent format (easier for AI to parse)
✅ Educational (shows what's possible)

### **vs. Dropdown/Select**:

✅ Multi-select (users often have multiple goals)
✅ Visual/scannable (cards > list)
✅ Descriptive (shows why each goal fits)
✅ Consistent UI (matches rest of wizard)

### **vs. Just AI Generation**:

✅ User control (select, don't accept blindly)
✅ Faster (no waiting for LLM)
✅ Transparent (see why suggestions made)
✅ Fallback (works without brand analysis)

---

## Questions for Review

1. **Goal count**: Allow unlimited selections or cap at 5-6?
2. **Required vs optional**: Require at least 1 goal or allow skipping?
3. **Goal refinement**: Phase 3 feature or essential for Phase 1?
4. **Past campaigns**: Only show if campaign had positive performance? What threshold?
5. **Industry matching**: Use exact match or fuzzy matching? (e.g., "barbershop" matches "barber|salon"?)

---

## Next Steps

1. **Review this proposal** - Confirm approach alignment
2. **Prioritize phases** - Phase 1 only or include Phase 2?
3. **Refine templates** - Add more industries? Adjust wording?
4. **Start implementation** - Begin with TASK 1.1 if approved

---

**Document Status**: Proposal Ready for Review
**Estimated Effort**:

- Phase 1: 1 week
- Phase 2: +1 week
- Phase 3: +2 weeks
  **Total**: 4 weeks for complete implementation
