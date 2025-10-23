import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function setupTestData() {
  console.log('Setting up test data...');

  try {
    // Clean existing test data
    await cleanTestData();

    // Create test user
    const hashedPassword = await bcrypt.hash('Test123!@#', 10);
    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        password: hashedPassword,
        name: 'Test User',
        subscriptionTier: 'premium',
      },
    });

    // Create test brand
    const brand = await prisma.brand.create({
      data: {
        name: 'Test Brand',
        description: 'Brand for E2E testing',
        userId: user.id,
        preferences: {
          themes: ['lifestyle', 'product'],
          postingTimes: ['09:00', '18:00'],
          hashtagStrategy: 'moderate',
        },
      },
    });

    // Create some test content
    const contentItems = [];
    for (let i = 0; i < 10; i++) {
      contentItems.push({
        brandId: brand.id,
        caption: `Test content ${i + 1}`,
        hashtags: ['#test', '#e2e', '#websocket'],
        status: i < 3 ? 'scheduled' : 'draft',
        scheduledAt: i < 3 ? new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000) : null,
        imageUrl: `https://example.com/image${i + 1}.jpg`,
      });
    }

    await prisma.content.createMany({
      data: contentItems,
    });

    // Create test campaign
    await prisma.campaign.create({
      data: {
        name: 'Test Campaign',
        brandId: brand.id,
        status: 'active',
        priority: 5,
        config: {
          frequency: 'daily',
          themes: ['lifestyle'],
          duration: 7,
        },
      },
    });

    console.log('Test data setup complete');
    return { user, brand };
  } catch (error) {
    console.error('Error setting up test data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

export async function cleanTestData() {
  console.log('Cleaning test data...');

  try {
    // Delete test user and related data (cascade)
    await prisma.user.deleteMany({
      where: {
        email: 'test@example.com',
      },
    });

    console.log('Test data cleaned');
  } catch (error) {
    console.error('Error cleaning test data:', error);
  }
}

// Run if executed directly
if (require.main === module) {
  setupTestData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
