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

export const E2E_ADDED_MEMBER = {
  sub: "pending|added.member.e2e@example.com",
  email: "added.member.e2e@example.com",
  displayName: "E2E Added Member",
} as const;

export const E2E_PROJECT_MEMBER = {
  sub: "pending|project.member.e2e@example.com",
  email: "project.member.e2e@example.com",
  displayName: "E2E Project Member",
} as const;

export const E2E_PROJECT_ONLY_MEMBER = {
  sub: "pending|project.only.member.e2e@example.com",
  email: "project.only.member.e2e@example.com",
  displayName: "E2E Project Only Member",
} as const;

const E2E_PROFILE_AUTH0_SUBS = [
  E2E_MANAGER.sub,
  E2E_MEMBER.sub,
  `pending|${E2E_MANAGER.email}`,
  `pending|${E2E_MEMBER.email}`,
  E2E_ADDED_MEMBER.sub,
  E2E_PROJECT_MEMBER.sub,
  E2E_PROJECT_ONLY_MEMBER.sub,
];

const E2E_PROFILE_EMAILS = [
  E2E_MANAGER.email,
  E2E_MEMBER.email,
  E2E_MEMBER.email.toUpperCase(),
  E2E_ADDED_MEMBER.email,
  E2E_PROJECT_MEMBER.email,
  E2E_PROJECT_ONLY_MEMBER.email,
];

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

type E2EProfile = {
  id: string;
};

type SeedProfileInput = {
  auth0_sub: string;
  email: string;
  display_name: string;
  role: "manager" | "member";
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

// Client built from the public anon key (the one the browser would ship). Used
// to assert that Row Level Security denies direct table access.
export function getE2EAnonSupabase() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isMissingColumn(error: { message: string } | null, columnName: string) {
  return Boolean(
    error?.message.includes(columnName) &&
      (error.message.includes("does not exist") || error.message.includes("schema cache")),
  );
}

let membershipScopeColumnExists: boolean | null = null;
let suggestionCategoryColumnExists: boolean | null = null;

export async function hasMembershipScopeColumn() {
  if (membershipScopeColumnExists !== null) {
    return membershipScopeColumnExists;
  }

  const result = await getE2ESupabase().from("profiles").select("id,membership_scope").limit(1);

  if (isMissingColumn(result.error, "membership_scope")) {
    membershipScopeColumnExists = false;
    return false;
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  membershipScopeColumnExists = true;
  return true;
}

export async function hasSuggestionCategoryColumn() {
  if (suggestionCategoryColumnExists !== null) {
    return suggestionCategoryColumnExists;
  }

  const result = await getE2ESupabase().from("suggestions").select("id,category").limit(1);

  if (isMissingColumn(result.error, "category")) {
    suggestionCategoryColumnExists = false;
    return false;
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  suggestionCategoryColumnExists = true;
  return true;
}

export async function upsertE2EProfile(input: SeedProfileInput, membershipScope: "workspace" | "project" = "workspace") {
  const profileInput = (await hasMembershipScopeColumn())
    ? { ...input, membership_scope: membershipScope }
    : input;

  return assertData<SeedProfile>(
    await getE2ESupabase()
      .from("profiles")
      .upsert(profileInput, { onConflict: "auth0_sub" })
      .select("id,email,display_name")
      .single(),
  );
}

export function todayISO(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  // Use the LOCAL calendar date to match the server's todayISO (date-fns
  // formatISO with representation "date"). Using UTC here drifts by a day near
  // midnight in non-UTC timezones and desynchronizes seeded dates from the app.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

async function assertRows<T>(result: { data: T[] | null; error: { message: string } | null }) {
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}

async function assertWrite(result: { error: { message: string } | null }) {
  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function cleanupE2EData() {
  rmSync(E2E_ROLE_FILE, { force: true });

  const supabase = getE2ESupabase();

  const [profilesBySub, profilesByEmail] = await Promise.all([
    assertRows<E2EProfile>(await supabase.from("profiles").select("id").in("auth0_sub", E2E_PROFILE_AUTH0_SUBS)),
    assertRows<E2EProfile>(await supabase.from("profiles").select("id").in("email", E2E_PROFILE_EMAILS)),
  ]);
  const e2eProfileIds = [...new Set([...profilesBySub, ...profilesByEmail].map((profile) => profile.id))];

  if (e2eProfileIds.length > 0) {
    await assertWrite(await supabase.from("projects").delete().in("created_by", e2eProfileIds));
  }

  await assertWrite(await supabase.from("projects").delete().like("name", "E2E%"));
  await assertWrite(await supabase.from("profiles").delete().in("auth0_sub", E2E_PROFILE_AUTH0_SUBS));
  await assertWrite(await supabase.from("profiles").delete().in("email", E2E_PROFILE_EMAILS));
}

export async function resetE2EData(): Promise<SeedData> {
  await cleanupE2EData();

  const supabase = getE2ESupabase();

  const [manager, member] = await Promise.all([
    upsertE2EProfile({
      auth0_sub: E2E_MANAGER.sub,
      email: E2E_MANAGER.email,
      display_name: E2E_MANAGER.displayName,
      role: "manager",
    }),
    upsertE2EProfile({
      auth0_sub: E2E_MEMBER.sub,
      email: E2E_MEMBER.email,
      display_name: E2E_MEMBER.displayName,
      role: "member",
    }),
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
    await supabase.from("project_members").upsert([
      { project_id: project.id, profile_id: manager.id },
      { project_id: project.id, profile_id: member.id },
    ]),
  );

  await assertData<SeedTask[]>(
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
        {
          project_id: project.id,
          title: "E2E Seed Blocked Task",
          description: "Seeded blocked task for manager dashboard",
          assignee_id: member.id,
          status: "blocked",
          created_by: manager.id,
        },
      ])
      .select("id,title"),
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
