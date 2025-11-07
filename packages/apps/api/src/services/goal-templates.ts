/**
 * Goal Templates Library
 *
 * Tag-based goal templates for AI-suggested campaign goals.
 * Templates are matched against brand profile using flexible tag matching.
 */

export type CampaignType =
  | 'promotional'
  | 'educational'
  | 'seasonal'
  | 'thought_leadership'
  | 'custom';

export interface GoalTemplate {
  value: string;
  tags: string[]; // Industry/brand type tags for matching
  campaignTypes: CampaignType[]; // Applicable campaign types
  priority?: number; // Higher = more likely to suggest (default: 1)
}

/**
 * Comprehensive goal template library
 * Organized by industry/brand type tags for flexible matching
 */
export const GOAL_TEMPLATES: GoalTemplate[] = [
  // ============================================
  // Service-Based Business Goals
  // ============================================
  // Barber, Salon, Beauty
  {
    value: 'Drive online bookings and appointments',
    tags: ['barber', 'salon', 'beauty', 'spa', 'wellness', 'service-based'],
    campaignTypes: ['promotional', 'seasonal'],
    priority: 2,
  },
  {
    value: 'Showcase transformation results and portfolio work',
    tags: ['barber', 'salon', 'beauty', 'spa', 'tattoo', 'creative'],
    campaignTypes: ['promotional', 'educational'],
    priority: 2,
  },
  {
    value: 'Educate customers on hair care and styling tips',
    tags: ['barber', 'salon', 'beauty'],
    campaignTypes: ['educational', 'thought_leadership'],
  },
  {
    value: 'Promote seasonal services and special packages',
    tags: ['barber', 'salon', 'beauty', 'spa', 'wellness'],
    campaignTypes: ['seasonal', 'promotional'],
  },
  {
    value: 'Build trust through client testimonials and reviews',
    tags: ['barber', 'salon', 'beauty', 'spa', 'service-based'],
    campaignTypes: ['promotional', 'thought_leadership'],
  },

  // Health & Wellness
  {
    value: 'Encourage wellness program sign-ups',
    tags: ['wellness', 'fitness', 'gym', 'yoga', 'health'],
    campaignTypes: ['promotional', 'seasonal'],
  },
  {
    value: 'Share fitness tips and workout routines',
    tags: ['fitness', 'gym', 'wellness', 'health'],
    campaignTypes: ['educational'],
  },
  {
    value: 'Promote class schedules and memberships',
    tags: ['fitness', 'gym', 'yoga', 'dance', 'wellness'],
    campaignTypes: ['promotional'],
  },

  // ============================================
  // Retail & E-commerce Goals
  // ============================================
  {
    value: 'Drive online sales and conversions',
    tags: ['retail', 'ecommerce', 'store', 'shop', 'boutique'],
    campaignTypes: ['promotional', 'seasonal'],
    priority: 2,
  },
  {
    value: 'Increase cart value through product bundles',
    tags: ['retail', 'ecommerce', 'shop'],
    campaignTypes: ['promotional'],
  },
  {
    value: 'Showcase new arrivals and collections',
    tags: ['retail', 'fashion', 'boutique', 'clothing', 'accessories'],
    campaignTypes: ['promotional', 'seasonal'],
  },
  {
    value: 'Build brand awareness and reach new audiences',
    tags: ['retail', 'ecommerce', 'fashion', 'lifestyle'],
    campaignTypes: ['promotional', 'thought_leadership'],
  },
  {
    value: 'Create urgency with limited-time offers',
    tags: ['retail', 'ecommerce', 'shop'],
    campaignTypes: ['promotional', 'seasonal'],
  },
  {
    value: 'Educate customers on product features and benefits',
    tags: ['retail', 'ecommerce', 'tech', 'electronics'],
    campaignTypes: ['educational'],
  },

  // ============================================
  // Food & Beverage Goals
  // ============================================
  {
    value: 'Increase foot traffic and reservations',
    tags: ['restaurant', 'cafe', 'bar', 'food', 'dining'],
    campaignTypes: ['promotional', 'seasonal'],
  },
  {
    value: 'Promote daily specials and menu items',
    tags: ['restaurant', 'cafe', 'bar', 'food'],
    campaignTypes: ['promotional'],
  },
  {
    value: 'Share recipes and cooking tips',
    tags: ['restaurant', 'cafe', 'food', 'bakery'],
    campaignTypes: ['educational'],
  },
  {
    value: 'Highlight seasonal menu and events',
    tags: ['restaurant', 'cafe', 'bar', 'food'],
    campaignTypes: ['seasonal', 'promotional'],
  },
  {
    value: 'Build community through food stories',
    tags: ['restaurant', 'cafe', 'food'],
    campaignTypes: ['thought_leadership', 'educational'],
  },

  // ============================================
  // Professional Services Goals
  // ============================================
  {
    value: 'Generate qualified leads and consultations',
    tags: ['consulting', 'agency', 'professional', 'b2b', 'legal', 'accounting'],
    campaignTypes: ['promotional', 'thought_leadership'],
    priority: 2,
  },
  {
    value: 'Establish thought leadership in industry',
    tags: ['consulting', 'agency', 'professional', 'b2b'],
    campaignTypes: ['thought_leadership', 'educational'],
  },
  {
    value: 'Showcase case studies and success stories',
    tags: ['consulting', 'agency', 'professional', 'b2b', 'marketing'],
    campaignTypes: ['promotional', 'thought_leadership'],
  },
  {
    value: 'Educate audience on industry best practices',
    tags: ['consulting', 'agency', 'professional', 'b2b'],
    campaignTypes: ['educational', 'thought_leadership'],
  },

  // ============================================
  // Creative & Arts Goals
  // ============================================
  {
    value: 'Showcase portfolio and creative work',
    tags: ['creative', 'artist', 'designer', 'photographer', 'tattoo'],
    campaignTypes: ['promotional'],
  },
  {
    value: 'Book commissions and project inquiries',
    tags: ['creative', 'artist', 'designer', 'photographer'],
    campaignTypes: ['promotional'],
  },
  {
    value: 'Share creative process and behind-the-scenes',
    tags: ['creative', 'artist', 'designer', 'photographer'],
    campaignTypes: ['educational', 'thought_leadership'],
  },
  {
    value: 'Build following and engagement with art community',
    tags: ['creative', 'artist', 'designer', 'photographer'],
    campaignTypes: ['thought_leadership'],
  },

  // ============================================
  // Education & Training Goals
  // ============================================
  {
    value: 'Drive course enrollments and sign-ups',
    tags: ['education', 'training', 'school', 'academy', 'coaching'],
    campaignTypes: ['promotional'],
  },
  {
    value: 'Share educational content and insights',
    tags: ['education', 'training', 'school', 'academy'],
    campaignTypes: ['educational', 'thought_leadership'],
  },
  {
    value: 'Build authority as industry educator',
    tags: ['education', 'training', 'coaching'],
    campaignTypes: ['thought_leadership', 'educational'],
  },
  {
    value: 'Promote upcoming workshops and events',
    tags: ['education', 'training', 'school', 'academy'],
    campaignTypes: ['promotional', 'seasonal'],
  },

  // ============================================
  // Real Estate Goals
  // ============================================
  {
    value: 'Generate property inquiries and viewings',
    tags: ['real-estate', 'property', 'realtor'],
    campaignTypes: ['promotional'],
  },
  {
    value: 'Showcase listings and property tours',
    tags: ['real-estate', 'property', 'realtor'],
    campaignTypes: ['promotional'],
  },
  {
    value: 'Educate on market trends and buying tips',
    tags: ['real-estate', 'property', 'realtor'],
    campaignTypes: ['educational', 'thought_leadership'],
  },
  {
    value: 'Build trust through client testimonials',
    tags: ['real-estate', 'property', 'realtor'],
    campaignTypes: ['promotional', 'thought_leadership'],
  },

  // ============================================
  // Technology & SaaS Goals
  // ============================================
  {
    value: 'Drive product trials and demo requests',
    tags: ['tech', 'saas', 'software', 'b2b'],
    campaignTypes: ['promotional'],
  },
  {
    value: 'Increase user activation and feature adoption',
    tags: ['tech', 'saas', 'software'],
    campaignTypes: ['educational', 'promotional'],
  },
  {
    value: 'Share product updates and releases',
    tags: ['tech', 'saas', 'software'],
    campaignTypes: ['promotional', 'educational'],
  },
  {
    value: 'Build community and user engagement',
    tags: ['tech', 'saas', 'software'],
    campaignTypes: ['thought_leadership', 'educational'],
  },

  // ============================================
  // Generic/Universal Goals (fallbacks)
  // ============================================
  {
    value: 'Increase brand awareness and visibility',
    tags: ['generic', 'all'],
    campaignTypes: ['promotional', 'thought_leadership'],
  },
  {
    value: 'Grow social media following',
    tags: ['generic', 'all'],
    campaignTypes: ['promotional', 'thought_leadership'],
  },
  {
    value: 'Drive website traffic',
    tags: ['generic', 'all'],
    campaignTypes: ['promotional', 'educational'],
  },
  {
    value: 'Boost engagement and community interaction',
    tags: ['generic', 'all'],
    campaignTypes: ['thought_leadership', 'educational'],
  },
  {
    value: 'Generate leads and inquiries',
    tags: ['generic', 'all', 'service-based'],
    campaignTypes: ['promotional'],
  },
  {
    value: 'Educate and inform target audience',
    tags: ['generic', 'all'],
    campaignTypes: ['educational'],
  },
  {
    value: 'Celebrate milestones and achievements',
    tags: ['generic', 'all'],
    campaignTypes: ['seasonal', 'thought_leadership'],
  },
  {
    value: 'Share company culture and values',
    tags: ['generic', 'all'],
    campaignTypes: ['thought_leadership'],
  },
];

/**
 * Fallback goals by campaign type (used when no brand profile match)
 */
export const FALLBACK_GOALS_BY_TYPE: Record<CampaignType, string[]> = {
  promotional: [
    'Drive sales and conversions',
    'Increase brand awareness',
    'Generate leads and inquiries',
    'Promote special offers and discounts',
  ],
  educational: [
    'Educate audience on best practices',
    'Share tips and tutorials',
    'Build authority in industry',
    'Answer common questions',
  ],
  seasonal: [
    'Capitalize on seasonal trends',
    'Promote holiday specials',
    'Celebrate seasonal events',
    'Create timely, relevant content',
  ],
  thought_leadership: [
    'Establish industry expertise',
    'Share insights and perspectives',
    'Build trust and credibility',
    'Lead industry conversations',
  ],
  custom: [
    'Achieve custom campaign objectives',
    'Build brand presence',
    'Engage target audience',
    'Create valuable content',
  ],
};

/**
 * Extract industry tags from brand type string
 * Examples:
 *   "Professional Barber Shop" -> ['barber', 'professional', 'service-based']
 *   "Tech Startup" -> ['tech', 'saas', 'b2b']
 */
export function extractBrandTags(brandType: string | null | undefined): string[] {
  if (!brandType) return ['generic'];

  const normalized = brandType.toLowerCase();
  const tags: string[] = [];

  // Direct keyword matching
  const keywords = [
    'barber',
    'salon',
    'beauty',
    'spa',
    'wellness',
    'fitness',
    'gym',
    'yoga',
    'retail',
    'ecommerce',
    'shop',
    'store',
    'boutique',
    'fashion',
    'restaurant',
    'cafe',
    'bar',
    'food',
    'bakery',
    'dining',
    'consulting',
    'agency',
    'professional',
    'b2b',
    'legal',
    'accounting',
    'creative',
    'artist',
    'designer',
    'photographer',
    'tattoo',
    'education',
    'training',
    'school',
    'academy',
    'coaching',
    'real-estate',
    'property',
    'realtor',
    'tech',
    'saas',
    'software',
    'startup',
  ];

  for (const keyword of keywords) {
    if (normalized.includes(keyword)) {
      tags.push(keyword);
    }
  }

  // Inferred tags based on patterns
  if (/service|appointment|booking|consultation/.test(normalized)) {
    tags.push('service-based');
  }
  if (/b2b|enterprise|business/.test(normalized)) {
    tags.push('b2b');
  }
  if (/lifestyle|luxury|premium/.test(normalized)) {
    tags.push('lifestyle');
  }

  return tags.length > 0 ? tags : ['generic'];
}
