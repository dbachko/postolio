#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function listCampaigns() {
  try {
    console.log("🔍 Fetching all campaigns...\n");

    const campaigns = await prisma.campaign.findMany({
      include: {
        brand: {
          select: {
            name: true,
          },
        },
        _count: {
          select: {
            content: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (campaigns.length === 0) {
      console.log("❌ No campaigns found");
      return;
    }

    console.log(`📊 Found ${campaigns.length} campaign(s):\n`);
    console.log("=".repeat(80));

    campaigns.forEach((campaign, index) => {
      console.log(`\n${index + 1}. ${campaign.name}`);
      console.log("-".repeat(40));
      console.log(`   ID: ${campaign.id}`);
      console.log(`   Brand: ${campaign.brand.name}`);
      console.log(`   Status: ${campaign.status}`);
      console.log(`   Priority: ${campaign.priority}`);
      console.log(`   Progress: ${campaign.progress}%`);
      console.log(`   Content Count: ${campaign._count.content}`);
      console.log(
        `   Preview Generated: ${campaign.previewGenerated ? "Yes" : "No"}`,
      );
      console.log(`   Created: ${campaign.createdAt.toLocaleString()}`);

      if (campaign.startedAt) {
        console.log(`   Started: ${campaign.startedAt.toLocaleString()}`);
      }

      if (campaign.completedAt) {
        console.log(`   Completed: ${campaign.completedAt.toLocaleString()}`);
      }

      if (campaign.errorMessage) {
        console.log(`   ❌ Error: ${campaign.errorMessage}`);
      }

      if (campaign.config) {
        const config = campaign.config;
        console.log(`   Config:`);
        if (config.themes) {
          console.log(`     - Themes: ${config.themes.join(", ")}`);
        }
        if (config.frequency) {
          console.log(`     - Frequency: ${config.frequency}`);
        }
        if (config.style) {
          console.log(`     - Style: ${config.style}`);
        }
      }
    });

    console.log("\n" + "=".repeat(80));
    console.log("\n📈 Campaign Summary:");
    const statusCounts = campaigns.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {});

    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

listCampaigns();
