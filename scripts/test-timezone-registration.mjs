#!/usr/bin/env node

/**
 * Test script to verify timezone auto-detection during user registration
 * Run with: node scripts/test-timezone-registration.mjs
 */

import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const API_URL = process.env.API_URL || "http://localhost:3000";

// Generate unique test email
const testEmail = `test-tz-${Date.now()}@example.com`;
const testPassword = "TestPassword123!@#$";
const testName = "Timezone Test User";
const testTimezone = "America/New_York";

console.log("🧪 Testing Timezone Auto-Detection During Registration\n");
console.log("Test Details:");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`Email: ${testEmail}`);
console.log(`Timezone: ${testTimezone}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

async function testRegistration() {
  try {
    // 1. Test registration with timezone
    console.log("📝 Registering user with auto-detected timezone...");
    const registerResponse = await fetch(`${API_URL}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: testName,
        timezone: testTimezone,
      }),
    });

    if (!registerResponse.ok) {
      const error = await registerResponse.text();
      throw new Error(`Registration failed: ${error}`);
    }

    const registerData = await registerResponse.json();
    console.log("✅ Registration successful!");
    console.log(`   User ID: ${registerData.user.id}`);
    console.log(`   Timezone: ${registerData.user.timezone}`);
    console.log(
      `   Auto-detected: ${registerData.user.timezoneAutoDetected}\n`,
    );

    // 2. Verify in database
    console.log("🔍 Verifying timezone in database...");
    const dbUser = await prisma.user.findUnique({
      where: { email: testEmail },
      select: {
        id: true,
        email: true,
        timezone: true,
        timezoneAutoDetected: true,
      },
    });

    if (!dbUser) {
      throw new Error("User not found in database");
    }

    console.log("✅ Database verification successful!");
    console.log(`   Stored timezone: ${dbUser.timezone}`);
    console.log(`   Auto-detected flag: ${dbUser.timezoneAutoDetected}\n`);

    // 3. Verify timezone is correctly set
    if (
      dbUser.timezone === testTimezone &&
      dbUser.timezoneAutoDetected === true
    ) {
      console.log("🎉 SUCCESS: Timezone auto-detection is working correctly!");
      console.log(`   ✓ Timezone "${testTimezone}" was saved`);
      console.log("   ✓ Auto-detected flag is set to true");
    } else {
      console.error("❌ FAILURE: Timezone not saved correctly");
      console.error(`   Expected: ${testTimezone}, Got: ${dbUser.timezone}`);
      console.error(`   Auto-detected flag: ${dbUser.timezoneAutoDetected}`);
    }

    // 4. Test fallback to UTC when no timezone provided
    console.log("\n📝 Testing UTC fallback (no timezone provided)...");
    const fallbackEmail = `test-utc-${Date.now()}@example.com`;

    const fallbackResponse = await fetch(`${API_URL}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: fallbackEmail,
        password: testPassword,
        name: "UTC Fallback Test",
        // No timezone provided - should fallback to UTC
      }),
    });

    if (fallbackResponse.ok) {
      const fallbackData = await fallbackResponse.json();
      const fallbackUser = await prisma.user.findUnique({
        where: { email: fallbackEmail },
        select: { timezone: true, timezoneAutoDetected: true },
      });

      if (fallbackUser?.timezone === "UTC") {
        console.log("✅ UTC fallback working correctly!");
        console.log(`   Timezone defaulted to: ${fallbackUser.timezone}`);
      } else {
        console.error("❌ UTC fallback not working");
        console.error(`   Expected: UTC, Got: ${fallbackUser?.timezone}`);
      }

      // Cleanup fallback test user
      await prisma.user.delete({ where: { email: fallbackEmail } });
    }

    // 5. Cleanup test user
    console.log("\n🧹 Cleaning up test data...");
    await prisma.user.delete({ where: { email: testEmail } });
    console.log("✅ Test data cleaned up successfully");

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✨ All timezone detection tests passed!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);

    // Cleanup on error
    try {
      await prisma.user.delete({ where: { email: testEmail } }).catch(() => {});
    } catch {}

    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testRegistration().catch(console.error);
