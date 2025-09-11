#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkEmptyCaptions() {
  try {
    console.log(
      "🔍 Checking for content with empty captions after latest fixes...",
    );

    const emptyContent = await prisma.content.findMany({
      where: {
        caption: "",
      },
      select: {
        id: true,
        caption: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        brandId: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    console.log(
      `Found ${emptyContent.length} content items with empty captions:`,
    );

    if (emptyContent.length > 0) {
      emptyContent.forEach((item, index) => {
        console.log(`${index + 1}. ID: ${item.id}`);
        console.log(`   Caption: '${item.caption}'`);
        console.log(`   Status: ${item.status}`);
        console.log(`   Brand ID: ${item.brandId}`);
        console.log(`   Created: ${item.createdAt.toISOString()}`);
        console.log(`   Updated: ${item.updatedAt.toISOString()}`);
        console.log("   ---");
      });

      // Clean up empty captions
      console.log("\n🧹 Cleaning up empty caption entries...");
      const deleteResult = await prisma.content.deleteMany({
        where: {
          caption: "",
        },
      });
      console.log(
        `✅ Deleted ${deleteResult.count} content items with empty captions`,
      );
    } else {
      console.log("✅ No content with empty captions found!");
    }
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkEmptyCaptions();
