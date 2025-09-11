#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function generateTestData() {
  console.log("🚀 Generating test data...");

  try {
    // Create test user
    const hashedPassword = await bcrypt.hash("password123", 10);

    const user = await prisma.user.upsert({
      where: { email: "demo@example.com" },
      update: {},
      create: {
        email: "demo@example.com",
        password: hashedPassword,
        name: "Demo User",
        instagramToken: "demo_token_12345",
        instagramId: "demo_instagram_user_123",
        instagramUsername: "demo_account",
      },
    });

    console.log("✅ Created user:", user.email);

    // Create brands with different analysis states
    const brands = [
      {
        name: "Sunrise Coffee Co.",
        description:
          "Artisanal coffee roasters bringing you the perfect cup every morning",
        instagramAccessToken: "coffee_token_123",
        instagramAccountId: "coffee_account_123",
        styleProfile: {
          analyzed: true,
          industry: "Food & Beverage",
          targetAudience:
            "Coffee enthusiasts, working professionals, millennials",
          brandVoice: "Warm, inviting, passionate about quality",
          brandColors: ["#8B4513", "#D2691E", "#F4E4BC"],
          brandPersonality: ["Passionate", "Authentic", "Warm"],
          contentThemes: [
            "Coffee brewing tips",
            "Behind-the-scenes roasting",
            "Customer stories",
          ],
          competitors: [
            "Blue Bottle Coffee",
            "Stumptown Coffee",
            "Intelligentsia",
          ],
        },
        preferences: {
          instagramHandle: "sunrisecoffee",
          analysisDate: new Date().toISOString(),
        },
      },
      {
        name: "TechFlow Solutions",
        description: "Innovative software solutions for modern businesses",
        styleProfile: {
          analyzed: false,
          industry: "Technology",
          targetAudience: "Tech professionals, startups, enterprise clients",
          brandVoice: "Professional, innovative, forward-thinking",
        },
        preferences: {
          instagramHandle: "techflow_solutions",
        },
      },
      {
        name: "Green Leaf Wellness",
        description: "Natural wellness products for a healthier lifestyle",
        instagramAccessToken: "wellness_token_456",
        instagramAccountId: "wellness_account_456",
        styleProfile: {
          analyzed: true,
          industry: "Health & Wellness",
          targetAudience:
            "Health-conscious individuals, wellness enthusiasts, yoga practitioners",
          brandVoice: "Calming, knowledgeable, supportive",
          brandColors: ["#228B22", "#98FB98", "#F0FFF0"],
          brandPersonality: ["Nurturing", "Natural", "Peaceful"],
          contentThemes: [
            "Wellness tips",
            "Natural ingredients",
            "Mindfulness practices",
          ],
          competitors: ["Goop", "Thrive Market", "Vital Proteins"],
        },
        preferences: {
          instagramHandle: "greenleaf_wellness",
          analysisDate: new Date().toISOString(),
        },
      },
      {
        name: "Urban Threads",
        description: "Sustainable fashion for the modern urbanite",
        styleProfile: {
          analyzed: false,
          industry: "Fashion",
          targetAudience:
            "Fashion-forward millennials, sustainable fashion advocates",
          brandVoice: "Trendy, conscious, empowering",
        },
        preferences: {
          instagramHandle: "urban_threads",
        },
      },
      {
        name: "Peak Performance Fitness",
        description: "Premium fitness equipment and training programs",
        instagramAccessToken: "fitness_token_789",
        instagramAccountId: "fitness_account_789",
        styleProfile: {
          analyzed: true,
          industry: "Fitness",
          targetAudience: "Fitness enthusiasts, athletes, gym owners",
          brandVoice: "Motivational, strong, results-driven",
          brandColors: ["#FF4500", "#000000", "#FFFFFF"],
          brandPersonality: ["Powerful", "Determined", "Inspiring"],
          contentThemes: [
            "Workout routines",
            "Athlete spotlights",
            "Fitness motivation",
          ],
          competitors: ["Nike Training", "Peloton", "CrossFit"],
        },
        preferences: {
          instagramHandle: "peakperformance_fit",
          analysisDate: new Date().toISOString(),
        },
      },
      {
        name: "Artisan Bakery",
        description: "Traditional French pastries and artisanal breads",
        styleProfile: {
          analyzed: false,
          industry: "Food & Beverage",
          targetAudience:
            "Food lovers, local community, special occasion customers",
          brandVoice: "Traditional, crafted, community-focused",
        },
        preferences: {
          instagramHandle: "artisan_bakery",
        },
      },
    ];

    for (const brandData of brands) {
      // Check if brand already exists
      let brand = await prisma.brand.findFirst({
        where: {
          userId: user.id,
          name: brandData.name,
        },
      });

      if (!brand) {
        brand = await prisma.brand.create({
          data: {
            userId: user.id,
            ...brandData,
          },
        });
      }

      const isAnalyzed = brand.styleProfile?.analyzed || false;
      console.log(
        `✅ Created brand: ${brand.name} (${isAnalyzed ? "analyzed" : "not analyzed"})`,
      );

      // Create some sample content for analyzed brands
      if (isAnalyzed) {
        const contentSamples = [
          {
            caption: `Discover the art of perfect coffee brewing! ☕✨ Our master roasters share their secrets for the ultimate morning ritual. What's your favorite brewing method?`,
            hashtags: [
              "#CoffeeLovers",
              "#ArtisanCoffee",
              "#MorningRitual",
              "#CoffeeArt",
              "#HandCrafted",
            ],
            status: "scheduled",
            scheduledAt: new Date(
              Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000,
            ),
            imageUrl:
              "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800",
          },
          {
            caption: `Behind the scenes at our roastery 🔥 Watch our artisans carefully craft each batch to perfection. The aroma, the color, the perfect roast - it's pure magic!`,
            hashtags: [
              "#BehindTheScenes",
              "#CoffeeRoasting",
              "#Craftsmanship",
              "#Quality",
              "#Passion",
            ],
            status: "draft",
            imageUrl:
              "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=800",
          },
          {
            caption: `Customer love story ❤️ Meet Sarah, who credits our Colombian blend for getting her through her PhD thesis. What's your coffee story?`,
            hashtags: [
              "#CustomerStory",
              "#ColombianCoffee",
              "#CoffeeStory",
              "#Community",
              "#Success",
            ],
            status: "scheduled",
            scheduledAt: new Date(
              Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000,
            ),
            imageUrl:
              "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800",
          },
        ];

        for (const contentData of contentSamples) {
          if (brandData.name === "Sunrise Coffee Co.") {
            await prisma.content.create({
              data: {
                brandId: brand.id,
                ...contentData,
              },
            });
          }
        }

        // Create content for other analyzed brands
        if (brandData.name === "Green Leaf Wellness") {
          await prisma.content.create({
            data: {
              brandId: brand.id,
              caption:
                "Start your day with intention 🌱 Our morning wellness ritual includes mindful breathing, natural supplements, and gratitude practice.",
              hashtags: [
                "#WellnessWednesday",
                "#MorningRitual",
                "#Mindfulness",
                "#NaturalWellness",
                "#GratitudePractice",
              ],
              status: "scheduled",
              scheduledAt: new Date(
                Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000,
              ),
              imageUrl:
                "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800",
            },
          });
        }

        if (brandData.name === "Peak Performance Fitness") {
          await prisma.content.create({
            data: {
              brandId: brand.id,
              caption:
                "Push your limits! 💪 This HIIT workout will challenge every muscle and leave you feeling unstoppable. Ready to level up?",
              hashtags: [
                "#HIITWorkout",
                "#FitnessMotivation",
                "#PushYourLimits",
                "#StrengthTraining",
                "#FitnessGoals",
              ],
              status: "draft",
              imageUrl:
                "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800",
            },
          });
        }

        console.log(`  📝 Created sample content for ${brand.name}`);
      }
    }

    console.log("\n🎉 Test data generation complete!");
    console.log("\n📊 Summary:");
    console.log(`- User: demo@example.com (password: password123)`);
    console.log(`- Brands: ${brands.length} total`);
    console.log(
      `- Analyzed: ${brands.filter((b) => b.styleProfile?.analyzed).length}`,
    );
    console.log(
      `- Not analyzed: ${brands.filter((b) => !b.styleProfile?.analyzed).length}`,
    );
    console.log("\n🔗 You can now login and explore the brands!");
  } catch (error) {
    console.error("❌ Error generating test data:", error);
  } finally {
    await prisma.$disconnect();
  }
}

generateTestData();
