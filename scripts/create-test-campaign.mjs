#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function createTestCampaign() {
  try {
    console.log("🚀 Creating test campaign with content...");

    // Get the demo user
    const user = await prisma.user.findUnique({
      where: { email: "demo@example.com" },
    });

    if (!user) {
      console.log("❌ Demo user not found. Run create-demo-user.mjs first.");
      return;
    }

    // Get the first brand
    const brand = await prisma.brand.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    if (!brand) {
      console.log("❌ No brands found for demo user.");
      return;
    }

    console.log(`📦 Using brand: ${brand.name}`);

    // Create a campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: "Holiday Season Campaign",
        brandId: brand.id,
        status: "active",
        priority: 5,
        previewGenerated: true,
        progress: 60,
        startedAt: new Date(),
        config: {
          duration: {
            start: new Date().toISOString(),
            end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
          },
          frequency: "daily",
          themes: ["holiday", "celebration", "innovation", "tech"],
          style: "festive",
          postingTime: "10:00",
          priority: 5,
        },
      },
    });

    console.log(`✅ Created campaign: ${campaign.name}`);

    // Create various types of content for the campaign
    const now = new Date();
    const contentData = [
      {
        brandId: brand.id,
        campaignId: campaign.id,
        caption:
          "🎄 Happy Holidays from our team! This season, we're grateful for all the innovations and breakthroughs we've achieved together. Here's to an even more amazing new year! #HolidayTech #Innovation #Gratitude",
        hashtags: [
          "#HolidayTech",
          "#Innovation",
          "#Gratitude",
          "#TechCommunity",
          "#HappyHolidays",
        ],
        imageUrl:
          "https://images.unsplash.com/photo-1512389142860-9c449e58a543?w=800&h=600&fit=crop",
        status: "published",
        postedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        instagramPostId: "demo_post_001",
        analytics: {
          likes: 1234,
          comments: 89,
          reach: 5678,
          engagement: 15.4,
        },
      },
      {
        brandId: brand.id,
        campaignId: campaign.id,
        caption:
          "🚀 New Year, New Tech! We're excited to announce our upcoming product launches for Q1. Stay tuned for revolutionary innovations that will change how we interact with technology. #NewYear #TechLaunch #Innovation",
        hashtags: [
          "#NewYear",
          "#TechLaunch",
          "#Innovation",
          "#ComingSoon",
          "#TechNews",
        ],
        imageUrl:
          "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&h=600&fit=crop",
        status: "scheduled",
        scheduledAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
      },
      {
        brandId: brand.id,
        campaignId: campaign.id,
        caption:
          "🎁 Special holiday offer! Get 30% off all our premium features this December. Transform your business with cutting-edge AI solutions. Limited time only! #HolidayDeal #AI #TechSale",
        hashtags: [
          "#HolidayDeal",
          "#AI",
          "#TechSale",
          "#LimitedOffer",
          "#Innovation",
        ],
        imageUrl:
          "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800&h=600&fit=crop",
        status: "scheduled",
        scheduledAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
      },
      {
        brandId: brand.id,
        campaignId: campaign.id,
        caption:
          "💡 Did you know? Our AI processes over 1 billion data points every second to deliver real-time insights. Discover the power of intelligent automation. #AIFacts #BigData #Innovation",
        hashtags: [
          "#AIFacts",
          "#BigData",
          "#Innovation",
          "#TechEducation",
          "#Automation",
        ],
        imageUrl:
          "https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=800&h=600&fit=crop",
        status: "draft",
      },
      {
        brandId: brand.id,
        campaignId: campaign.id,
        caption:
          "🌟 Customer Success Story: How XYZ Corp increased productivity by 200% using our AI solutions. Read the full case study on our website! #CustomerSuccess #AI #CaseStudy",
        hashtags: [
          "#CustomerSuccess",
          "#AI",
          "#CaseStudy",
          "#Productivity",
          "#Innovation",
        ],
        imageUrl:
          "https://images.unsplash.com/photo-1556761175-b413da4baf72?w=800&h=600&fit=crop",
        status: "draft",
      },
      {
        brandId: brand.id,
        campaignId: campaign.id,
        caption:
          "🔬 Behind the scenes: Our research team working on next-generation quantum computing solutions. The future is being built today! #Research #QuantumComputing #Innovation",
        hashtags: [
          "#Research",
          "#QuantumComputing",
          "#Innovation",
          "#BehindTheScenes",
          "#TechLab",
        ],
        imageUrl:
          "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=600&fit=crop",
        status: "failed",
        scheduledAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        schedulingError: "Instagram API rate limit exceeded",
      },
    ];

    for (const data of contentData) {
      const content = await prisma.content.create({ data });
      console.log(`📝 Created content: ${content.caption.substring(0, 50)}...`);
    }

    // Create another campaign with different status
    const draftCampaign = await prisma.campaign.create({
      data: {
        name: "Q1 Product Launch",
        brandId: brand.id,
        status: "creating",
        priority: 1,
        previewGenerated: false,
        progress: 0,
        config: {
          duration: {
            start: new Date(
              now.getTime() + 30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            end: new Date(
              now.getTime() + 60 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          },
          frequency: "every-other-day",
          themes: ["product", "launch", "innovation", "features"],
          style: "professional",
          postingTime: "14:00",
          priority: 1,
        },
      },
    });

    console.log(`✅ Created draft campaign: ${draftCampaign.name}`);

    console.log("\n🎉 Test campaigns and content created successfully!");
    console.log("\n📊 Summary:");
    console.log(`- Active Campaign: ${campaign.name}`);
    console.log(`- Draft Campaign: ${draftCampaign.name}`);
    console.log("- Content created: 6 posts");
    console.log("  - 1 published (with analytics)");
    console.log("  - 2 scheduled");
    console.log("  - 2 draft");
    console.log("  - 1 failed");
  } catch (error) {
    console.error("❌ Error creating test campaign:", error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestCampaign();
