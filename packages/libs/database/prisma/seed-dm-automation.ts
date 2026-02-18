/**
 * Seed script for DM Automation feature
 * Run with: pnpm prisma db seed
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const pool = new Pool(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined
);
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log('🌱 Seeding DM Automation data...');

  // Find or create a test user
  const testUser = await prisma.user.upsert({
    where: { email: 'dm-automation-test@postolio.example' },
    update: {},
    create: {
      email: 'dm-automation-test@postolio.example',
      password: '$2b$10$test.hash.value', // Not a real hash, just for testing
      name: 'DM Automation Tester',
    },
  });

  console.log('✅ Test user created/found:', testUser.email);

  // Find or create a test brand
  const testBrand = await prisma.brand.upsert({
    where: { id: 'test-brand-dm-automation' },
    update: {},
    create: {
      id: 'test-brand-dm-automation',
      name: 'Test Brand - DM Automation',
      description: 'Test brand for DM automation feature',
      userId: testUser.id,
    },
  });

  console.log('✅ Test brand created/found:', testBrand.name);

  // Create a sample Instagram social account (required for account-scoped conversations)
  const testSocialAccount = await prisma.socialAccount.upsert({
    where: {
      platform_externalAccountId: {
        platform: 'instagram',
        externalAccountId: 'ig_test_account_1',
      },
    },
    update: {},
    create: {
      brandId: testBrand.id,
      platform: 'instagram',
      externalAccountId: 'ig_test_account_1',
      externalPageId: 'ig_test_page_1',
      username: 'postolio_test_ig',
      displayName: 'Postolio Test IG',
      metadata: {},
      sortOrder: 0,
    },
  });

  console.log('✅ Created/found test social account:', testSocialAccount.id);

  // Create sample automation rules

  // Rule 1: Promo code distribution
  const promoRule = await prisma.dMAutomationRule.upsert({
    where: { id: 'rule-promo-code' },
    update: {},
    create: {
      id: 'rule-promo-code',
      brandId: testBrand.id,
      name: 'Promo Code Giveaway',
      triggerType: 'comment_keyword',
      triggerConfig: {
        keywords: ['DISCOUNT', 'PROMO', 'CODE'],
        matchType: 'exact',
      },
      actionType: 'send_dm',
      messageTemplate:
        "Thanks for your interest! 🎉 Here's your exclusive 10% discount code: WELCOME10\n\nValid until end of month. Shop now: https://example.com/shop\n\nQuestions? Just reply to this message!",
      status: 'active',
      priority: 10,
      maxUsesPerUser: 1, // One code per user per 24h
      createdBy: testUser.id,
    },
  });

  console.log('✅ Created rule:', promoRule.name);

  // Rule 2: Lead generation - Free guide
  const leadGenRule = await prisma.dMAutomationRule.upsert({
    where: { id: 'rule-lead-gen-guide' },
    update: {},
    create: {
      id: 'rule-lead-gen-guide',
      brandId: testBrand.id,
      name: 'Free Guide - Lead Capture',
      triggerType: 'comment_keyword',
      triggerConfig: {
        keywords: ['GUIDE', 'EBOOK', 'FREE'],
        matchType: 'contains',
      },
      actionType: 'send_dm_and_reply',
      messageTemplate:
        "Hi {{name}}! 📘\n\nI'd love to send you our free Social Media Success Guide!\n\nJust reply with your email address and I'll send it right over.",
      commentReplyTemplate: '✨ Check your DMs!',
      status: 'active',
      priority: 8,
      maxUsesPerUser: 1,
      createdBy: testUser.id,
    },
  });

  console.log('✅ Created rule:', leadGenRule.name);

  // Rule 3: Customer support - FAQ auto-reply
  const supportRule = await prisma.dMAutomationRule.upsert({
    where: { id: 'rule-support-faq' },
    update: {},
    create: {
      id: 'rule-support-faq',
      brandId: testBrand.id,
      name: 'FAQ Auto-Reply',
      triggerType: 'dm_keyword',
      triggerConfig: {
        keywords: ['HOURS', 'SHIPPING', 'RETURN'],
        matchType: 'contains',
      },
      actionType: 'send_dm',
      messageTemplate:
        'Hi {{name}}! Here are answers to common questions:\n\n⏰ Hours: Mon-Fri 9am-6pm EST\n📦 Shipping: 3-5 business days\n🔄 Returns: 30-day money-back guarantee\n\nNeed more help? Visit https://example.com/faq or reply to this message!',
      status: 'active',
      priority: 5,
      cooldownMinutes: 60, // Don't spam users
      activeHours: {
        start: '09:00',
        end: '21:00',
        timezone: 'America/New_York',
      },
      activeDays: [1, 2, 3, 4, 5], // Mon-Fri only
      createdBy: testUser.id,
    },
  });

  console.log('✅ Created rule:', supportRule.name);

  // Create a sample conversation
  const conversation = await prisma.dMConversation.upsert({
    where: {
      brandId_socialAccountId_platform_participantExternalUserId: {
        brandId: testBrand.id,
        socialAccountId: testSocialAccount.id,
        platform: 'instagram',
        participantExternalUserId: 'ig_user_12345',
      },
    },
    update: {},
    create: {
      platform: 'instagram',
      participantExternalUserId: 'ig_user_12345',
      participantUsername: 'test_user_ig',
      state: 'active',
      brand: { connect: { id: testBrand.id } },
      socialAccount: { connect: { id: testSocialAccount.id } },
      rule: { connect: { id: promoRule.id } },
    },
  });

  console.log('✅ Created sample conversation with:', conversation.participantUsername);

  // Create sample messages
  await prisma.dMMessage.create({
    data: {
      conversationId: conversation.id,
      platform: 'instagram',
      direction: 'outbound',
      messageText: promoRule.messageTemplate.replace('{{name}}', 'test_user_ig'),
      externalMessageId: 'ig_msg_test_123',
      status: 'sent',
      sentAt: new Date(),
    },
  });

  console.log('✅ Created sample message');

  // Create sample automation events
  await prisma.dMAutomationEvent.create({
    data: {
      brandId: testBrand.id,
      ruleId: promoRule.id,
      conversationId: conversation.id,
      triggerType: 'comment_keyword',
      triggerSource: 'comment',
      triggerText: 'I want a DISCOUNT code!',
      triggeredBy: 'test_user_ig',
      actionType: 'send_dm',
      messageSent: true,
      commentReplySent: false,
      rateLimited: false,
    },
  });

  console.log('✅ Created sample automation event');

  console.log('\n🎉 DM Automation seed data created successfully!');
  console.log('\nSample data created:');
  console.log('  - 3 automation rules (promo code, lead gen, support)');
  console.log('  - 1 conversation with test user');
  console.log('  - 1 message sent');
  console.log('  - 1 automation event logged');
  console.log('\nTest brand ID:', testBrand.id);
  console.log('You can view this in Prisma Studio: pnpm prisma studio');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
