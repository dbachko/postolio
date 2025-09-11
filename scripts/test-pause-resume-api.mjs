#!/usr/bin/env node

// Test pause/resume through the actual API endpoints

const API_URL = "http://localhost:3000/api";
const email = "demo@example.com";
const password = "password123";

async function getAuthToken() {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  return data.data?.token;
}

async function getCampaigns(token) {
  const response = await fetch(`${API_URL}/campaign/list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

async function pauseCampaign(token, campaignId) {
  const response = await fetch(`${API_URL}/campaign/${campaignId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "paused" }),
  });
  return response.json();
}

async function resumeCampaign(token, campaignId) {
  const response = await fetch(`${API_URL}/campaign/${campaignId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "active" }),
  });
  return response.json();
}

async function getCampaignContent(token, campaignId) {
  const response = await fetch(`${API_URL}/campaign/${campaignId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  return data.campaign?.content || [];
}

async function main() {
  console.log("\n=== Testing Campaign Pause/Resume via API ===\n");

  try {
    // Get auth token
    console.log("Logging in...");
    const token = await getAuthToken();
    if (!token) {
      console.error("Failed to get auth token");
      return;
    }
    console.log("✅ Authenticated");

    // Get campaigns
    console.log("\nFetching campaigns...");
    const campaignsData = await getCampaigns(token);
    const campaigns = campaignsData.campaigns || [];

    // Find an active campaign
    const activeCampaign = campaigns.find((c) => c.status === "active");
    if (!activeCampaign) {
      console.log("No active campaign found to test");
      return;
    }

    console.log(
      `Found active campaign: ${activeCampaign.name} (${activeCampaign.id})`,
    );

    // Get initial content
    const initialContent = await getCampaignContent(token, activeCampaign.id);
    const scheduledContent = initialContent.filter(
      (c) => c.status === "scheduled",
    );
    console.log(`Initial scheduled content: ${scheduledContent.length} posts`);

    if (scheduledContent.length === 0) {
      console.log("No scheduled content to test with");
      return;
    }

    // TEST 1: Pause the campaign
    console.log("\n--- TEST 1: Pausing Campaign ---");
    const pauseResult = await pauseCampaign(token, activeCampaign.id);
    console.log("Pause response:", pauseResult);

    // Check content after pause
    const afterPauseContent = await getCampaignContent(
      token,
      activeCampaign.id,
    );
    const skippedContent = afterPauseContent.filter(
      (c) => c.status === "skipped",
    );
    const stillScheduled = afterPauseContent.filter(
      (c) => c.status === "scheduled",
    );

    console.log(`After pause:`);
    console.log(`  - Skipped: ${skippedContent.length} posts`);
    console.log(`  - Still scheduled: ${stillScheduled.length} posts`);

    // Verify scheduledAt preserved
    const skippedWithDates = skippedContent.filter((c) => c.scheduledAt);
    console.log(
      `  - Skipped posts with preserved dates: ${skippedWithDates.length}/${skippedContent.length}`,
    );

    // Wait a moment
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // TEST 2: Resume the campaign
    console.log("\n--- TEST 2: Resuming Campaign ---");
    const resumeResult = await resumeCampaign(token, activeCampaign.id);
    console.log("Resume response:", resumeResult);

    // Check content after resume
    const afterResumeContent = await getCampaignContent(
      token,
      activeCampaign.id,
    );
    const restoredScheduled = afterResumeContent.filter(
      (c) => c.status === "scheduled",
    );
    const remainingSkipped = afterResumeContent.filter(
      (c) => c.status === "skipped",
    );

    console.log(`After resume:`);
    console.log(`  - Scheduled: ${restoredScheduled.length} posts`);
    console.log(`  - Still skipped: ${remainingSkipped.length} posts`);

    // Summary
    console.log("\n=== Test Summary ===");
    if (
      skippedContent.length > 0 &&
      skippedWithDates.length === skippedContent.length
    ) {
      console.log(
        "✅ Pause correctly marked content as skipped with preserved dates",
      );
    } else {
      console.log("❌ Pause did not correctly handle content status");
    }

    if (restoredScheduled.length > 0) {
      console.log("✅ Resume restored skipped content to scheduled");
    } else {
      console.log("❌ Resume did not restore content");
    }
  } catch (error) {
    console.error("Test failed:", error);
  }
}

main();
