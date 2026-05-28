import { addDays, differenceInCalendarDays, formatISO, subDays } from "date-fns";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { getE2ERole, isE2EAuthBypassEnabled, isE2ERole } from "@/lib/e2e-session";
import { getSupabaseAdmin } from "@/lib/supabase";
import type {
  Blocker,
  Notification,
  Profile,
  Project,
  ProjectMember,
  RecurringRule,
  Suggestion,
  SuggestionComment,
  Task,
  TaskStatus,
} from "@/lib/types";

type SessionUser = {
  sub?: string;
  email?: string;
  name?: string;
  nickname?: string;
  picture?: string;
};

function todayISO() {
  return formatISO(new Date(), { representation: "date" });
}

function assertDb<T>(data: T | null, error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }

  return data as T;
}

async function getE2ESessionUser(): Promise<SessionUser | null> {
  if (!isE2EAuthBypassEnabled()) {
    return null;
  }

  const role = (await cookies()).get("e2e-user")?.value ?? getE2ERole();

  if (!isE2ERole(role)) {
    return null;
  }

  return {
    sub: `e2e|${role}`,
    email: role === "manager" ? "manager.e2e@example.com" : "member.e2e@example.com",
    name: role === "manager" ? "E2E Manager" : "E2E Member",
    nickname: role,
  } satisfies SessionUser;
}

function logSessionReadError(error: unknown) {
  const errorInfo =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "UnknownSessionError", message: String(error) };

  console.warn("[auth] Unable to read Auth0 session", errorInfo);
}

function isNextDynamicServerError(error: unknown) {
  return error instanceof Error && error.message.includes("Dynamic server usage:");
}

export async function getSessionUser() {
  const e2eUser = await getE2ESessionUser();

  if (e2eUser) {
    return e2eUser;
  }

  let session: Awaited<ReturnType<typeof auth0.getSession>>;

  try {
    session = await auth0.getSession();
  } catch (error) {
    if (isNextDynamicServerError(error)) {
      throw error;
    }

    logSessionReadError(error);
    return null;
  }

  if (!session?.user) {
    return null;
  }

  return session.user as SessionUser;
}

export async function ensureCurrentProfile() {
  const user = await getSessionUser();

  if (!user?.sub || !user.email) {
    redirect("/login");
  }

  const supabase = getSupabaseAdmin();
  const normalizedEmail = user.email.toLowerCase();
  const managerEmail = process.env.MANAGER_EMAIL?.toLowerCase();

  const { data: existingData, error: existingError } = await supabase
    .from("profiles")
    .select("*")
    .eq("auth0_sub", user.sub)
    .maybeSingle();

  const existing = assertDb<Profile | null>(existingData, existingError);
  let existingByEmail: Profile | null = null;

  if (!existing) {
    const { data: existingByEmailData, error: existingByEmailError } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();

    existingByEmail = assertDb<Profile | null>(existingByEmailData, existingByEmailError);
  }

  const { data: manager } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "manager")
    .limit(1)
    .maybeSingle();

  const profile = existing ?? existingByEmail;
  const role = profile?.role ?? (managerEmail === normalizedEmail || !manager ? "manager" : "member");
  const displayName = profile?.display_name ?? user.name ?? user.nickname ?? normalizedEmail;
  const profileValues = {
    auth0_sub: user.sub,
    email: normalizedEmail,
    display_name: displayName,
    avatar_url: user.picture ?? null,
    role,
  };

  const { data, error } = profile
    ? await supabase.from("profiles").update(profileValues).eq("id", profile.id).select("*").single()
    : await supabase.from("profiles").insert(profileValues).select("*").single();

  return assertDb<Profile>(data, error);
}

export async function requireManager() {
  const profile = await ensureCurrentProfile();

  if (profile.role !== "manager") {
    redirect("/today");
  }

  return profile;
}

export async function listProfiles() {
  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .select("*")
    .order("display_name");

  return assertDb<Profile[]>(data, error);
}

export async function listProjects(profile: Profile) {
  const supabase = getSupabaseAdmin();

  if (profile.role === "manager") {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    return assertDb<Project[]>(data, error);
  }

  const { data, error } = await supabase
    .from("project_members")
    .select("projects(*)")
    .eq("profile_id", profile.id);

  const rows = assertDb<Array<{ projects: Project | Project[] | null }>>(data as unknown as Array<{
    projects: Project | Project[] | null;
  }> | null, error);
  return rows
    .flatMap((row) => (Array.isArray(row.projects) ? row.projects : row.projects ? [row.projects] : []))
    .filter(Boolean) as Project[];
}

export async function getProject(projectId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  return assertDb<Project | null>(data, error);
}

export async function listProjectMembers(projectId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("project_members")
    .select("*, profiles(*)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  return assertDb<ProjectMember[]>(data, error);
}

export async function listNotifications(profileId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("notifications")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(10);

  return assertDb<Notification[]>(data, error);
}

export async function getAppContext(projectId?: string) {
  const profile = await ensureCurrentProfile();
  const [projects, notifications] = await Promise.all([
    listProjects(profile),
    listNotifications(profile.id),
  ]);

  const activeProject =
    projectId ? await getProject(projectId) : projects.length > 0 ? projects[0] : null;

  return {
    profile,
    projects,
    activeProject,
    notifications,
  };
}

export async function listTasks(projectId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .select("*, assignee:profiles!tasks_assignee_id_fkey(*)")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return assertDb<Task[]>(data, error);
}

export async function listRecurringRules(projectId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("recurring_rules")
    .select("*, assignee:profiles!recurring_rules_assignee_id_fkey(*)")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .order("next_run_on", { ascending: true });

  return assertDb<RecurringRule[]>(data, error);
}

export async function listBlockers(projectId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("blockers")
    .select(
      "*, owner:profiles!blockers_owner_id_fkey(*), raiser:profiles!blockers_raised_by_fkey(*), task:tasks!blockers_task_id_fkey(id,title,assignee_id,status)",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  return assertDb<Blocker[]>(data, error);
}

export async function listSuggestions(projectId: string, viewerId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("suggestions")
    .select("*, author:profiles!suggestions_author_id_fkey(*)")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  const suggestions = assertDb<Suggestion[]>(data, error);
  const ids = suggestions.map((suggestion) => suggestion.id);

  if (ids.length === 0) {
    return [];
  }

  const [{ data: votes }, { data: comments }, { data: viewerVotes }] = await Promise.all([
    supabase.from("suggestion_votes").select("suggestion_id").in("suggestion_id", ids),
    supabase.from("suggestion_comments").select("suggestion_id").in("suggestion_id", ids),
    supabase
      .from("suggestion_votes")
      .select("suggestion_id")
      .eq("profile_id", viewerId)
      .in("suggestion_id", ids),
  ]);

  const voteCounts = new Map<string, number>();
  const commentCounts = new Map<string, number>();
  const viewerVoteSet = new Set((viewerVotes ?? []).map((vote) => vote.suggestion_id as string));

  for (const vote of votes ?? []) {
    voteCounts.set(vote.suggestion_id as string, (voteCounts.get(vote.suggestion_id as string) ?? 0) + 1);
  }

  for (const comment of comments ?? []) {
    commentCounts.set(
      comment.suggestion_id as string,
      (commentCounts.get(comment.suggestion_id as string) ?? 0) + 1,
    );
  }

  return suggestions
    .map((suggestion) => ({
      ...suggestion,
      vote_count: voteCounts.get(suggestion.id) ?? 0,
      comment_count: commentCounts.get(suggestion.id) ?? 0,
      has_voted: viewerVoteSet.has(suggestion.id),
    }))
    .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0) || b.updated_at.localeCompare(a.updated_at));
}

export async function listSuggestionComments(suggestionIds: string[]) {
  if (suggestionIds.length === 0) {
    return new Map<string, SuggestionComment[]>();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("suggestion_comments")
    .select("*, author:profiles!suggestion_comments_author_id_fkey(*)")
    .in("suggestion_id", suggestionIds)
    .order("created_at", { ascending: true });

  const comments = assertDb<SuggestionComment[]>(data, error);
  const map = new Map<string, SuggestionComment[]>();

  for (const comment of comments) {
    map.set(comment.suggestion_id, [...(map.get(comment.suggestion_id) ?? []), comment]);
  }

  return map;
}

export async function getTodayTasks(profileId: string) {
  const today = todayISO();
  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .select("*, assignee:profiles!tasks_assignee_id_fkey(*), projects(name)")
    .eq("assignee_id", profileId)
    .neq("status", "done")
    .or(`due_date.lte.${today},status.eq.today,generated_for_date.eq.${today}`)
    .order("due_date", { ascending: true, nullsFirst: false });

  return assertDb<Array<Task & { projects?: { name: string } | null }>>(data, error);
}

export async function getManagerDashboard() {
  await requireManager();
  const supabase = getSupabaseAdmin();
  const today = todayISO();
  const thirtyDaysAgo = formatISO(subDays(new Date(), 30), { representation: "date" });

  const [profilesResult, overdueResult, blockersResult, suggestionsResult, recurringResult] =
    await Promise.all([
      supabase.from("profiles").select("*").order("display_name"),
      supabase
        .from("tasks")
        .select("*, assignee:profiles!tasks_assignee_id_fkey(*), projects(name)")
        .lt("due_date", today)
        .neq("status", "done")
        .order("due_date", { ascending: true }),
      supabase
        .from("blockers")
        .select(
          "*, owner:profiles!blockers_owner_id_fkey(*), raiser:profiles!blockers_raised_by_fkey(*), task:tasks!blockers_task_id_fkey(id,title,assignee_id,status), projects(name)",
        )
        .neq("status", "resolved")
        .order("created_at", { ascending: true }),
      supabase
        .from("suggestions")
        .select("*, author:profiles!suggestions_author_id_fkey(*), suggestion_votes(suggestion_id)")
        .neq("status", "parked")
        .order("updated_at", { ascending: false })
        .limit(10),
      supabase
        .from("tasks")
        .select("assignee_id,status,generated_for_date")
        .not("recurring_rule_id", "is", null)
        .gte("generated_for_date", thirtyDaysAgo),
    ]);

  const profiles = assertDb<Profile[]>(profilesResult.data, profilesResult.error);
  const recurringRows = assertDb<
    Array<{ assignee_id: string | null; status: TaskStatus; generated_for_date: string | null }>
  >(recurringResult.data, recurringResult.error);

  const completionByPerson = profiles.map((profile) => {
    const rows = recurringRows.filter((row) => row.assignee_id === profile.id);
    const completed = rows.filter((row) => row.status === "done").length;

    return {
      profile,
      total: rows.length,
      completed,
      rate: rows.length === 0 ? 0 : Math.round((completed / rows.length) * 100),
    };
  });

  return {
    profiles,
    overdueTasks: assertDb<Array<Task & { projects?: { name: string } | null }>>(
      overdueResult.data,
      overdueResult.error,
    ),
    blockers: assertDb<Array<Blocker & { projects?: { name: string } | null }>>(
      blockersResult.data,
      blockersResult.error,
    ).map((blocker) => ({
      ...blocker,
      ageDays: differenceInCalendarDays(new Date(), new Date(blocker.created_at)),
    })),
    suggestions: assertDb<Array<Suggestion & { suggestion_votes?: unknown[] }>>(
      suggestionsResult.data,
      suggestionsResult.error,
    ).map((suggestion) => ({
      ...suggestion,
      vote_count: suggestion.suggestion_votes?.length ?? 0,
    })),
    completionByPerson,
  };
}

export function nextRunDate(rule: Pick<RecurringRule, "frequency" | "interval_days" | "weekdays" | "next_run_on">) {
  const current = new Date(`${rule.next_run_on}T00:00:00`);

  if (rule.frequency === "daily") {
    return formatISO(addDays(current, 1), { representation: "date" });
  }

  if (rule.frequency === "custom") {
    return formatISO(addDays(current, rule.interval_days ?? 1), { representation: "date" });
  }

  const weekdays = rule.weekdays.length > 0 ? rule.weekdays : [current.getDay()];
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addDays(current, offset);
    if (weekdays.includes(candidate.getDay())) {
      return formatISO(candidate, { representation: "date" });
    }
  }

  return formatISO(addDays(current, 7), { representation: "date" });
}

export { todayISO };
