#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkCampaignBrandAssociation() {
  try {
    console.log("🔍 Checking campaign-brand associations...");

    // Get all campaigns with their brand info
    const campaigns = await prisma.campaign.findMany({
      include: {
        brand: {
          select: {
            id: true,
            name: true,
            userId: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    console.log(`Found ${campaigns.length} total campaigns`);

    // Check for campaigns without valid brand associations
    const orphanedCampaigns = campaigns.filter((campaign) => !campaign.brand);

    if (orphanedCampaigns.length > 0) {
      console.log(
        `⚠️  Found ${orphanedCampaigns.length} campaigns without valid brand associations:`,
      );
      orphanedCampaigns.forEach((campaign, index) => {
        console.log(`${index + 1}. Campaign ID: ${campaign.id}`);
        console.log(`   Name: ${campaign.name}`);
        console.log(`   Brand ID: ${campaign.brandId}`);
        console.log(`   Status: ${campaign.status}`);
        console.log(`   Created: ${campaign.createdAt}`);
        console.log("   ---");
      });
    } else {
      console.log("✅ All campaigns have valid brand associations!");
    }

    // Group campaigns by brand
    const campaignsByBrand = {};
    campaigns
      .filter((c) => c.brand)
      .forEach((campaign) => {
        const brandId = campaign.brand.id;
        if (!campaignsByBrand[brandId]) {
          campaignsByBrand[brandId] = {
            brand: campaign.brand,
            campaigns: [],
          };
        }
        campaignsByBrand[brandId].campaigns.push(campaign);
      });

    console.log("\n📊 Campaigns by brand:");
    Object.values(campaignsByBrand).forEach(({ brand, campaigns }) => {
      console.log(
        `🏷️  ${brand.name} (ID: ${brand.id}): ${campaigns.length} campaigns`,
      );
      campaigns.forEach((campaign) => {
        console.log(`   • ${campaign.name} (${campaign.status})`);
      });
    });

    // Check for potential brandId mismatches
    const mismatchedCampaigns = campaigns.filter(
      (campaign) => campaign.brand && campaign.brandId !== campaign.brand.id,
    );

    if (mismatchedCampaigns.length > 0) {
      console.log(
        `\n⚠️  Found ${mismatchedCampaigns.length} campaigns with brandId mismatches:`,
      );
      mismatchedCampaigns.forEach((campaign, index) => {
        console.log(`${index + 1}. Campaign: ${campaign.name}`);
        console.log(`   Campaign.brandId: ${campaign.brandId}`);
        console.log(`   Campaign.brand.id: ${campaign.brand.id}`);
        console.log("   ---");
      });
    } else {
      console.log(
        "\n✅ All campaign brandId fields match their associated brands!",
      );
    }
  } catch (error) {
    console.error("❌ Error checking campaign-brand associations:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCampaignBrandAssociation();
