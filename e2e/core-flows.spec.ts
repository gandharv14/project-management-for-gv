import { expect, test } from "@playwright/test";

import {
  cleanupE2EData,
  E2E_ADDED_MEMBER,
  E2E_MEMBER,
  E2E_PROJECT_MEMBER,
  getE2ESupabase,
  hasMembershipScopeColumn,
  hasSuggestionCategoryColumn,
  loginAs,
  resetE2EData,
  todayISO,
  type SeedData,
  upsertE2EProfile,
} from "./helpers";

async function assertWrite(result: { error: { message: string } | null }) {
  if (result.error) {
    throw new Error(result.error.message);
  }
}

test.describe("core product flows", () => {
  let seed: SeedData;

  test.beforeEach(async () => {
    seed = await resetE2EData();
  });

  test.afterEach(async () => {
    await cleanupE2EData();
  });

  test("manages projects, members, tasks, and blockers", async ({ page }) => {
    const supabase = getE2ESupabase();

    const projectName = "E2E Created Project";
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        name: projectName,
        description: "Created from Playwright",
        created_by: seed.manager.id,
      })
      .select("id")
      .single();

    if (projectError || !project) {
      throw new Error(projectError?.message ?? "Project was not created.");
    }

    const projectMemberProfile = await upsertE2EProfile({
      auth0_sub: E2E_PROJECT_MEMBER.sub,
      email: E2E_PROJECT_MEMBER.email,
      display_name: E2E_PROJECT_MEMBER.displayName,
      role: "member",
    });

    await assertWrite(
      await supabase.from("project_members").upsert([
        { project_id: project.id, profile_id: seed.manager.id },
        { project_id: project.id, profile_id: seed.member.id },
      ]),
    );
    await assertWrite(
      await supabase
        .from("project_members")
        .delete()
        .eq("project_id", project.id)
        .eq("profile_id", projectMemberProfile.id),
    );

    await loginAs(page, "manager", "/settings");
    const teamCard = page.locator(".rounded-xl").filter({ hasText: "Workspace members" }).first();
    await teamCard.getByLabel("Name", { exact: true }).fill(E2E_ADDED_MEMBER.displayName);
    await teamCard.getByLabel("Email", { exact: true }).fill(E2E_ADDED_MEMBER.email);
    await teamCard.getByLabel("Role", { exact: true }).selectOption("manager");
    await teamCard.getByRole("button", { name: "Add workspace member" }).click();

    const addedMemberRow = teamCard.locator(".rounded-lg").filter({ hasText: E2E_ADDED_MEMBER.email });
    await expect(addedMemberRow.getByText(E2E_ADDED_MEMBER.displayName)).toBeVisible();
    await expect(addedMemberRow.getByText("manager", { exact: true })).toBeVisible();

    await expect(page.getByRole("link", { name: projectName, exact: true })).toBeVisible();

    const projectCard = page.locator(".rounded-xl").filter({ hasText: projectName }).first();
    await expect(projectCard.getByText("E2E Member · workspace", { exact: true })).toBeVisible();
    await expect(projectCard.getByText(`${E2E_ADDED_MEMBER.displayName} · workspace`, { exact: true })).toBeVisible();
    await projectCard.getByLabel("Add workspace member").selectOption(projectMemberProfile.id);
    await projectCard.getByRole("button", { name: "Add to project" }).click();
    await expect(projectCard.getByText(`${E2E_PROJECT_MEMBER.displayName} · workspace`, { exact: true })).toBeVisible();

    await loginAs(page, "member", "/settings");
    await expect(page.getByRole("link", { name: projectName, exact: true })).toBeVisible();

    await assertWrite(
      await supabase.from("project_members").delete().eq("profile_id", seed.member.id).neq("project_id", seed.project.id),
    );
    if (await hasMembershipScopeColumn()) {
      await assertWrite(await supabase.from("profiles").update({ membership_scope: "project" }).eq("id", seed.member.id));
      await page.goto(
        `http://localhost:3100/api/e2e/session?role=member&redirectTo=${encodeURIComponent(`/projects/${project.id}/board`)}`,
      );
      await expect(page).toHaveURL(/\/today$/);
    }

    await loginAs(page, "manager", "/settings");
    const deletableProjectCard = page.locator(".rounded-xl").filter({ hasText: projectName }).first();
    await deletableProjectCard.getByRole("button", { name: "Delete project" }).click();
    const deleteDialog = page.getByRole("dialog");
    await deleteDialog.getByLabel(`Type ${projectName} to confirm`).fill(projectName);
    await deleteDialog.getByRole("button", { name: "Delete project" }).click();
    await expect(deleteDialog).toBeHidden();
    await expect(page.getByRole("link", { name: projectName, exact: true })).toHaveCount(0);

    const { data: deletedProject, error: deletedProjectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", project.id)
      .maybeSingle();

    if (deletedProjectError) {
      throw new Error(deletedProjectError.message);
    }

    expect(deletedProject).toBeNull();

    const taskTitle = "E2E UI Task";
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({
        project_id: seed.project.id,
        title: taskTitle,
        description: "Move this task across columns",
        assignee_id: seed.member.id,
        due_date: todayISO(),
        status: "today",
        created_by: seed.manager.id,
      })
      .select("id")
      .single();

    if (taskError || !task) {
      throw new Error(taskError?.message ?? "Task was not created.");
    }

    await loginAs(page, "member", "/today");
    await expect(page.getByText(taskTitle)).toBeVisible();

    await assertWrite(await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id));

    const { data: blocker, error: blockerError } = await supabase
      .from("blockers")
      .insert({
        project_id: seed.project.id,
        task_id: task.id,
        title: "E2E UI Blocker",
        description: "Seeded by the browser test",
        owner_id: seed.manager.id,
        raised_by: seed.member.id,
      })
      .select("id")
      .single();

    if (blockerError || !blocker) {
      throw new Error(blockerError?.message ?? "Blocker was not created.");
    }

    await assertWrite(await supabase.from("tasks").update({ status: "blocked" }).eq("id", task.id));

    await loginAs(page, "manager", "/manager");
    await expect(page.getByText("E2E UI Blocker")).toBeVisible();
    await assertWrite(
      await supabase
        .from("blockers")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", blocker.id),
    );
    await page.reload();
    await expect(page.getByText("E2E UI Blocker")).toHaveCount(0);

    await assertWrite(await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id));
    await loginAs(page, "manager", "/manager");
    await expect(page.getByRole("cell", { name: "E2E Member" }).first()).toBeVisible();
  });

  test("links SSO sign-ins to manager-created profiles without duplicates", async ({ page }) => {
    const supabase = getE2ESupabase();

    await assertWrite(await supabase.from("profiles").delete().eq("auth0_sub", E2E_MEMBER.sub));

    const { data: invitedProfile, error: inviteError } = await supabase
      .from("profiles")
      .insert({
        auth0_sub: `pending|${E2E_MEMBER.email}`,
        email: E2E_MEMBER.email.toUpperCase(),
        display_name: "Invited E2E Member",
        role: "manager",
      })
      .select("id")
      .single();

    if (inviteError || !invitedProfile) {
      throw new Error(inviteError?.message ?? "Pending profile was not created.");
    }

    await loginAs(page, "member", "/settings");

    const { data: matchingProfiles, error: matchingError } = await supabase
      .from("profiles")
      .select("id,auth0_sub,email,display_name,role")
      .ilike("email", E2E_MEMBER.email);

    if (matchingError || !matchingProfiles) {
      throw new Error(matchingError?.message ?? "Profiles were not returned.");
    }

    expect(matchingProfiles).toHaveLength(1);
    expect(matchingProfiles[0]).toMatchObject({
      id: invitedProfile.id,
      auth0_sub: E2E_MEMBER.sub,
      email: E2E_MEMBER.email,
      display_name: "Invited E2E Member",
      role: "manager",
    });
  });

  test("handles today, suggestions, recurring duties, and manager reporting", async ({ page, request }) => {
    const supabase = getE2ESupabase();

    await loginAs(page, "member", "/today");
    await expect(page.getByText("E2E Seed Today Task")).toBeVisible();
    await assertWrite(await supabase.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("title", "E2E Seed Today Task"));
    await page.reload();
    await expect(page.getByText("E2E Seed Today Task")).toHaveCount(0);

    const suggestionTitle = "E2E UI Suggestion";
    const hasSuggestionCategories = await hasSuggestionCategoryColumn();
    const { data: suggestion, error: suggestionError } = await supabase
      .from("suggestions")
      .insert({
        project_id: seed.project.id,
        title: suggestionTitle,
        description: "**This should become a task**\n\n![workflow screenshot](https://example.com/screenshot.png)",
        ...(hasSuggestionCategories ? { category: "management" } : {}),
        author_id: seed.manager.id,
      })
      .select("id")
      .single();

    if (suggestionError || !suggestion) {
      throw new Error(suggestionError?.message ?? "Suggestion was not created.");
    }

    await assertWrite(
      await supabase.from("suggestion_votes").upsert({
        suggestion_id: suggestion.id,
        profile_id: seed.member.id,
      }),
    );
    await assertWrite(
      await supabase.from("suggestion_comments").insert({
        suggestion_id: suggestion.id,
        author_id: seed.member.id,
        body: "Looks **good** to me",
      }),
    );
    await assertWrite(await supabase.from("suggestions").update({ status: "accepted" }).eq("id", suggestion.id));

    const { data: promotedTask, error: promotedTaskError } = await supabase
      .from("tasks")
      .insert({
        project_id: seed.project.id,
        title: suggestionTitle,
        description: "This should become a task",
        assignee_id: seed.member.id,
        status: "backlog",
        created_by: seed.manager.id,
      })
      .select("id")
      .single();

    if (promotedTaskError || !promotedTask) {
      throw new Error(promotedTaskError?.message ?? "Promoted task was not created.");
    }

    await assertWrite(
      await supabase.from("suggestions").update({ promoted_task_id: promotedTask.id }).eq("id", suggestion.id),
    );

    await loginAs(page, "manager", `/projects/${seed.project.id}/suggestions`);
    await expect(page.getByText(suggestionTitle)).toBeVisible();
    const suggestionThread = page.locator('[data-slot="card"]').filter({ hasText: suggestionTitle }).first();
    await expect(suggestionThread.getByText(hasSuggestionCategories ? "Management related" : "Project related")).toBeVisible();
    await expect(page.getByText("This should become a task")).toBeVisible();
    await expect(page.locator('img[alt="workflow screenshot"]')).toHaveAttribute("src", /screenshot\.png/);
    await expect(page.getByText("Looks good to me")).toBeVisible();
    await expect(suggestionThread.getByText("Accepted", { exact: true }).first()).toBeVisible();
    if (hasSuggestionCategories) {
      await page.getByRole("link", { name: /Management related/ }).click();
      await expect(page).toHaveURL(/category=management/);
      await expect(page.getByText(suggestionTitle)).toBeVisible();
      await page.getByRole("link", { name: /Proposal/ }).click();
      await expect(page).toHaveURL(/category=proposal/);
      await expect(page.getByText(suggestionTitle)).toHaveCount(0);
    }

    await assertWrite(
      await supabase.from("recurring_rules").insert({
        project_id: seed.project.id,
        title: "E2E UI Recurring Duty",
        assignee_id: seed.member.id,
        frequency: "daily",
        next_run_on: todayISO(),
        created_by: seed.manager.id,
      }),
    );

    const invalidCron = await request.get("/api/cron/recurring", {
      headers: { authorization: "Bearer invalid" },
    });
    expect(invalidCron.status()).toBe(401);

    test.skip(!process.env.CRON_SECRET, "CRON_SECRET is required for recurring cron E2E coverage.");
    const validCron = await request.get("/api/cron/recurring", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(validCron.ok()).toBeTruthy();

    await loginAs(page, "member", "/today");
    await expect(page.getByRole("heading", { name: "E2E Recurring Duty" }).first()).toBeVisible();

    await loginAs(page, "manager", "/manager");
    await expect(page.getByRole("heading", { name: "Manager Dashboard" })).toBeVisible();
    await expect(page.getByText("E2E Seed Blocker")).toBeVisible();
    await expect(page.getByText("E2E Seed Suggestion")).toBeVisible();
    await expect(page.getByRole("cell", { name: "E2E Member" }).first()).toBeVisible();
  });
});
