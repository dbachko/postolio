#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function createComprehensiveCampaigns() {
  try {
    console.log("🚀 Creating comprehensive campaigns for all brands...");

    // Get the demo user
    const user = await prisma.user.findUnique({
      where: { email: "demo@example.com" },
    });

    if (!user) {
      console.log("❌ Demo user not found. Run generate-test-data.mjs first.");
      return;
    }

    // Get all brands for the user
    const brands = await prisma.brand.findMany({
      where: { userId: user.id },
    });

    console.log(`📦 Found ${brands.length} brands`);

    const campaignTemplates = [
      {
        name: "Winter Marketing Blitz",
        status: "active",
        themes: ["winter", "cozy", "warmth", "comfort"],
        style: "warm",
        frequency: "daily",
      },
      {
        name: "New Year Growth Strategy",
        status: "preview",
        themes: ["growth", "goals", "success", "motivation"],
        style: "motivational",
        frequency: "every-other-day",
      },
      {
        name: "Product Showcase Series",
        status: "completed",
        themes: ["product", "features", "benefits", "showcase"],
        style: "professional",
        frequency: "weekly",
      },
      {
        name: "Community Engagement Drive",
        status: "paused",
        themes: ["community", "engagement", "stories", "people"],
        style: "friendly",
        frequency: "daily",
      },
      {
        name: "Educational Content Series",
        status: "creating",
        themes: ["education", "tips", "howto", "knowledge"],
        style: "informative",
        frequency: "every-other-day",
      },
    ];

    const contentTemplates = [
      {
        caption:
          "✨ Start your week with inspiration! Our latest collection is designed to bring joy and comfort to your daily routine.",
        hashtags: [
          "#MondayMotivation",
          "#NewWeek",
          "#Inspiration",
          "#DailyJoy",
          "#Comfort",
        ],
        status: "scheduled",
      },
      {
        caption:
          "🎯 Behind every great product is a story of passion and dedication. Meet the team that makes it all happen!",
        hashtags: [
          "#BehindTheScenes",
          "#TeamWork",
          "#Passion",
          "#OurStory",
          "#MeetTheTeam",
        ],
        status: "draft",
      },
      {
        caption:
          "💡 Pro tip: Small changes can make a big difference. Here are 5 ways to transform your daily routine.",
        hashtags: [
          "#ProTips",
          "#LifeHacks",
          "#DailyRoutine",
          "#Transform",
          "#SmallChanges",
        ],
        status: "published",
      },
      {
        caption:
          "🌟 Customer spotlight! Thank you for sharing your amazing experience with us. Your stories inspire us every day!",
        hashtags: [
          "#CustomerLove",
          "#Testimonial",
          "#ThankYou",
          "#Community",
          "#Success",
        ],
        status: "scheduled",
      },
      {
        caption:
          "🚀 Big announcement coming soon! Get ready for something that will revolutionize your experience with us.",
        hashtags: [
          "#ComingSoon",
          "#Announcement",
          "#Excited",
          "#Innovation",
          "#StayTuned",
        ],
        status: "draft",
      },
    ];

    for (const brand of brands) {
      console.log(`\n📌 Creating campaigns for: ${brand.name}`);

      // Create 2-3 campaigns per brand
      const numCampaigns = Math.floor(Math.random() * 2) + 2;

      for (let i = 0; i < numCampaigns && i < campaignTemplates.length; i++) {
        const template = campaignTemplates[i];
        const now = new Date();

        const campaign = await prisma.campaign.create({
          data: {
            name: `${brand.name} - ${template.name}`,
            brandId: brand.id,
            status: template.status,
            priority: Math.floor(Math.random() * 5) + 1,
            previewGenerated: template.status !== "creating",
            progress:
              template.status === "completed"
                ? 100
                : template.status === "active"
                  ? Math.floor(Math.random() * 60) + 20
                  : template.status === "creating"
                    ? 0
                    : 10,
            startedAt:
              template.status === "active" || template.status === "completed"
                ? new Date(
                    now.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000,
                  )
                : null,
            completedAt: template.status === "completed" ? now : null,
            config: {
              duration: {
                start: now.toISOString(),
                end: new Date(
                  now.getTime() + 30 * 24 * 60 * 60 * 1000,
                ).toISOString(),
              },
              frequency: template.frequency,
              themes: template.themes,
              style: template.style,
              postingTime: `${Math.floor(Math.random() * 12) + 8}:00`,
              priority: Math.floor(Math.random() * 5) + 1,
            },
          },
        });

        console.log(
          `  ✅ Created campaign: ${campaign.name} (${campaign.status})`,
        );

        // Create 3-5 content items per campaign
        const numContent = Math.floor(Math.random() * 3) + 3;

        for (let j = 0; j < numContent && j < contentTemplates.length; j++) {
          const contentTemplate = contentTemplates[j];
          const contentNow = new Date();

          // Customize caption based on brand
          let customCaption = contentTemplate.caption;
          if (brand.name.includes("Coffee")) {
            customCaption = customCaption
              .replace("product", "coffee")
              .replace("collection", "blend");
          } else if (brand.name.includes("Wellness")) {
            customCaption = customCaption
              .replace("product", "wellness solution")
              .replace("collection", "natural remedies");
          } else if (brand.name.includes("Fitness")) {
            customCaption = customCaption
              .replace("product", "workout")
              .replace("collection", "training program");
          }

          const content = await prisma.content.create({
            data: {
              brandId: brand.id,
              campaignId: campaign.id,
              caption: customCaption,
              hashtags: contentTemplate.hashtags,
              imageUrl: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 100000000)}?w=800&h=600&fit=crop`,
              status: contentTemplate.status,
              scheduledAt:
                contentTemplate.status === "scheduled"
                  ? new Date(
                      contentNow.getTime() +
                        Math.random() * 14 * 24 * 60 * 60 * 1000,
                    )
                  : null,
              postedAt:
                contentTemplate.status === "published"
                  ? new Date(
                      contentNow.getTime() -
                        Math.random() * 7 * 24 * 60 * 60 * 1000,
                    )
                  : null,
              instagramPostId:
                contentTemplate.status === "published"
                  ? `ig_${brand.id}_${j}_${Date.now()}`
                  : null,
              analytics:
                contentTemplate.status === "published"
                  ? {
                      likes: Math.floor(Math.random() * 2000) + 100,
                      comments: Math.floor(Math.random() * 200) + 10,
                      reach: Math.floor(Math.random() * 10000) + 500,
                      engagement: Math.random() * 20 + 5,
                    }
                  : null,
            },
          });

          console.log(
            `    📝 Created content: ${content.caption.substring(0, 40)}... (${content.status})`,
          );
        }
      }
    }

    // Get summary statistics
    const totalCampaigns = await prisma.campaign.count();
    const totalContent = await prisma.content.count();
    const campaignsByStatus = await prisma.campaign.groupBy({
      by: ["status"],
      _count: true,
    });
    const contentByStatus = await prisma.content.groupBy({
      by: ["status"],
      _count: true,
    });

    console.log("\n🎉 Comprehensive campaign creation complete!");
    console.log("\n📊 Final Statistics:");
    console.log(`- Total Brands: ${brands.length}`);
    console.log(`- Total Campaigns: ${totalCampaigns}`);
    console.log(`- Total Content: ${totalContent}`);

    console.log("\n📈 Campaigns by Status:");
    campaignsByStatus.forEach((item) => {
      console.log(`  - ${item.status}: ${item._count}`);
    });

    console.log("\n📝 Content by Status:");
    contentByStatus.forEach((item) => {
      console.log(`  - ${item.status}: ${item._count}`);
    });
  } catch (error) {
    console.error("❌ Error creating campaigns:", error);
  } finally {
    await prisma.$disconnect();
  }
}

createComprehensiveCampaigns();
