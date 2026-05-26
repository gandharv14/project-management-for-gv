import { expect, test } from "@playwright/test";

import { loginAs, logout, resetE2EData } from "./helpers";

test.describe("auth and navigation", () => {
  test.beforeEach(async () => {
    await resetE2EData();
  });

  test("keeps the manager signed in while switching between app pages", async ({ page }) => {
    await loginAs(page, "manager");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();

    await loginAs(page, "manager", "/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
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
