"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ensureCurrentProfile, nextRunDate, requireManager, todayISO } from "@/lib/data";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { BlockerStatus, ProfileRole, RecurrenceFrequency, SuggestionStatus, TaskStatus } from "@/lib/types";

const profileRoleSchema = z.enum(["manager", "member"]);

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMissingRpc(error: { message: string } | null, functionName: string) {
  return Boolean(error?.message.includes(`function public.${functionName}`) && error.message.includes("schema cache"));
}

async function upsertInvitedProfileInApp(email: string, displayName: string, role: ProfileRole) {
  const supabase = getSupabaseAdmin();
  const { data: existingProfile, error: existingError } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const result = existingProfile
    ? await supabase
        .from("profiles")
        .update({
          email,
          display_name: displayName,
          role,
        })
        .eq("id", existingProfile.id)
    : await supabase.from("profiles").insert({
        auth0_sub: `pending|${email}`,
        email,
        display_name: displayName,
        role,
      });

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function notify(input: {
  profileId: string | null | undefined;
  actorId?: string | null;
  type:
    | "assignment_created"
    | "blocker_status_changed"
    | "recurring_task_created"
    | "suggestion_traction"
    | "suggestion_promoted";
  title: string;
  body?: string | null;
  href?: string | null;
}) {
  if (!input.profileId) {
    return;
  }

  await getSupabaseAdmin().from("notifications").insert({
    profile_id: input.profileId,
    actor_id: input.actorId ?? null,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
  });
}

async function defaultManagerId() {
  const { data } = await getSupabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("role", "manager")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

export async function createProject(formData: FormData) {
  const profile = await requireManager();
  const name = text(formData, "name");

  if (!name) {
    return;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("projects")
    .insert({
      name,
      description: text(formData, "description"),
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await getSupabaseAdmin().from("project_members").insert({
    project_id: data.id,
    profile_id: profile.id,
  });

  revalidatePath("/settings");
  redirect(`/projects/${data.id}/board`);
}

export async function addTeamMember(formData: FormData) {
  await requireManager();
  const displayName = text(formData, "displayName");
  const emailValue = text(formData, "email")?.toLowerCase();
  const role = profileRoleSchema.parse(text(formData, "role") ?? "member");

  if (!displayName || !emailValue) {
    return;
  }

  const email = z.string().email().parse(emailValue);
  const supabase = getSupabaseAdmin();
  const result = await supabase.rpc("upsert_invited_profile", {
    p_email: email,
    p_display_name: displayName,
    p_role: role,
  });

  if (isMissingRpc(result.error, "upsert_invited_profile")) {
    await upsertInvitedProfileInApp(email, displayName, role);
    revalidatePath("/settings");
    revalidatePath("/manager");
    return;
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  revalidatePath("/settings");
  revalidatePath("/manager");
}

export async function addProjectMember(formData: FormData) {
  await requireManager();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const email = text(formData, "email")?.toLowerCase();

  if (!email) {
    return;
  }

  const { data: profile } = await getSupabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!profile) {
    return;
  }

  await getSupabaseAdmin().from("project_members").upsert({
    project_id: projectId,
    profile_id: profile.id,
  });

  revalidatePath("/settings");
  revalidatePath(`/projects/${projectId}/board`);
}

export async function createTask(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const title = text(formData, "title");
  const assigneeId = text(formData, "assigneeId");

  if (!title) {
    return;
  }

  const status = (text(formData, "status") ?? "backlog") as TaskStatus;
  const { error } = await getSupabaseAdmin()
    .from("tasks")
    .insert({
      project_id: projectId,
      title,
      description: text(formData, "description"),
      assignee_id: assigneeId,
      due_date: text(formData, "dueDate"),
      status,
      created_by: profile.id,
    });

  if (error) {
    throw new Error(error.message);
  }

  await notify({
    profileId: assigneeId,
    actorId: profile.id,
    type: "assignment_created",
    title: "New task assigned",
    body: title,
    href: `/projects/${projectId}/board`,
  });

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath("/today");
}

export async function updateTaskStatus(formData: FormData) {
  await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const taskId = z.string().uuid().parse(text(formData, "taskId"));
  const status = z
    .enum(["backlog", "today", "in_progress", "blocked", "done"])
    .parse(text(formData, "status")) as TaskStatus;

  await getSupabaseAdmin()
    .from("tasks")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", taskId);

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath("/today");
  revalidatePath("/manager");
}

export async function createRecurringRule(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const title = text(formData, "title");
  const frequency = z
    .enum(["daily", "weekly", "custom"])
    .parse(text(formData, "frequency")) as RecurrenceFrequency;
  const assigneeId = text(formData, "assigneeId");

  if (!title) {
    return;
  }

  const interval = Number(text(formData, "intervalDays") ?? "1");
  const weekdays = String(text(formData, "weekdays") ?? "")
    .split(",")
    .map((day) => Number(day.trim()))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  await getSupabaseAdmin().from("recurring_rules").insert({
    project_id: projectId,
    title,
    description: text(formData, "description"),
    assignee_id: assigneeId,
    frequency,
    interval_days: frequency === "custom" ? interval : null,
    weekdays: frequency === "weekly" ? weekdays : [],
    next_run_on: text(formData, "nextRunOn") ?? todayISO(),
    created_by: profile.id,
  });

  revalidatePath(`/projects/${projectId}/board`);
}

export async function createBlocker(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const taskId = text(formData, "taskId");
  const title = text(formData, "title");

  if (!title) {
    return;
  }

  const ownerId = text(formData, "ownerId") ?? (await defaultManagerId());

  await getSupabaseAdmin().from("blockers").insert({
    project_id: projectId,
    task_id: taskId,
    title,
    description: text(formData, "description"),
    owner_id: ownerId,
    raised_by: profile.id,
  });

  if (taskId) {
    await getSupabaseAdmin().from("tasks").update({ status: "blocked" }).eq("id", taskId);
  }

  await notify({
    profileId: ownerId,
    actorId: profile.id,
    type: "blocker_status_changed",
    title: "New blocker raised",
    body: title,
    href: `/projects/${projectId}/blockers`,
  });

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/blockers`);
  revalidatePath("/manager");
}

export async function updateBlockerStatus(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const blockerId = z.string().uuid().parse(text(formData, "blockerId"));
  const status = z
    .enum(["open", "acknowledged", "resolved"])
    .parse(text(formData, "status")) as BlockerStatus;

  const { data: blocker } = await getSupabaseAdmin()
    .from("blockers")
    .select("title, task:tasks!blockers_task_id_fkey(assignee_id)")
    .eq("id", blockerId)
    .maybeSingle();

  await getSupabaseAdmin()
    .from("blockers")
    .update({
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    })
    .eq("id", blockerId);

  const task = Array.isArray(blocker?.task) ? blocker?.task[0] : blocker?.task;

  if (status === "resolved") {
    await notify({
      profileId: task?.assignee_id,
      actorId: profile.id,
      type: "blocker_status_changed",
      title: "Blocker resolved",
      body: blocker?.title ?? "A blocker was resolved. Confirm before moving the task.",
      href: `/projects/${projectId}/board`,
    });
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/blockers`);
  revalidatePath("/manager");
}

export async function createSuggestion(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const title = text(formData, "title");

  if (!title) {
    return;
  }

  await getSupabaseAdmin().from("suggestions").insert({
    project_id: projectId,
    title,
    description: text(formData, "description"),
    author_id: profile.id,
  });

  revalidatePath(`/projects/${projectId}/suggestions`);
}

export async function voteSuggestion(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const suggestionId = z.string().uuid().parse(text(formData, "suggestionId"));

  const supabase = getSupabaseAdmin();
  await supabase.from("suggestion_votes").upsert({
    suggestion_id: suggestionId,
    profile_id: profile.id,
  });

  const { count } = await supabase
    .from("suggestion_votes")
    .select("suggestion_id", { count: "exact", head: true })
    .eq("suggestion_id", suggestionId);

  const threshold = Number(process.env.SUGGESTION_TRACTION_THRESHOLD ?? "3");
  if ((count ?? 0) >= threshold) {
    const managerId = await defaultManagerId();
    await notify({
      profileId: managerId,
      actorId: profile.id,
      type: "suggestion_traction",
      title: "Suggestion gaining traction",
      body: `${count ?? 0} upvotes on a project suggestion.`,
      href: `/projects/${projectId}/suggestions`,
    });
  }

  revalidatePath(`/projects/${projectId}/suggestions`);
  revalidatePath("/manager");
}

export async function commentSuggestion(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const suggestionId = z.string().uuid().parse(text(formData, "suggestionId"));
  const body = text(formData, "body");

  if (!body) {
    return;
  }

  await getSupabaseAdmin().from("suggestion_comments").insert({
    suggestion_id: suggestionId,
    author_id: profile.id,
    body,
  });

  await getSupabaseAdmin().from("suggestions").update({ updated_at: new Date().toISOString() }).eq("id", suggestionId);
  revalidatePath(`/projects/${projectId}/suggestions`);
}

export async function updateSuggestionStatus(formData: FormData) {
  await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const suggestionId = z.string().uuid().parse(text(formData, "suggestionId"));
  const status = z
    .enum(["open", "under_consideration", "accepted", "parked"])
    .parse(text(formData, "status")) as SuggestionStatus;

  await getSupabaseAdmin().from("suggestions").update({ status }).eq("id", suggestionId);

  revalidatePath(`/projects/${projectId}/suggestions`);
  revalidatePath("/manager");
}

export async function promoteSuggestionToTask(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const suggestionId = z.string().uuid().parse(text(formData, "suggestionId"));
  const assigneeId = text(formData, "assigneeId");

  const { data: suggestion, error } = await getSupabaseAdmin()
    .from("suggestions")
    .select("title, description")
    .eq("id", suggestionId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const { data: task, error: taskError } = await getSupabaseAdmin()
    .from("tasks")
    .insert({
      project_id: projectId,
      title: suggestion.title,
      description: suggestion.description,
      assignee_id: assigneeId,
      status: "backlog",
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (taskError) {
    throw new Error(taskError.message);
  }

  await getSupabaseAdmin()
    .from("suggestions")
    .update({ status: "accepted", promoted_task_id: task.id })
    .eq("id", suggestionId);

  await notify({
    profileId: assigneeId,
    actorId: profile.id,
    type: "suggestion_promoted",
    title: "Suggestion promoted to task",
    body: suggestion.title,
    href: `/projects/${projectId}/board`,
  });

  revalidatePath(`/projects/${projectId}/suggestions`);
  revalidatePath(`/projects/${projectId}/board`);
}

export async function markNotificationRead(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const notificationId = z.string().uuid().parse(text(formData, "notificationId"));

  await getSupabaseAdmin()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("profile_id", profile.id);

  revalidatePath("/");
}

export async function generateRecurringInstances() {
  const supabase = getSupabaseAdmin();
  const today = todayISO();
  const { data: rules, error } = await supabase
    .from("recurring_rules")
    .select("*")
    .eq("is_active", true)
    .lte("next_run_on", today);

  if (error) {
    throw new Error(error.message);
  }

  for (const rule of rules ?? []) {
    const dueDate = rule.next_run_on as string;
    const { error: insertError } = await supabase.from("tasks").upsert(
      {
        project_id: rule.project_id,
        recurring_rule_id: rule.id,
        title: rule.title,
        description: rule.description,
        assignee_id: rule.assignee_id,
        due_date: dueDate,
        generated_for_date: dueDate,
        status: "today",
        created_by: rule.created_by,
      },
      { onConflict: "recurring_rule_id,generated_for_date" },
    );

    if (insertError) {
      throw new Error(insertError.message);
    }

    await notify({
      profileId: rule.assignee_id,
      actorId: rule.created_by,
      type: "recurring_task_created",
      title: "Recurring duty ready",
      body: rule.title,
      href: `/projects/${rule.project_id}/board`,
    });

    await supabase
      .from("recurring_rules")
      .update({ next_run_on: nextRunDate(rule) })
      .eq("id", rule.id);
  }

  revalidatePath("/today");
  revalidatePath("/manager");
  return rules?.length ?? 0;
}
