import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function createTestUser() {
  try {
    // Hash password
    const hashedPassword = await bcrypt.hash('testpass123', 10)
    
    // Create or find user
    let user = await prisma.user.findUnique({
      where: { email: 'test@postolio.example' }
    })
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: 'test@postolio.example',
          password: hashedPassword,
          name: 'Test User'
        }
      })
      console.log('✅ Created user:', user.email)
    } else {
      console.log('✅ Found existing user:', user.email)
    }
    
    // Create brand with Instagram configuration (or find existing)
    let brand = await prisma.brand.findFirst({
      where: { userId: user.id, name: 'Sample Fashion Brand' }
    })
    
    if (!brand) {
      brand = await prisma.brand.create({
        data: {
        name: 'Sample Fashion Brand',
        description: 'A trendy fashion brand focused on sustainable clothing',
        userId: user.id,
        instagramAccessToken: 'sample_token_for_testing', // This would be a real token in production
        instagramAccountId: '17841400455970028', // Sample Instagram Business Account ID
        instagramPageId: '104038142289146', // Sample Facebook Page ID
        styleProfile: {
          tone: 'friendly and inspiring',
          aesthetics: 'clean, minimalist, earth tones',
          targetAudience: 'eco-conscious millennials and gen-z',
          keywords: ['sustainable', 'eco-friendly', 'ethical fashion', 'organic cotton'],
          brandColors: ['#8B7355', '#E8DCC0', '#A67C52', '#F5F0E8'],
          preferredHashtags: ['#sustainablefashion', '#ecofriendly', '#ethicalfashion', '#organicclothing', '#slowfashion']
        },
        preferences: {
          postingFrequency: 'daily',
          bestPostingTimes: ['09:00', '18:00', '21:00'],
          contentMix: { 'product': 40, 'lifestyle': 30, 'behind-the-scenes': 20, 'educational': 10 }
        },
        instagramProfileData: {
          username: 'samplefashionbrand',
          followers_count: 15420,
          following_count: 892,
          media_count: 347,
          profile_picture_url: 'https://example.com/profile.jpg'
        }
      })
      console.log('✅ Created brand:', brand.name)
    } else {
      console.log('✅ Found existing brand:', brand.name)
    }
    
    // Create some sample content
    const sampleContent = [
      {
        caption: 'Discover our new sustainable collection made from 100% organic cotton! 🌱 Every piece tells a story of environmental responsibility.',
        hashtags: ['sustainablefashion', 'organicclotton', 'ecofriendly', 'ethicalfashion', 'slowfashion'],
        imageUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=500',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000),
        brandId: brand.id,
        generationParams: {
          contentTheme: 'sustainability',
          engagementPrediction: 0.85,
          bestTimeToPost: '2024-01-30T18:00:00Z'
        }
      },
      {
        caption: 'Behind the scenes: Meet our artisans who handcraft each piece with love and dedication ✨ #ethicallymade',
        hashtags: ['ethicallymade', 'artisans', 'handcrafted', 'sustainablefashion', 'ethicalfashion'],
        imageUrl: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=500',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000),
        brandId: brand.id,
        generationParams: {
          contentTheme: 'behind-the-scenes',
          engagementPrediction: 0.78,
          bestTimeToPost: '2024-01-31T16:30:00Z'
        }
      },
      {
        caption: 'Style tip: Pair our organic linen shirt with recycled denim for the perfect eco-chic look! 🌿👗',
        hashtags: ['styletip', 'organiclinen', 'recycleddenim', 'ecochic', 'sustainablestyle'],
        imageUrl: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=500',
        status: 'published',
        brandId: brand.id,
        postedAt: new Date('2024-01-25T15:00:00Z'),
        instagramPostId: 'sample_post_123',
        generationParams: {
          contentTheme: 'styling',
          engagementPrediction: 0.92,
          bestTimeToPost: '2024-01-25T15:00:00Z'
        },
        analytics: {
          impressions: 2500,
          reach: 2100,
          likes: 185,
          comments: 23,
          saves: 67,
          shares: 12,
          engagementRate: 11.2
        }
      }
    ]
    
    for (const content of sampleContent) {
      const createdContent = await prisma.content.create({
        data: content
      })
      console.log('✅ Created content:', createdContent.caption.substring(0, 50) + '...')
    }
    
    console.log('\n🎉 Test user created successfully!')
    console.log('==========================================')
    console.log('📧 Email:', user.email)
    console.log('🔑 Password:', 'testpass123')
    console.log('🏢 Brand:', brand.name)
    console.log('📊 Sample content created')
    console.log('==========================================')
    
  } catch (error) {
    console.error('❌ Error creating test user:', error)
  } finally {
    await prisma.$disconnect()
  }
}

createTestUser()
