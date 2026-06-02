import { differenceInCalendarDays, formatISO, subDays } from "date-fns";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { getE2ERole, isE2EAuthBypassEnabled, isE2ERole } from "@/lib/e2e-session";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  DISPLAYED_NOTIFICATION_TYPES,
  type Blocker,
  type Notification,
  type Profile,
  type ProfileMembershipScope,
  type ProfileRole,
  type Project,
  type ProjectMember,
  type ProjectUserFlag,
  type ProjectUserFlagEvent,
  type RecurringOccurrence,
  type RecurringOccurrenceRow,
  type RecurringRule,
  type RecurringRuleWithHistory,
  type Suggestion,
  type SuggestionCategory,
  type SuggestionComment,
  type Task,
} from "@/lib/types";

type SessionUser = {
  sub?: string;
  email?: string;
  name?: string;
  nickname?: string;
  picture?: string;
};

type ProfileRow = Omit<Profile, "membership_scope"> & { membership_scope?: ProfileMembershipScope };

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isMissingRpc(error: { message: string } | null, functionName: string) {
  return Boolean(error?.message.includes(`function public.${functionName}`) && error.message.includes("schema cache"));
}

function isMissingColumn(error: { message: string } | null, columnName: string) {
  return Boolean(
    error?.message.includes(columnName) &&
      (error.message.includes("does not exist") || error.message.includes("schema cache")),
  );
}

function isMissingRelation(error: { message: string } | null, relationName: string) {
  return Boolean(
    error?.message.includes(relationName) &&
      (error.message.includes("does not exist") || error.message.includes("schema cache")),
  );
}

function todayISO() {
  return formatISO(new Date(), { representation: "date" });
}

function assertDb<T>(data: T | null, error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }

  return data as T;
}

function withDefaultMembershipScope(profile: ProfileRow): Profile {
  return {
    ...profile,
    membership_scope: profile.membership_scope ?? "workspace",
  };
}

function withDefaultMembershipScopes(profiles: ProfileRow[]) {
  return profiles.map(withDefaultMembershipScope);
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

async function reconcileProfileInApp(input: {
  auth0Sub: string;
  normalizedEmail: string;
  displayName: string;
  avatarUrl: string | null;
  role: ProfileRole;
  membershipScope: ProfileMembershipScope;
}) {
  const supabase = getSupabaseAdmin();
  const { data: existingData, error: existingError } = await supabase
    .from("profiles")
    .select("*")
    .eq("auth0_sub", input.auth0Sub)
    .maybeSingle();

  const existing = assertDb<Profile | null>(existingData, existingError);
  let existingByEmail: Profile | null = null;

  if (!existing) {
    const { data: existingByEmailData, error: existingByEmailError } = await supabase
      .from("profiles")
      .select("*")
      .ilike("email", input.normalizedEmail)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    existingByEmail = assertDb<Profile | null>(existingByEmailData, existingByEmailError);
  }

  const profile = existing ?? existingByEmail;
  const baseProfileValues = {
    auth0_sub: input.auth0Sub,
    email: input.normalizedEmail,
    display_name: profile?.display_name ?? input.displayName,
    avatar_url: input.avatarUrl,
    role: profile?.role ?? input.role,
  };
  const profileValues = {
    ...baseProfileValues,
    membership_scope: profile?.membership_scope ?? input.membershipScope,
  };

  let result = profile
    ? await supabase.from("profiles").update(profileValues).eq("id", profile.id).select("*").single()
    : await supabase.from("profiles").insert(profileValues).select("*").single();

  if (isMissingColumn(result.error, "membership_scope")) {
    result = profile
      ? await supabase.from("profiles").update(baseProfileValues).eq("id", profile.id).select("*").single()
      : await supabase
          .from("profiles")
          .upsert(baseProfileValues, { onConflict: "auth0_sub" })
          .select("*")
          .single();
  }

  return withDefaultMembershipScope(assertDb<ProfileRow>(result.data, result.error));
}

export async function ensureCurrentProfile() {
  const user = await getSessionUser();

  if (!user?.sub || !user.email) {
    redirect("/login");
  }

  const supabase = getSupabaseAdmin();
  const normalizedEmail = normalizeEmail(user.email);
  const managerEmail = process.env.MANAGER_EMAIL ? normalizeEmail(process.env.MANAGER_EMAIL) : null;

  // Only the configured MANAGER_EMAIL is granted the manager role on first
  // sign-in. Never auto-promote based on the absence of an existing manager,
  // which previously let any first/orphaned login become a manager. Existing
  // managers keep their role because the reconcile RPC only applies the role on
  // initial profile creation.
  const role: ProfileRole = managerEmail !== null && managerEmail === normalizedEmail ? "manager" : "member";
  // Login self-signups default to the workspace scope so they appear in the
  // workspace member list and are synced into every project. Project-only
  // members are created exclusively through the invite flow.
  const membershipScope: ProfileMembershipScope = "workspace";
  const displayName = user.name?.trim() || user.nickname?.trim() || normalizedEmail;
  const { data, error } = await supabase.rpc("reconcile_profile_identity", {
    p_auth0_sub: user.sub,
    p_email: normalizedEmail,
    p_display_name: displayName,
    p_avatar_url: user.picture ?? null,
    p_role: role,
  });

  if (isMissingRpc(error, "reconcile_profile_identity")) {
    return reconcileProfileInApp({
      auth0Sub: user.sub,
      normalizedEmail,
      displayName,
      avatarUrl: user.picture ?? null,
      role,
      membershipScope,
    });
  }

  return withDefaultMembershipScope(assertDb<ProfileRow>(data, error));
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

  return withDefaultMembershipScopes(assertDb<ProfileRow[]>(data, error));
}

export async function listWorkspaceProfiles() {
  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .select("*")
    .eq("membership_scope", "workspace")
    .order("display_name");

  if (isMissingColumn(error, "membership_scope")) {
    const { data: legacyData, error: legacyError } = await getSupabaseAdmin()
      .from("profiles")
      .select("*")
      .order("display_name");

    return withDefaultMembershipScopes(assertDb<ProfileRow[]>(legacyData, legacyError));
  }

  return withDefaultMembershipScopes(assertDb<ProfileRow[]>(data, error));
}

export async function listProjects(profile: Profile) {
  const supabase = getSupabaseAdmin();

  if (profile.membership_scope === "workspace") {
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
    .filter(Boolean)
    .filter((project) => !project.archived_at) as Project[];
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

export async function getAccessibleProject(profile: Profile, projectId: string) {
  const supabase = getSupabaseAdmin();

  if (profile.membership_scope === "workspace") {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .is("archived_at", null)
      .maybeSingle();

    return assertDb<Project | null>(data, error);
  }

  const { data, error } = await supabase
    .from("project_members")
    .select("projects(*)")
    .eq("project_id", projectId)
    .eq("profile_id", profile.id)
    .maybeSingle();

  const row = assertDb<{ projects: Project | Project[] | null } | null>(
    data as unknown as { projects: Project | Project[] | null } | null,
    error,
  );
  const project = Array.isArray(row?.projects) ? row?.projects[0] : row?.projects;

  return project && !project.archived_at ? project : null;
}

export async function canAccessProject(profile: Profile, projectId: string) {
  return Boolean(await getAccessibleProject(profile, projectId));
}

export async function requireProjectAccess(profile: Profile, projectId: string) {
  const project = await getAccessibleProject(profile, projectId);

  if (!project) {
    redirect("/today");
  }

  return project;
}

const TASK_LINKED_NOTIFICATION_TYPES = new Set<string>([
  "assignment_created",
  "recurring_task_created",
  "recurring_task_missed",
]);

export async function listNotifications(profileId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("profile_id", profileId)
    .in("type", [...DISPLAYED_NOTIFICATION_TYPES])
    .order("created_at", { ascending: false })
    .limit(30);

  const rows = assertDb<Notification[]>(data, error);

  const blockerIds = [
    ...new Set(
      rows.filter((row) => row.type === "blocker_status_changed" && row.blocker_id).map((row) => row.blocker_id as string),
    ),
  ];
  const taskIds = [
    ...new Set(
      rows
        .filter((row) => row.type !== "blocker_status_changed" && row.task_id)
        .map((row) => row.task_id as string),
    ),
  ];

  const [aliveBlockers, aliveTasks] = await Promise.all([
    blockerIds.length > 0
      ? supabase.from("blockers").select("id").in("id", blockerIds)
      : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
    taskIds.length > 0
      ? supabase.from("tasks").select("id").in("id", taskIds)
      : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
  ]);

  const blockerAlive = new Set((aliveBlockers.data ?? []).map((row) => row.id));
  const taskAlive = new Set((aliveTasks.data ?? []).map((row) => row.id));

  // Validate-on-read: for notifications that link to a task or blocker, only
  // surface them while that entity still exists (this also drops legacy rows
  // that predate entity linkage). Notifications that intentionally carry no
  // entity link (e.g. suggestion_traction, suggestion_promoted) reference the
  // suggestion via href and are always shown.
  return rows
    .filter((row) => {
      if (row.type === "blocker_status_changed") {
        return Boolean(row.blocker_id) && blockerAlive.has(row.blocker_id as string);
      }

      if (TASK_LINKED_NOTIFICATION_TYPES.has(row.type)) {
        return Boolean(row.task_id) && taskAlive.has(row.task_id as string);
      }

      return true;
    })
    .slice(0, 10);
}

export async function getAppContext(projectId?: string) {
  const profile = await ensureCurrentProfile();
  const [projects, notifications] = await Promise.all([
    listProjects(profile),
    listNotifications(profile.id),
  ]);

  const activeProject =
    projectId ? await requireProjectAccess(profile, projectId) : projects.length > 0 ? projects[0] : null;

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

const RECURRING_HISTORY_SIZE = 7;

function buildRecurringHistory(
  occurrences: RecurringOccurrenceRow[],
  ruleId: string,
  today: string,
  liveTaskId: string | null,
) {
  const ruleOccurrences = occurrences
    .filter((row) => row.rule_id === ruleId)
    .slice(0, RECURRING_HISTORY_SIZE);

  const history: RecurringOccurrence[] = [...ruleOccurrences].reverse().map((row) => ({
    date: row.occurrence_date,
    status:
      row.status === "done"
        ? "done"
        : row.occurrence_date < today
          ? "missed"
          : "pending",
  }));

  // The most recent occurrence on or before today determines whether the duty
  // has been completed for the current period.
  const pending = ruleOccurrences.find(
    (row) => row.status !== "done" && row.occurrence_date <= today,
  );
  const doneRecent = ruleOccurrences.find(
    (row) => row.status === "done" && row.occurrence_date <= today,
  );

  return {
    history,
    currentInstanceId: liveTaskId,
    currentPeriodDone: !pending && Boolean(doneRecent),
    completedCount: history.filter((occurrence) => occurrence.status === "done").length,
  };
}

async function fetchRecurringOccurrences(ruleIds: string[]) {
  if (ruleIds.length === 0) {
    return [] as RecurringOccurrenceRow[];
  }

  const { data, error } = await getSupabaseAdmin()
    .from("recurring_occurrences")
    .select("*")
    .in("rule_id", ruleIds)
    .order("occurrence_date", { ascending: false });

  return assertDb<RecurringOccurrenceRow[]>(data, error);
}

// Map each rule to its single live task (the ticket that moves between board
// columns). At most one row exists per rule under the new model.
async function fetchLiveRecurringTaskIds(ruleIds: string[]) {
  if (ruleIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .select("id, recurring_rule_id")
    .in("recurring_rule_id", ruleIds);

  const rows = assertDb<Array<{ id: string; recurring_rule_id: string | null }>>(data, error);
  const map = new Map<string, string>();

  for (const row of rows) {
    if (row.recurring_rule_id && !map.has(row.recurring_rule_id)) {
      map.set(row.recurring_rule_id, row.id);
    }
  }

  return map;
}

export async function listRecurringRulesWithHistory(projectId: string): Promise<RecurringRuleWithHistory[]> {
  const rules = await listRecurringRules(projectId);
  const today = todayISO();
  const ruleIds = rules.map((rule) => rule.id);
  const [occurrences, liveTaskIds] = await Promise.all([
    fetchRecurringOccurrences(ruleIds),
    fetchLiveRecurringTaskIds(ruleIds),
  ]);

  return rules.map((rule) => ({
    ...rule,
    ...buildRecurringHistory(occurrences, rule.id, today, liveTaskIds.get(rule.id) ?? null),
  }));
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

export async function listProjectUserFlags(projectId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("project_user_flags")
    .select("*, reporter:profiles!project_user_flags_flagged_by_fkey(*)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return assertDb<ProjectUserFlag[]>(data, error);
}

export async function getProjectUserFlagsState(projectId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("project_user_flags")
    .select("*, reporter:profiles!project_user_flags_flagged_by_fkey(*)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (isMissingRelation(error, "project_user_flags")) {
    return {
      flags: [],
      setupRequired: true,
    };
  }

  const rawFlags = assertDb<Array<Omit<ProjectUserFlag, "stage"> & { stage?: ProjectUserFlag["stage"] }>>(data, error);
  const flagIds = rawFlags.map((flag) => flag.id);

  let eventsByFlag = new Map<string, ProjectUserFlagEvent[]>();

  if (flagIds.length > 0) {
    const { data: eventData, error: eventError } = await supabase
      .from("project_user_flag_events")
      .select("*, actor:profiles!project_user_flag_events_actor_id_fkey(*)")
      .in("flag_id", flagIds)
      .order("created_at", { ascending: false });

    // The events table only exists once the staged-flagging migration has run.
    // Treat a missing relation as "no history yet" rather than a hard failure.
    if (!isMissingRelation(eventError, "project_user_flag_events")) {
      const events = assertDb<ProjectUserFlagEvent[]>(eventData, eventError);
      eventsByFlag = events.reduce((acc, event) => {
        const list = acc.get(event.flag_id) ?? [];
        list.push(event);
        acc.set(event.flag_id, list);
        return acc;
      }, new Map<string, ProjectUserFlagEvent[]>());
    }
  }

  const flags: ProjectUserFlag[] = rawFlags.map((flag) => ({
    ...flag,
    stage: flag.stage ?? "flagged",
    stage_updated_at: flag.stage_updated_at ?? null,
    stage_updated_by: flag.stage_updated_by ?? null,
    events: eventsByFlag.get(flag.id) ?? [],
  }));

  return {
    flags,
    setupRequired: false,
  };
}

export async function listSuggestions(projectId: string, viewerId: string, category?: SuggestionCategory) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("suggestions")
    .select("*, author:profiles!suggestions_author_id_fkey(*)")
    .eq("project_id", projectId);

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query.order("updated_at", { ascending: false });
  let suggestions: Array<Omit<Suggestion, "category"> & { category?: SuggestionCategory }>;

  if (isMissingColumn(error, "category")) {
    if (category && category !== "project") {
      return [];
    }

    const legacyResult = await supabase
      .from("suggestions")
      .select("*, author:profiles!suggestions_author_id_fkey(*)")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });

    suggestions = assertDb<Array<Omit<Suggestion, "category"> & { category?: SuggestionCategory }>>(
      legacyResult.data,
      legacyResult.error,
    );
  } else {
    suggestions = assertDb<Array<Omit<Suggestion, "category"> & { category?: SuggestionCategory }>>(data, error);
  }
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
      category: suggestion.category ?? "project",
      vote_count: voteCounts.get(suggestion.id) ?? 0,
      comment_count: commentCounts.get(suggestion.id) ?? 0,
      has_voted: viewerVoteSet.has(suggestion.id),
    }))
    .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0) || b.updated_at.localeCompare(a.updated_at));
}

export async function listSuggestionCategoryCounts(projectId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("suggestions")
    .select("category")
    .eq("project_id", projectId);

  if (isMissingColumn(error, "category")) {
    const { count, error: countError } = await supabase
      .from("suggestions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);

    if (countError) {
      throw new Error(countError.message);
    }

    return new Map<SuggestionCategory, number>([["project", count ?? 0]]);
  }

  const rows = assertDb<Array<Pick<Suggestion, "category">>>(data, error);
  const counts = new Map<SuggestionCategory, number>();

  for (const row of rows) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }

  return counts;
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

  const [profilesResult, overdueResult, blockersResult, suggestionsResult, recurringResult, recurringRulesResult] =
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
        .from("recurring_occurrences")
        .select("assignee_id,status,occurrence_date")
        .gte("occurrence_date", thirtyDaysAgo),
      supabase
        .from("recurring_rules")
        .select("*, assignee:profiles!recurring_rules_assignee_id_fkey(*), projects(name)")
        .eq("is_active", true)
        .order("title", { ascending: true }),
    ]);

  const profiles = assertDb<Profile[]>(profilesResult.data, profilesResult.error);
  const recurringRows = assertDb<
    Array<{ assignee_id: string | null; status: RecurringOccurrence["status"]; occurrence_date: string }>
  >(recurringResult.data, recurringResult.error);

  const recurringRuleRows = assertDb<Array<RecurringRule & { projects?: { name: string } | null }>>(
    recurringRulesResult.data,
    recurringRulesResult.error,
  );
  const recurringRuleIds = recurringRuleRows.map((rule) => rule.id);
  const [recurringOccurrences, recurringLiveTaskIds] = await Promise.all([
    fetchRecurringOccurrences(recurringRuleIds),
    fetchLiveRecurringTaskIds(recurringRuleIds),
  ]);
  const recurringDuties: RecurringRuleWithHistory[] = recurringRuleRows.map((rule) => ({
    ...rule,
    projectName: rule.projects?.name ?? null,
    ...buildRecurringHistory(recurringOccurrences, rule.id, today, recurringLiveTaskIds.get(rule.id) ?? null),
  }));

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
    recurringDuties,
  };
}

export { nextRunDate } from "@/lib/recurrence";
export { todayISO };
