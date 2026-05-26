import { rmSync } from "node:fs";
import { join } from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());
const E2E_ROLE_FILE = join(process.cwd(), "output", "playwright", ".e2e-role");

export const E2E_MANAGER = {
  sub: "e2e|manager",
  email: "manager.e2e@example.com",
  displayName: "E2E Manager",
} as const;

export const E2E_MEMBER = {
  sub: "e2e|member",
  email: "member.e2e@example.com",
  displayName: "E2E Member",
} as const;

type SeedProfile = {
  id: string;
  email: string;
  display_name: string;
};

type SeedProject = {
  id: string;
  name: string;
};

type SeedTask = {
  id: string;
  title: string;
};

export type SeedData = {
  manager: SeedProfile;
  member: SeedProfile;
  project: SeedProject;
};

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable for E2E: ${name}`);
  }

  return value;
}

export function getE2ESupabase() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function todayISO(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function assertData<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.data === null) {
    throw new Error("Expected E2E seed query to return data.");
  }

  return result.data;
}

async function assertWrite(result: { error: { message: string } | null }) {
  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function resetE2EData(): Promise<SeedData> {
  rmSync(E2E_ROLE_FILE, { force: true });

  const supabase = getE2ESupabase();

  await supabase.from("projects").delete().like("name", "E2E%");
  await supabase.from("profiles").delete().in("auth0_sub", [E2E_MANAGER.sub, E2E_MEMBER.sub]);

  const [manager, member] = await Promise.all([
    assertData<SeedProfile>(
      await supabase
        .from("profiles")
        .upsert(
          {
            auth0_sub: E2E_MANAGER.sub,
            email: E2E_MANAGER.email,
            display_name: E2E_MANAGER.displayName,
            role: "manager",
          },
          { onConflict: "auth0_sub" },
        )
        .select("id,email,display_name")
        .single(),
    ),
    assertData<SeedProfile>(
      await supabase
        .from("profiles")
        .upsert(
          {
            auth0_sub: E2E_MEMBER.sub,
            email: E2E_MEMBER.email,
            display_name: E2E_MEMBER.displayName,
            role: "member",
          },
          { onConflict: "auth0_sub" },
        )
        .select("id,email,display_name")
        .single(),
    ),
  ]);

  const project = await assertData<SeedProject>(
    await supabase
      .from("projects")
      .insert({
        name: "E2E Seed Project",
        description: "Seeded project for browser tests",
        created_by: manager.id,
      })
      .select("id,name")
      .single(),
  );

  await assertWrite(
    await supabase.from("project_members").insert([
      { project_id: project.id, profile_id: manager.id },
      { project_id: project.id, profile_id: member.id },
    ]),
  );

  const tasks = await assertData<SeedTask[]>(
    await supabase
      .from("tasks")
      .insert([
        {
          project_id: project.id,
          title: "E2E Seed Today Task",
          description: "Visible on the member Today page",
          assignee_id: member.id,
          due_date: todayISO(),
          status: "today",
          created_by: manager.id,
        },
        {
          project_id: project.id,
          title: "E2E Seed Overdue Task",
          description: "Visible in manager reporting",
          assignee_id: member.id,
          due_date: todayISO(-2),
          status: "in_progress",
          created_by: manager.id,
        },
        {
          project_id: project.id,
          title: "E2E Completed Recurring Instance",
          assignee_id: member.id,
          due_date: todayISO(-1),
          generated_for_date: todayISO(-1),
          status: "done",
          created_by: manager.id,
        },
      ])
      .select("id,title"),
  );

  const overdueTask = tasks.find((task) => task.title === "E2E Seed Overdue Task");

  await assertWrite(
    await supabase.from("blockers").insert({
      project_id: project.id,
      task_id: overdueTask?.id,
      title: "E2E Seed Blocker",
      description: "Seeded blocker for manager dashboard",
      owner_id: manager.id,
      raised_by: member.id,
    }),
  );

  const suggestion = await assertData<{ id: string }>(
    await supabase
      .from("suggestions")
      .insert({
        project_id: project.id,
        title: "E2E Seed Suggestion",
        description: "Seeded idea for suggestions tests",
        author_id: member.id,
      })
      .select("id")
      .single(),
  );

  await assertWrite(
    await supabase.from("suggestion_votes").insert({
      suggestion_id: suggestion.id,
      profile_id: member.id,
    }),
  );

  await assertWrite(
    await supabase.from("recurring_rules").insert({
      project_id: project.id,
      title: "E2E Recurring Duty",
      description: "Generated by the cron E2E test",
      assignee_id: member.id,
      frequency: "daily",
      next_run_on: todayISO(),
      created_by: manager.id,
    }),
  );

  return { manager, member, project };
}

export async function loginAs(page: Page, role: "manager" | "member", redirectTo = "/today") {
  await page.goto(`http://localhost:3100/api/e2e/session?role=${role}&redirectTo=${encodeURIComponent(redirectTo)}`);
  await expect(page).toHaveURL(new RegExp(`${redirectTo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

export async function logout(page: Page) {
  await page.goto("http://localhost:3100/api/e2e/session?logout=1&redirectTo=/");
  await expect(page.getByRole("link", { name: "Sign in with Labelbox SSO" })).toBeVisible();
}

export function cardByText(page: Page, text: string): Locator {
  return page.locator(".rounded-lg, .rounded-xl").filter({ hasText: text }).first();
}
