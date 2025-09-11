import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function approveContent() {
  try {
    console.log("🔍 Finding draft content...");

    // Find all draft content
    const draftContent = await prisma.content.findMany({
      where: {
        status: "draft",
      },
      include: {
        brand: {
          select: {
            name: true,
          },
        },
      },
    });

    console.log(`📊 Found ${draftContent.length} draft content items`);

    if (draftContent.length === 0) {
      console.log("ℹ️ No draft content found to schedule");
      return;
    }

    // Schedule the first item for testing
    const firstContent = draftContent[0];

    const updatedContent = await prisma.content.update({
      where: { id: firstContent.id },
      data: {
        status: "scheduled",
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000), // Schedule for 1 hour from now
      },
    });

    console.log("✅ Scheduled content for testing:");
    console.log("==========================================");
    console.log(`ID: ${updatedContent.id}`);
    console.log(`Caption: ${updatedContent.caption.substring(0, 50)}...`);
    console.log(`Brand: ${firstContent.brand.name}`);
    console.log(`Status: ${updatedContent.status}`);
    console.log("==========================================");
    console.log("");
    console.log(
      '💡 You can now test the "Publish to Instagram" button in the UI!',
    );
  } catch (error) {
    console.error("❌ Error approving content:", error);
  } finally {
    await prisma.$disconnect();
  }
}

approveContent();
