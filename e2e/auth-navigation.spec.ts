import { expect, test } from "@playwright/test";

import { cleanupE2EData, loginAs, logout, resetE2EData } from "./helpers";

test.describe("auth and navigation", () => {
  test.beforeEach(async () => {
    await resetE2EData();
  });

  test.afterEach(async () => {
    await cleanupE2EData();
  });

  test("keeps the manager signed in while switching between app pages", async ({ page }) => {
    await loginAs(page, "manager");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();

    for (let index = 0; index < 5; index += 1) {
      await page.getByRole("link", { name: "Manager" }).click();
      await expect(page.getByRole("heading", { name: "Manager Dashboard" })).toBeVisible();

      await page.getByRole("link", { name: "Settings" }).click();
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

      await page.getByRole("link", { name: "E2E Seed Project" }).click();
      await expect(page.getByRole("heading", { name: "E2E Seed Project" })).toBeVisible();

      await page.getByRole("link", { name: "Today" }).click();
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    }

    await expect(page.getByRole("link", { name: "Log out" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in with Labelbox SSO" })).toBeHidden();

    await logout(page);
  });

  test("redirects members away from the manager dashboard", async ({ page }) => {
    await page.goto("http://localhost:3100/api/e2e/session?role=member&redirectTo=%2Fmanager");

    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Manager" })).toHaveCount(0);
  });
});
