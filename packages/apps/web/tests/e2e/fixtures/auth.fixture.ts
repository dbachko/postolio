import { test as base, Page } from "@playwright/test";

export interface AuthFixtures {
  authenticatedPage: Page;
  testUser: {
    email: string;
    password: string;
    token: string;
  };
}

export const test = base.extend<AuthFixtures>({
  testUser: async ({}, use) => {
    // Test user credentials
    const user = {
      email: "test@example.com",
      password: "Test123!@#",
      token: "", // Will be populated after login
    };
    await use(user);
  },

  authenticatedPage: async ({ page, testUser, baseURL }, use) => {
    // Navigate to login
    await page.goto("/login");

    // Perform login
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', testUser.password);
    await page.click('button[type="submit"]');

    // Wait for authentication to complete
    await page.waitForURL("/dashboard", { timeout: 10000 });

    // Extract token from localStorage
    testUser.token = await page.evaluate(() => {
      const authStore = localStorage.getItem("auth-storage");
      if (authStore) {
        const parsed = JSON.parse(authStore);
        return parsed.state?.token || "";
      }
      return "";
    });

    await use(page);

    // Cleanup
    await page.evaluate(() => localStorage.clear());
  },
});

export { expect } from "@playwright/test";
