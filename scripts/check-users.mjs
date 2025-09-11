import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkUsers() {
  try {
    console.log("🔍 Checking database connection...");

    // Test database connection
    await prisma.$connect();
    console.log("✅ Database connected successfully");

    // Count all users
    const userCount = await prisma.user.count();
    console.log(`📊 Total users in database: ${userCount}`);

    // List all users with details
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        brands: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (users.length > 0) {
      console.log("\n👥 Existing users:");
      console.log("==========================================");
      users.forEach((user, index) => {
        console.log(`${index + 1}. ${user.email}`);
        console.log(`   Name: ${user.name || "N/A"}`);
        console.log(`   ID: ${user.id}`);
        console.log(`   Created: ${user.createdAt.toISOString()}`);
        console.log(
          `   Brands: ${user.brands.map((b) => b.name).join(", ") || "None"}`,
        );
        console.log("------------------------------------------");
      });
    } else {
      console.log("\n❌ No users found in database");
      console.log("Run the create-test-user script first:");
      console.log("node scripts/create-test-user.mjs");
    }
  } catch (error) {
    console.error("❌ Error checking users:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
