#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkMissingCaptions() {
  try {
    console.log("🔍 Checking for content with missing or empty captions...");

    // Find content with empty captions
    const contentWithMissingCaptions = await prisma.content.findMany({
      where: {
        caption: "",
      },
      select: {
        id: true,
        caption: true,
        status: true,
        createdAt: true,
        brand: {
          select: {
            name: true,
          },
        },
        campaign: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    console.log(
      `Found ${contentWithMissingCaptions.length} content items with missing captions:`,
    );

    if (contentWithMissingCaptions.length > 0) {
      contentWithMissingCaptions.forEach((content, index) => {
        console.log(`${index + 1}. ID: ${content.id}`);
        console.log(`   Brand: ${content.brand.name}`);
        console.log(`   Campaign: ${content.campaign?.name || "None"}`);
        console.log(`   Status: ${content.status}`);
        console.log(`   Caption: "${content.caption}"`);
        console.log(`   Created: ${content.createdAt}`);
        console.log("   ---");
      });
    } else {
      console.log("✅ No content found with missing captions!");
    }

    // Also check for very short captions (likely incomplete)
    const contentWithShortCaptions = await prisma.content.findMany({
      where: {
        caption: {
          not: "",
        },
      },
      select: {
        id: true,
        caption: true,
        status: true,
        createdAt: true,
        brand: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const shortCaptions = contentWithShortCaptions.filter(
      (content) => content.caption && content.caption.length < 20,
    );

    console.log(
      `\n🔍 Found ${shortCaptions.length} content items with very short captions (< 20 chars):`,
    );

    if (shortCaptions.length > 0) {
      shortCaptions.forEach((content, index) => {
        console.log(`${index + 1}. ID: ${content.id}`);
        console.log(`   Brand: ${content.brand.name}`);
        console.log(`   Status: ${content.status}`);
        console.log(
          `   Caption: "${content.caption}" (${content.caption.length} chars)`,
        );
        console.log(`   Created: ${content.createdAt}`);
        console.log("   ---");
      });
    } else {
      console.log("✅ No content found with suspiciously short captions!");
    }

    // Check total content count for context
    const totalContent = await prisma.content.count();
    console.log(`\n📊 Total content items in database: ${totalContent}`);
    console.log(
      `📊 Items with missing captions: ${contentWithMissingCaptions.length} (${((contentWithMissingCaptions.length / totalContent) * 100).toFixed(2)}%)`,
    );
    console.log(
      `📊 Items with short captions: ${shortCaptions.length} (${((shortCaptions.length / totalContent) * 100).toFixed(2)}%)`,
    );
  } catch (error) {
    console.error("❌ Error checking captions:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkMissingCaptions();
