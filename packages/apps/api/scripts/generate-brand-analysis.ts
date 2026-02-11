import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDatabaseClient } from '../src/config/database.js';

type Args = {
  brandId?: string;
  version?: number;
};

function parseArgs(): Partial<Args> {
  const out: Partial<Args> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i];
    if (token === '--') continue;

    let key = token;
    let value: string | undefined;
    const eqIndex = token.indexOf('=');
    if (eqIndex >= 0) {
      key = token.slice(0, eqIndex);
      value = token.slice(eqIndex + 1);
    } else {
      value = process.argv[i + 1];
      i++;
    }

    if (!value) continue;

    switch (key) {
      case '--brandId':
        out.brandId = value;
        break;
      case '--version':
        out.version = Number(value);
        break;
      default:
        break;
    }
  }
  return out;
}

// Random data generators
const ARCHETYPES = [
  'Minimalist Modern',
  'Bold & Vibrant',
  'Elegant & Sophisticated',
  'Playful & Fun',
  'Natural & Organic',
  'Tech & Innovation',
  'Luxury Premium',
  'Rustic Authentic',
  'Creative Artistic',
  'Clean Professional',
];

const TONES = [
  'professional',
  'casual',
  'playful',
  'sophisticated',
  'inspirational',
  'educational',
  'conversational',
  'authoritative',
  'friendly',
  'enthusiastic',
  'minimalist',
  'bold',
];

const COLOR_PALETTES = [
  ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'],
  ['#2C3E50', '#E74C3C', '#ECF0F1', '#3498DB', '#95A5A6'],
  ['#F9C74F', '#F3722C', '#F94144', '#43AA8B', '#577590'],
  ['#264653', '#2A9D8F', '#E9C46A', '#F4A261', '#E76F51'],
  ['#8338EC', '#3A86FF', '#FB5607', '#FFBE0B', '#FF006E'],
  ['#606C38', '#283618', '#FEFAE0', '#DDA15E', '#BC6C25'],
  ['#E63946', '#F1FAEE', '#A8DADC', '#457B9D', '#1D3557'],
  ['#FFB4A2', '#E5989B', '#B5838D', '#6D6875', '#FFCDB2'],
];

const VISUAL_STYLES = [
  {
    emoji: '✨',
    title: 'Clean Minimal',
    description:
      'minimalist photography, soft natural lighting, centered composition, white and pastel color palette',
  },
  {
    emoji: '📸',
    title: 'Product Focus',
    description:
      'product photography, studio lighting, minimal composition, professional white background',
  },
  {
    emoji: '🎨',
    title: 'Artistic Creative',
    description:
      'digital illustration, vibrant and energetic, dynamic composition, bold color gradients',
  },
  {
    emoji: '🌸',
    title: 'Soft Aesthetic',
    description:
      'lifestyle photography, soft dreamy lighting, natural composition, warm pink and peach tones',
  },
  {
    emoji: '🎭',
    title: 'Bold Graphics',
    description: 'flat design, high contrast, geometric composition, vibrant primary colors',
  },
  {
    emoji: '🖼️',
    title: 'Editorial Style',
    description:
      'editorial photography, dramatic lighting, rule of thirds, sophisticated color grading',
  },
  {
    emoji: '☀️',
    title: 'Bright & Warm',
    description:
      'outdoor photography, golden hour lighting, natural composition, warm sunny color palette',
  },
  {
    emoji: '🌿',
    title: 'Natural Organic',
    description:
      'nature photography, soft natural light, organic composition, earthy green and brown tones',
  },
];

const CONTENT_TOPICS = [
  'product showcases',
  'behind the scenes',
  'customer testimonials',
  'educational tips',
  'industry insights',
  'team culture',
  'success stories',
  'how-to guides',
  'lifestyle content',
  'brand values',
  'community highlights',
  'innovation updates',
  'seasonal content',
  'user-generated content',
  'expert interviews',
];

const HASHTAG_STRATEGIES = [
  'brand-focused with community tags',
  'niche-specific with trending tags',
  'balanced mix of broad and niche',
  'minimal branded only',
  'comprehensive 30-tag approach',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickMultiple<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, arr.length));
}

function generateRandomBrandAnalysis(brandId: string, version: number) {
  const archetype = pickRandom(ARCHETYPES);
  const primaryTones = pickMultiple(TONES, 3);
  const palette = pickRandom(COLOR_PALETTES);
  const inferredStyles = pickMultiple(VISUAL_STYLES, Math.floor(Math.random() * 2) + 3); // 3-4 styles
  const topTopics = pickMultiple(CONTENT_TOPICS, 5);

  const now = new Date().toISOString();

  return {
    PK: `BRAND#${brandId}`,
    SK: `VERSION#${String(version).padStart(6, '0')}`,
    brandId,
    version,
    createdAt: now,
    promptSetVersion: 'v1.0',
    profile: {
      brandId,
      version,
      createdAt: now,
      promptSetVersion: 'v1.0',
      archetype,
      voice: {
        primaryTones,
        styleGuide: `${archetype} brand with ${primaryTones.join(', ')} tones. Focuses on authentic storytelling with a ${primaryTones[0]} approach.`,
        dosDonts: {
          dos: [
            'Use authentic, relatable language',
            'Share behind-the-scenes content',
            'Engage with community feedback',
            'Maintain consistent brand voice',
          ],
          donts: [
            'Overly promotional language',
            'Generic stock phrases',
            'Inconsistent tone shifts',
            'Ignoring community input',
          ],
        },
      },
      visual: {
        palette,
        motifs: pickMultiple(
          [
            'product close-ups',
            'lifestyle scenes',
            'flat lays',
            'people-focused',
            'abstract patterns',
            'nature elements',
            'geometric shapes',
            'text overlays',
          ],
          4
        ),
        composition: pickMultiple(
          [
            'rule of thirds',
            'centered',
            'minimal negative space',
            'layered depth',
            'symmetrical',
            'dynamic angles',
          ],
          3
        ),
        inferredStyles,
      },
      content: {
        topics: {
          top: topTopics.map((topic, idx) => ({
            name: topic,
            frequency: Math.max(0.1, 1 - idx * 0.15), // Decreasing frequency
          })),
          emerging: pickMultiple(
            CONTENT_TOPICS.filter((t) => !topTopics.includes(t)),
            2
          ).map((topic) => ({
            name: topic,
            frequency: Math.random() * 0.3,
          })),
        },
        hashtagStrategy: pickRandom(HASHTAG_STRATEGIES),
        engagementPatterns: {
          bestPostingTimes: pickMultiple(['09:00', '12:00', '15:00', '18:00', '21:00'], 2),
          avgLikes: Math.floor(Math.random() * 500) + 50,
          avgComments: Math.floor(Math.random() * 50) + 5,
          topPerformingTypes: pickMultiple(['carousel', 'single_image', 'video', 'reel'], 2),
        },
      },
      audience: {
        demographics: {
          primaryAge: pickRandom(['18-24', '25-34', '35-44', '45-54']),
          genderSplit: {
            female: Math.floor(Math.random() * 40) + 30,
            male: Math.floor(Math.random() * 40) + 30,
            other: Math.floor(Math.random() * 10) + 5,
          },
          topLocations: pickMultiple(
            ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France'],
            3
          ),
        },
        interests: pickMultiple(
          [
            'lifestyle',
            'fashion',
            'technology',
            'wellness',
            'food',
            'travel',
            'business',
            'creativity',
            'sustainability',
          ],
          4
        ),
      },
      recommendations: {
        contentTypes: pickMultiple(
          [
            'More behind-the-scenes content',
            'User-generated content',
            'Educational carousel posts',
            'Story highlights optimization',
            'Interactive polls and Q&As',
          ],
          3
        ),
        postingSchedule: {
          frequency: pickRandom([
            'daily',
            '3-4 times per week',
            '5-6 times per week',
            'every other day',
          ]),
          bestTimes: pickMultiple(['09:00', '12:00', '15:00', '18:00', '21:00'], 2),
        },
        engagement: [
          'Respond to comments within 1 hour',
          'Use Instagram Stories daily',
          'Create save-worthy content',
          'Collaborate with complementary brands',
        ],
      },
    },
  };
}

async function main() {
  const args = parseArgs();

  if (!args.brandId) {
    console.error(
      'Missing --brandId. Usage: pnpm --filter=api tsx scripts/generate-brand-analysis.ts --brandId <id> [--version 1]'
    );
    process.exit(1);
  }

  const version = args.version || 1;

  console.log(`==> Generating random brand analysis for brand ${args.brandId}, version ${version}`);

  // Check if brand exists in PostgreSQL
  const prisma = getDatabaseClient();
  const brand = await prisma.brand.findUnique({
    where: { id: args.brandId },
    select: { id: true, name: true },
  });

  if (!brand) {
    console.error(`Brand ${args.brandId} not found in database`);
    process.exit(1);
  }

  console.log(`Found brand: ${brand.name}`);

  // Generate random brand analysis
  const analysis = generateRandomBrandAnalysis(args.brandId, version);

  // Store in DynamoDB
  const PROFILES_TABLE = process.env.BRAND_STYLE_PROFILES_TABLE;

  if (!PROFILES_TABLE) {
    console.error(
      'BRAND_STYLE_PROFILES_TABLE environment variable is required for storing to DynamoDB'
    );
    console.log('\nGenerated analysis (would be stored in DynamoDB):');
    console.log(JSON.stringify(analysis, null, 2));
    console.log(
      '\nTo store in DynamoDB, set BRAND_STYLE_PROFILES_TABLE environment variable and ensure AWS credentials are configured.'
    );
    process.exit(0);
  }

  try {
    const ddb = new DynamoDBClient({});
    const doc = DynamoDBDocumentClient.from(ddb, {
      marshallOptions: { removeUndefinedValues: true },
    });

    await doc.send(
      new PutCommand({
        TableName: PROFILES_TABLE,
        Item: analysis,
      })
    );

    console.log('✅ Brand analysis generated and stored successfully');
    console.log(`Brand: ${brand.name}`);
    console.log(`Version: ${version}`);
    console.log(`Archetype: ${analysis.profile.archetype}`);
    console.log(`Primary Tones: ${analysis.profile.voice.primaryTones.join(', ')}`);
    console.log(
      `Visual Styles: ${analysis.profile.visual.inferredStyles.map((s) => s.title).join(', ')}`
    );
  } catch (error) {
    console.error('Failed to store brand analysis:', error);
    console.log('\nGenerated analysis:');
    console.log(JSON.stringify(analysis, null, 2));
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
