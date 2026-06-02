"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ensureCurrentProfile, nextRunDate, requireManager, requireProjectAccess, todayISO } from "@/lib/data";
import { callLabelboxModel } from "@/lib/llm";
import { recurringRunDatesUpTo } from "@/lib/recurrence";
import { getSupabaseAdmin } from "@/lib/supabase";
import { httpUrlSchema } from "@/lib/validation";
import { FLAG_STAGES, SUGGESTION_CATEGORIES } from "@/lib/types";
import type {
  BlockerStatus,
  FlagStage,
  Profile,
  ProfileMembershipScope,
  ProfileRole,
  RecurrenceFrequency,
  SuggestionStatus,
  TaskStatus,
} from "@/lib/types";

const profileRoleSchema = z.enum(["manager", "member"]);
const profileMembershipScopeSchema = z.enum(["workspace", "project"]);
const suggestionCategorySchema = z.enum(SUGGESTION_CATEGORIES);
const suggestionImageTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);
const suggestionScreenshotBucket = "suggestion-screenshots";
const flagScreenshotBucket = "flag-screenshots";
const maxSuggestionImagesPerSubmit = 4;
const maxSuggestionImageBytes = 5 * 1024 * 1024;

function text(formData: FormData, key: string) {
  const value =
    formData.get(key) ??
    Array.from(formData.entries()).find(([entryKey]) => entryKey.endsWith(`_${key}`))?.[1];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File && value.size > 0;
}

function suggestionScreenshotFiles(formData: FormData) {
  const files = formData.getAll("screenshots").filter(isUploadedFile);

  if (files.length > maxSuggestionImagesPerSubmit) {
    throw new Error(`Upload up to ${maxSuggestionImagesPerSubmit} screenshots at a time.`);
  }

  for (const file of files) {
    if (!suggestionImageTypes.has(file.type)) {
      throw new Error("Screenshots must be PNG, JPEG, WebP, or GIF images.");
    }

    if (file.size > maxSuggestionImageBytes) {
      throw new Error("Screenshots must be 5MB or smaller.");
    }
  }

  return files;
}

function appendMarkdownImages(body: string | null, imageMarkdown: string[]) {
  const attachments = imageMarkdown.join("\n");

  if (!attachments) {
    return body;
  }

  return body ? `${body}\n\n${attachments}` : attachments;
}

async function uploadSuggestionScreenshots(input: {
  projectId: string;
  suggestionId: string;
  threadItemId: string;
  files: File[];
}) {
  if (input.files.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();

  return Promise.all(
    input.files.map(async (file, index) => {
      const extension = suggestionImageTypes.get(file.type);
      const objectPath = `${input.projectId}/${input.suggestionId}/${input.threadItemId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from(suggestionScreenshotBucket).upload(objectPath, file, {
        contentType: file.type,
        upsert: false,
      });

      if (error) {
        throw new Error(error.message);
      }

      const { data } = supabase.storage.from(suggestionScreenshotBucket).getPublicUrl(objectPath);
      return `![screenshot ${index + 1}](${data.publicUrl})`;
    }),
  );
}

async function uploadFlagScreenshots(input: { projectId: string; flagId: string; files: File[] }) {
  if (input.files.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();

  return Promise.all(
    input.files.map(async (file) => {
      const extension = suggestionImageTypes.get(file.type);
      const objectPath = `${input.projectId}/${input.flagId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from(flagScreenshotBucket).upload(objectPath, file, {
        contentType: file.type,
        upsert: false,
      });

      if (error) {
        throw new Error(error.message);
      }

      const { data } = supabase.storage.from(flagScreenshotBucket).getPublicUrl(objectPath);
      return data.publicUrl;
    }),
  );
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

function withDefaultMembershipScope(profile: Omit<Profile, "membership_scope"> & { membership_scope?: ProfileMembershipScope }) {
  return {
    ...profile,
    membership_scope: profile.membership_scope ?? "workspace",
  } as Profile;
}

async function upsertInvitedProfileInApp(
  email: string,
  displayName: string,
  role: ProfileRole,
  membershipScope: ProfileMembershipScope,
) {
  const supabase = getSupabaseAdmin();
  const effectiveScope: ProfileMembershipScope = role === "manager" ? "workspace" : membershipScope;
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
          membership_scope: effectiveScope,
        })
        .eq("id", existingProfile.id)
        .select("*")
        .single()
    : await supabase.from("profiles").insert({
        auth0_sub: `pending|${email}`,
        email,
        display_name: displayName,
        role,
        membership_scope: effectiveScope,
      }).select("*").single();

  if (isMissingColumn(result.error, "membership_scope")) {
    const legacyResult = existingProfile
      ? await supabase
          .from("profiles")
          .update({
            email,
            display_name: displayName,
            role,
          })
          .eq("id", existingProfile.id)
          .select("*")
          .single()
      : await supabase
          .from("profiles")
          .insert({
            auth0_sub: `pending|${email}`,
            email,
            display_name: displayName,
            role,
          })
          .select("*")
          .single();

    if (legacyResult.error) {
      throw new Error(legacyResult.error.message);
    }

    return withDefaultMembershipScope(legacyResult.data as Omit<Profile, "membership_scope">);
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  return withDefaultMembershipScope(result.data as Omit<Profile, "membership_scope"> & {
    membership_scope?: ProfileMembershipScope;
  });
}

async function upsertInvitedProfile(input: {
  email: string;
  displayName: string;
  role: ProfileRole;
  membershipScope: ProfileMembershipScope;
}) {
  const supabase = getSupabaseAdmin();
  const result = await supabase.rpc("upsert_invited_profile", {
    p_email: input.email,
    p_display_name: input.displayName,
    p_role: input.role,
    p_membership_scope: input.membershipScope,
  });

  if (isMissingRpc(result.error, "upsert_invited_profile") || isMissingColumn(result.error, "membership_scope")) {
    return upsertInvitedProfileInApp(input.email, input.displayName, input.role, input.membershipScope);
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  return withDefaultMembershipScope(result.data as Omit<Profile, "membership_scope"> & {
    membership_scope?: ProfileMembershipScope;
  });
}

async function syncWorkspaceMemberships(profileId: string) {
  const supabase = getSupabaseAdmin();
  const { data: projects, error } = await supabase.from("projects").select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!projects?.length) {
    return;
  }

  const { error: upsertError } = await supabase.from("project_members").upsert(
    projects.map((project) => ({
      project_id: project.id as string,
      profile_id: profileId,
    })),
  );

  if (upsertError) {
    throw new Error(upsertError.message);
  }
}

async function syncProjectWorkspaceMembers(projectId: string) {
  const supabase = getSupabaseAdmin();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("membership_scope", "workspace");

  if (isMissingColumn(error, "membership_scope")) {
    const { data: legacyProfiles, error: legacyError } = await supabase.from("profiles").select("id");

    if (legacyError) {
      throw new Error(legacyError.message);
    }

    if (!legacyProfiles?.length) {
      return;
    }

    const { error: legacyUpsertError } = await supabase.from("project_members").upsert(
      legacyProfiles.map((profile) => ({
        project_id: projectId,
        profile_id: profile.id as string,
      })),
    );

    if (legacyUpsertError) {
      throw new Error(legacyUpsertError.message);
    }

    return;
  }

  if (error) {
    throw new Error(error.message);
  }

  if (!profiles?.length) {
    return;
  }

  const { error: upsertError } = await supabase.from("project_members").upsert(
    profiles.map((profile) => ({
      project_id: projectId,
      profile_id: profile.id as string,
    })),
  );

  if (upsertError) {
    throw new Error(upsertError.message);
  }
}

async function notify(input: {
  profileId: string | null | undefined;
  actorId?: string | null;
  type:
    | "assignment_created"
    | "blocker_status_changed"
    | "recurring_task_created"
    | "recurring_task_missed"
    | "suggestion_traction"
    | "suggestion_promoted"
    | "flag_removal_requested";
  title: string;
  body?: string | null;
  href?: string | null;
  taskId?: string | null;
  blockerId?: string | null;
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
    task_id: input.taskId ?? null,
    blocker_id: input.blockerId ?? null,
  });
}

async function managerProfileIds() {
  const { data } = await getSupabaseAdmin().from("profiles").select("id").eq("role", "manager");

  return (data ?? []).map((row) => row.id as string);
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

function revalidateProjectMembership(projectId: string) {
  revalidatePath("/settings");
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/blockers`);
  revalidatePath(`/projects/${projectId}/flags`);
  revalidatePath(`/projects/${projectId}/suggestions`);
  revalidatePath(`/projects/${projectId}/settings`);
}

function revalidateMemberChanges(projectIds: string[]) {
  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/manager");

  for (const projectId of new Set(projectIds)) {
    revalidateProjectMembership(projectId);
  }
}

async function getProfileMembership(profileId: string) {
  const supabase = getSupabaseAdmin();
  const result = await supabase.from("profiles").select("id, role, membership_scope").eq("id", profileId).maybeSingle();

  if (isMissingColumn(result.error, "membership_scope")) {
    const legacyResult = await supabase.from("profiles").select("id, role").eq("id", profileId).maybeSingle();

    if (legacyResult.error) {
      throw new Error(legacyResult.error.message);
    }

    if (!legacyResult.data) {
      return null;
    }

    return {
      id: legacyResult.data.id as string,
      role: legacyResult.data.role as ProfileRole,
      membership_scope: "workspace" satisfies ProfileMembershipScope,
    };
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (!result.data) {
    return null;
  }

  return {
    id: result.data.id as string,
    role: result.data.role as ProfileRole,
    membership_scope: ((result.data as { membership_scope?: ProfileMembershipScope }).membership_scope ??
      "workspace") satisfies ProfileMembershipScope,
  };
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

  await syncProjectWorkspaceMembers(data.id);

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
  const invitedProfile = await upsertInvitedProfile({
    email,
    displayName,
    role,
    membershipScope: "workspace",
  });
  await syncWorkspaceMemberships(invitedProfile.id);

  revalidatePath("/settings");
  revalidatePath("/manager");
}

export async function addProjectMember(formData: FormData) {
  const manager = await requireManager();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const profileId = text(formData, "profileId");
  const displayName = text(formData, "displayName");
  const email = text(formData, "email")?.toLowerCase();

  await requireProjectAccess(manager, projectId);

  const supabase = getSupabaseAdmin();

  if (profileId) {
    const selectedProfileId = z.string().uuid().parse(profileId);
    const { data: selectedProfile, error: selectedProfileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", selectedProfileId)
      .maybeSingle();

    if (selectedProfileError) {
      throw new Error(selectedProfileError.message);
    }

    if (!selectedProfile) {
      return;
    }

    if (withDefaultMembershipScope(selectedProfile as Omit<Profile, "membership_scope">).membership_scope === "workspace") {
      await syncWorkspaceMemberships(selectedProfileId);
      revalidateProjectMembership(projectId);
      return;
    }

    const { error: memberError } = await supabase.from("project_members").upsert({
      project_id: projectId,
      profile_id: selectedProfileId,
    });

    if (memberError) {
      throw new Error(memberError.message);
    }

    revalidateProjectMembership(projectId);
    return;
  }

  if (!displayName || !email) {
    return;
  }

  const normalizedEmail = z.string().email().parse(email);
  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  let projectMemberProfile = existingProfile as Profile | null;

  if (projectMemberProfile?.membership_scope === "workspace") {
    await syncWorkspaceMemberships(projectMemberProfile.id);
    revalidateProjectMembership(projectId);
    return;
  }

  if (projectMemberProfile) {
    const { data: existingMemberships, error: membershipError } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("profile_id", projectMemberProfile.id);

    if (membershipError) {
      throw new Error(membershipError.message);
    }

    const otherProject = existingMemberships?.find((membership) => membership.project_id !== projectId);
    if (otherProject) {
      throw new Error("Project-only members can only belong to one project.");
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ display_name: displayName, role: "member", membership_scope: "project" })
      .eq("id", projectMemberProfile.id);

    if (isMissingColumn(updateError, "membership_scope")) {
      const { error: legacyUpdateError } = await supabase
        .from("profiles")
        .update({ display_name: displayName, role: "member" })
        .eq("id", projectMemberProfile.id);

      if (legacyUpdateError) {
        throw new Error(legacyUpdateError.message);
      }
    } else if (updateError) {
      throw new Error(updateError.message);
    }
  } else {
    projectMemberProfile = await upsertInvitedProfile({
      email: normalizedEmail,
      displayName,
      role: "member",
      membershipScope: profileMembershipScopeSchema.parse("project"),
    });
  }

  const { error: memberError } = await supabase.from("project_members").upsert({
    project_id: projectId,
    profile_id: projectMemberProfile.id,
  });

  if (memberError) {
    throw new Error(memberError.message);
  }

  revalidateProjectMembership(projectId);
}

export async function deleteWorkspaceMember(formData: FormData) {
  const manager = await requireManager();
  const profileId = z.string().uuid().parse(text(formData, "profileId"));

  if (profileId === manager.id) {
    return;
  }

  const targetProfile = await getProfileMembership(profileId);

  if (!targetProfile || targetProfile.membership_scope !== "workspace") {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: memberships, error: membershipError } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("profile_id", profileId);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  const { error } = await supabase.from("profiles").delete().eq("id", profileId);

  if (error) {
    throw new Error(error.message);
  }

  revalidateMemberChanges((memberships ?? []).map((membership) => membership.project_id as string));
}

export async function deleteProjectMember(formData: FormData) {
  const manager = await requireManager();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const profileId = z.string().uuid().parse(text(formData, "profileId"));

  await requireProjectAccess(manager, projectId);

  const targetProfile = await getProfileMembership(profileId);

  if (!targetProfile || targetProfile.membership_scope === "workspace") {
    return;
  }

  const { error } = await getSupabaseAdmin()
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("profile_id", profileId);

  if (error) {
    throw new Error(error.message);
  }

  revalidateMemberChanges([projectId]);
}

export async function deleteProject(formData: FormData) {
  await requireManager();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const confirmName = text(formData, "confirmName");
  const supabase = getSupabaseAdmin();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    throw new Error(projectError.message);
  }

  if (!project || confirmName !== project.name) {
    return;
  }

  const { error } = await supabase.from("projects").delete().eq("id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/manager");
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/blockers`);
  revalidatePath(`/projects/${projectId}/flags`);
  revalidatePath(`/projects/${projectId}/suggestions`);
}

export async function createTask(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const title = text(formData, "title");
  const assigneeId = text(formData, "assigneeId");

  if (!title) {
    return;
  }

  await requireProjectAccess(profile, projectId);

  const status = (text(formData, "status") ?? "backlog") as TaskStatus;
  const { data: task, error } = await getSupabaseAdmin()
    .from("tasks")
    .insert({
      project_id: projectId,
      title,
      description: text(formData, "description"),
      assignee_id: assigneeId,
      due_date: text(formData, "dueDate"),
      status,
      created_by: profile.id,
    })
    .select("id")
    .single();

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
    taskId: task.id,
  });

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath("/today");
}

export async function updateTaskStatus(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const taskId = z.string().uuid().parse(text(formData, "taskId"));
  const status = z
    .enum(["backlog", "today", "in_progress", "blocked", "done"])
    .parse(text(formData, "status")) as TaskStatus;

  await requireProjectAccess(profile, projectId);

  const supabase = getSupabaseAdmin();
  const { data: updated, error: updateError } = await supabase
    .from("tasks")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .eq("project_id", projectId)
    .select("recurring_rule_id, generated_for_date, assignee_id")
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message);
  }

  // Keep the occurrence history log in sync when a recurring ticket is moved
  // into or out of the Done column.
  if (updated?.recurring_rule_id && updated.generated_for_date) {
    await syncRecurringOccurrence(supabase, {
      ruleId: updated.recurring_rule_id,
      projectId,
      occurrenceDate: updated.generated_for_date,
      assigneeId: updated.assignee_id,
      done: status === "done",
    });
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath("/today");
  revalidatePath("/manager");
}

export async function deleteTask(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const taskId = z.string().uuid().parse(text(formData, "taskId"));

  await requireProjectAccess(profile, projectId);

  const { error } = await getSupabaseAdmin().from("tasks").delete().eq("id", taskId).eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/blockers`);
  revalidatePath(`/projects/${projectId}/suggestions`);
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

  await requireProjectAccess(profile, projectId);

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

export async function deleteRecurringRule(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const ruleId = z.string().uuid().parse(text(formData, "ruleId"));

  await requireProjectAccess(profile, projectId);

  const { error } = await getSupabaseAdmin()
    .from("recurring_rules")
    .delete()
    .eq("id", ruleId)
    .eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath("/today");
  revalidatePath("/manager");
}

export async function createBlocker(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const taskId = text(formData, "taskId");
  const title = text(formData, "title");

  if (!title) {
    return;
  }

  await requireProjectAccess(profile, projectId);

  const ownerId = text(formData, "ownerId") ?? (await defaultManagerId());

  const { data: blocker, error: blockerError } = await getSupabaseAdmin()
    .from("blockers")
    .insert({
      project_id: projectId,
      task_id: taskId,
      title,
      description: text(formData, "description"),
      owner_id: ownerId,
      raised_by: profile.id,
    })
    .select("id")
    .single();

  if (blockerError) {
    throw new Error(blockerError.message);
  }

  if (taskId) {
    await getSupabaseAdmin().from("tasks").update({ status: "blocked" }).eq("id", taskId).eq("project_id", projectId);
  }

  await notify({
    profileId: ownerId,
    actorId: profile.id,
    type: "blocker_status_changed",
    title: "New blocker raised",
    body: title,
    href: `/projects/${projectId}/blockers`,
    taskId: taskId ?? null,
    blockerId: blocker.id,
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

  await requireProjectAccess(profile, projectId);

  const { data: blocker } = await getSupabaseAdmin()
    .from("blockers")
    .select("title, task:tasks!blockers_task_id_fkey(id, assignee_id)")
    .eq("id", blockerId)
    .eq("project_id", projectId)
    .maybeSingle();

  await getSupabaseAdmin()
    .from("blockers")
    .update({
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    })
    .eq("id", blockerId)
    .eq("project_id", projectId);

  const task = Array.isArray(blocker?.task) ? blocker?.task[0] : blocker?.task;

  if (status === "resolved") {
    await notify({
      profileId: task?.assignee_id,
      actorId: profile.id,
      type: "blocker_status_changed",
      title: "Blocker resolved",
      body: blocker?.title ?? "A blocker was resolved. Confirm before moving the task.",
      href: `/projects/${projectId}/board`,
      taskId: task?.id ?? null,
      blockerId,
    });
  }

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/blockers`);
  revalidatePath("/manager");
}

export async function createProjectUserFlag(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const emailValue = text(formData, "email")?.toLowerCase();
  const aliasEmailValue = text(formData, "aliasEmail")?.toLowerCase();
  const reason = text(formData, "reason");

  if ((!emailValue && !aliasEmailValue) || !reason) {
    return;
  }

  const email = emailValue ? z.string().email().parse(emailValue) : null;
  const aliasEmail = aliasEmailValue ? z.string().email().parse(aliasEmailValue) : null;
  const taskLinkValue = text(formData, "taskLink") ?? null;
  const taskLink = taskLinkValue ? httpUrlSchema.parse(taskLinkValue) : null;
  const screenshotFiles = suggestionScreenshotFiles(formData);

  await requireProjectAccess(profile, projectId);

  const flagId = crypto.randomUUID();
  const screenshotUrls = await uploadFlagScreenshots({
    projectId,
    flagId,
    files: screenshotFiles,
  });

  const { error } = await getSupabaseAdmin().from("project_user_flags").insert({
    id: flagId,
    project_id: projectId,
    flagged_by: profile.id,
    email,
    discord_id: text(formData, "discordId"),
    alias_email: aliasEmail,
    reason,
    task_link: taskLink,
    screenshot_urls: screenshotUrls,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/flags`);
}

// Forward-only stage progression for flagged users. Coordinators (members) can
// move a flag through warning and the removal request; only managers can mark a
// user as removed.
const FLAG_STAGE_TRANSITIONS: Record<FlagStage, { next: FlagStage; managerOnly: boolean } | null> = {
  flagged: { next: "warned", managerOnly: false },
  warned: { next: "remove_requested", managerOnly: false },
  remove_requested: { next: "removed", managerOnly: true },
  removed: null,
};

export async function updateProjectUserFlagStage(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const flagId = z.string().uuid().parse(text(formData, "flagId"));
  const stage = z.enum(FLAG_STAGES).parse(text(formData, "stage")) as FlagStage;
  const note = text(formData, "note") ?? null;

  await requireProjectAccess(profile, projectId);

  // Hard guarantee, independent of the transition map below: only a manager can
  // ever move a flagged user into the removed stage.
  if (stage === "removed" && profile.role !== "manager") {
    throw new Error("Only a manager can mark a flagged user as removed.");
  }

  const supabase = getSupabaseAdmin();
  const { data: flag, error: flagError } = await supabase
    .from("project_user_flags")
    .select("id, stage, email, alias_email")
    .eq("id", flagId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (flagError) {
    throw new Error(flagError.message);
  }

  if (!flag) {
    return;
  }

  const currentStage = (flag.stage ?? "flagged") as FlagStage;
  const transition = FLAG_STAGE_TRANSITIONS[currentStage];

  if (!transition || transition.next !== stage) {
    throw new Error(`Cannot move flag from ${currentStage} to ${stage}.`);
  }

  if (transition.managerOnly && profile.role !== "manager") {
    throw new Error("Only a manager can mark a flagged user as removed.");
  }

  const { error: updateError } = await supabase
    .from("project_user_flags")
    .update({
      stage,
      stage_updated_at: new Date().toISOString(),
      stage_updated_by: profile.id,
    })
    .eq("id", flagId)
    .eq("project_id", projectId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const { error: eventError } = await supabase.from("project_user_flag_events").insert({
    flag_id: flagId,
    project_id: projectId,
    stage,
    note: note && note.length > 0 ? note : null,
    actor_id: profile.id,
  });

  if (eventError) {
    throw new Error(eventError.message);
  }

  if (stage === "remove_requested") {
    const flaggedUser = flag.email ?? flag.alias_email ?? "a flagged user";
    const managerIds = await managerProfileIds();

    await Promise.all(
      managerIds.map((managerId) =>
        notify({
          profileId: managerId,
          actorId: profile.id,
          type: "flag_removal_requested",
          title: "Removal requested for flagged user",
          body: `${profile.display_name} requested removal of ${flaggedUser}.`,
          href: `/projects/${projectId}/flags`,
        }),
      ),
    );
  }

  revalidatePath(`/projects/${projectId}/flags`);
  revalidatePath("/manager");
}

export async function createSuggestion(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const title = text(formData, "title");
  const description = text(formData, "description");
  const category = suggestionCategorySchema.parse(text(formData, "category") ?? "project");
  const screenshotFiles = suggestionScreenshotFiles(formData);

  if (!title) {
    return;
  }

  await requireProjectAccess(profile, projectId);
  const suggestionId = crypto.randomUUID();
  const imageMarkdown = await uploadSuggestionScreenshots({
    projectId,
    suggestionId,
    threadItemId: "description",
    files: screenshotFiles,
  });
  const supabase = getSupabaseAdmin();
  const suggestionValues = {
    id: suggestionId,
    project_id: projectId,
    title,
    description: appendMarkdownImages(description, imageMarkdown),
    author_id: profile.id,
  };

  let result = await supabase.from("suggestions").insert({
    ...suggestionValues,
    category,
  });

  if (isMissingColumn(result.error, "category")) {
    result = await supabase.from("suggestions").insert(suggestionValues);
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  revalidatePath(`/projects/${projectId}/suggestions`);
}

export async function voteSuggestion(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const suggestionId = z.string().uuid().parse(text(formData, "suggestionId"));

  await requireProjectAccess(profile, projectId);
  const supabase = getSupabaseAdmin();
  const { data: suggestion, error: suggestionError } = await supabase
    .from("suggestions")
    .select("id")
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (suggestionError) {
    throw new Error(suggestionError.message);
  }

  if (!suggestion) {
    return;
  }

  // Toggle the viewer's vote: remove it if they already voted, otherwise add it.
  const { data: existingVote, error: existingVoteError } = await supabase
    .from("suggestion_votes")
    .select("suggestion_id")
    .eq("suggestion_id", suggestionId)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (existingVoteError) {
    throw new Error(existingVoteError.message);
  }

  let voteAdded = false;

  if (existingVote) {
    const { error: deleteError } = await supabase
      .from("suggestion_votes")
      .delete()
      .eq("suggestion_id", suggestionId)
      .eq("profile_id", profile.id);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  } else {
    const { error: insertError } = await supabase
      .from("suggestion_votes")
      .insert({ suggestion_id: suggestionId, profile_id: profile.id });

    if (insertError) {
      throw new Error(insertError.message);
    }

    voteAdded = true;
  }

  const { count } = await supabase
    .from("suggestion_votes")
    .select("suggestion_id", { count: "exact", head: true })
    .eq("suggestion_id", suggestionId);

  // Notify the manager only when a newly added vote crosses the threshold, so
  // they are alerted once instead of on every subsequent vote.
  const threshold = Number(process.env.SUGGESTION_TRACTION_THRESHOLD ?? "3");
  if (voteAdded && (count ?? 0) === threshold) {
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
  const screenshotFiles = suggestionScreenshotFiles(formData);

  if (!body && screenshotFiles.length === 0) {
    return;
  }

  await requireProjectAccess(profile, projectId);
  const supabase = getSupabaseAdmin();
  const { data: suggestion, error: suggestionError } = await supabase
    .from("suggestions")
    .select("id")
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (suggestionError) {
    throw new Error(suggestionError.message);
  }

  if (!suggestion) {
    return;
  }

  const commentId = crypto.randomUUID();
  const imageMarkdown = await uploadSuggestionScreenshots({
    projectId,
    suggestionId,
    threadItemId: commentId,
    files: screenshotFiles,
  });

  await supabase.from("suggestion_comments").insert({
    id: commentId,
    suggestion_id: suggestionId,
    author_id: profile.id,
    body: appendMarkdownImages(body, imageMarkdown),
  });

  await supabase.from("suggestions").update({ updated_at: new Date().toISOString() }).eq("id", suggestionId);
  revalidatePath(`/projects/${projectId}/suggestions`);
}

export async function updateSuggestionStatus(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const suggestionId = z.string().uuid().parse(text(formData, "suggestionId"));
  const status = z
    .enum(["open", "under_consideration", "accepted", "parked"])
    .parse(text(formData, "status")) as SuggestionStatus;

  await requireProjectAccess(profile, projectId);

  await getSupabaseAdmin().from("suggestions").update({ status }).eq("id", suggestionId).eq("project_id", projectId);

  revalidatePath(`/projects/${projectId}/suggestions`);
  revalidatePath("/manager");
}

export async function promoteSuggestionToTask(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const suggestionId = z.string().uuid().parse(text(formData, "suggestionId"));
  const assigneeId = text(formData, "assigneeId");

  await requireProjectAccess(profile, projectId);

  const { data: suggestion, error } = await getSupabaseAdmin()
    .from("suggestions")
    .select("title, description")
    .eq("id", suggestionId)
    .eq("project_id", projectId)
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
    .eq("id", suggestionId)
    .eq("project_id", projectId);

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

export async function markNotificationRead(notificationId: string) {
  const profile = await ensureCurrentProfile();
  const id = z.string().uuid().parse(notificationId);

  await getSupabaseAdmin()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("profile_id", profile.id);

  // The notifications panel lives in the shared (app) layout, so revalidate the
  // whole layout subtree rather than a single page.
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const profile = await ensureCurrentProfile();

  await getSupabaseAdmin()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .is("read_at", null);

  revalidatePath("/", "layout");
}

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdmin>;

// Records the outcome of a recurring occurrence in the history log. The single
// live ticket only ever reflects the most recent occurrence, so its completion
// state is mirrored here per occurrence date.
async function syncRecurringOccurrence(
  supabase: SupabaseAdminClient,
  input: { ruleId: string; projectId: string; occurrenceDate: string; assigneeId: string | null; done: boolean },
) {
  const { error } = await supabase.from("recurring_occurrences").upsert(
    {
      rule_id: input.ruleId,
      project_id: input.projectId,
      occurrence_date: input.occurrenceDate,
      assignee_id: input.assigneeId,
      status: input.done ? "done" : "pending",
      completed_at: input.done ? new Date().toISOString() : null,
      notified_missed_at: null,
    },
    { onConflict: "rule_id,occurrence_date" },
  );

  if (error) {
    throw new Error(error.message);
  }
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

  let createdCount = 0;

  for (const rule of rules ?? []) {
    // Log every scheduled occurrence up to today, so a cron that skipped one or
    // more days catches up the history instead of silently dropping the missed
    // occurrences. ON CONFLICT DO NOTHING keeps existing (possibly completed)
    // occurrences intact.
    const dueDates = recurringRunDatesUpTo(rule, today);

    if (dueDates.length === 0) {
      continue;
    }

    for (const dueDate of dueDates) {
      const { error: occurrenceError } = await supabase.from("recurring_occurrences").upsert(
        {
          rule_id: rule.id,
          project_id: rule.project_id,
          occurrence_date: dueDate,
          assignee_id: rule.assignee_id,
          status: "pending",
        },
        { onConflict: "rule_id,occurrence_date", ignoreDuplicates: true },
      );

      if (occurrenceError) {
        throw new Error(occurrenceError.message);
      }
    }

    const latest = dueDates[dueDates.length - 1];

    // There is at most one live ticket per rule. Create it on first run, or move
    // it back to "today" when a new cycle begins (it was completed, or it still
    // points at an older occurrence). A ticket already open for the current
    // cycle is left wherever the assignee moved it.
    const { data: existing, error: existingError } = await supabase
      .from("tasks")
      .select("id, status, generated_for_date")
      .eq("recurring_rule_id", rule.id)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    let liveTaskId = existing?.id ?? null;
    let movedToToday = false;

    if (!existing) {
      const { data: created, error: insertError } = await supabase
        .from("tasks")
        .insert({
          project_id: rule.project_id,
          recurring_rule_id: rule.id,
          title: rule.title,
          description: rule.description,
          assignee_id: rule.assignee_id,
          due_date: latest,
          generated_for_date: latest,
          status: "today",
          created_by: rule.created_by,
        })
        .select("id")
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      liveTaskId = created.id;
      movedToToday = true;
    } else if (existing.status === "done" || (existing.generated_for_date ?? "") < latest) {
      const { error: resetError } = await supabase
        .from("tasks")
        .update({
          title: rule.title,
          description: rule.description,
          assignee_id: rule.assignee_id,
          due_date: latest,
          generated_for_date: latest,
          status: "today",
          completed_at: null,
          overdue_notified_at: null,
        })
        .eq("id", existing.id);

      if (resetError) {
        throw new Error(resetError.message);
      }

      movedToToday = true;
    }

    if (movedToToday) {
      createdCount += 1;
      await notify({
        profileId: rule.assignee_id,
        actorId: rule.created_by,
        type: "recurring_task_created",
        title: "Recurring duty ready",
        body: rule.title,
        href: `/projects/${rule.project_id}/board`,
        taskId: liveTaskId,
      });
    }

    await supabase
      .from("recurring_rules")
      .update({ next_run_on: nextRunDate({ ...rule, next_run_on: latest }) })
      .eq("id", rule.id);
  }

  revalidatePath("/today");
  revalidatePath("/manager");
  return createdCount;
}

export async function notifyMissedRecurringDuties() {
  const supabase = getSupabaseAdmin();
  const today = todayISO();

  const { data: missed, error } = await supabase
    .from("recurring_occurrences")
    .select("id, rule_id, project_id, assignee_id, occurrence_date")
    .eq("status", "pending")
    .lt("occurrence_date", today)
    .is("notified_missed_at", null);

  if (error) {
    throw new Error(error.message);
  }

  if (!missed || missed.length === 0) {
    return 0;
  }

  const ruleIds = [...new Set(missed.map((occurrence) => occurrence.rule_id as string))];
  const [{ data: ruleRows }, { data: liveTaskRows }] = await Promise.all([
    supabase.from("recurring_rules").select("id, title").in("id", ruleIds),
    supabase.from("tasks").select("id, recurring_rule_id").in("recurring_rule_id", ruleIds),
  ]);

  const ruleTitles = new Map((ruleRows ?? []).map((row) => [row.id as string, row.title as string]));
  const liveTaskByRule = new Map<string, string>();
  for (const row of liveTaskRows ?? []) {
    const ruleId = row.recurring_rule_id as string | null;
    if (ruleId && !liveTaskByRule.has(ruleId)) {
      liveTaskByRule.set(ruleId, row.id as string);
    }
  }

  const managers = await managerProfileIds();

  for (const occurrence of missed) {
    const ruleId = occurrence.rule_id as string;
    const title = ruleTitles.get(ruleId) ?? "A recurring duty";
    const recipientIds = new Set<string>([...managers]);
    if (occurrence.assignee_id) {
      recipientIds.add(occurrence.assignee_id);
    }

    for (const profileId of recipientIds) {
      await notify({
        profileId,
        type: "recurring_task_missed",
        title: "Recurring duty missed",
        body: `${title} was not completed for ${occurrence.occurrence_date}.`,
        href: `/projects/${occurrence.project_id}/board`,
        taskId: liveTaskByRule.get(ruleId) ?? null,
      });
    }

    await supabase
      .from("recurring_occurrences")
      .update({ status: "missed", notified_missed_at: new Date().toISOString() })
      .eq("id", occurrence.id);
  }

  revalidatePath("/today");
  revalidatePath("/manager");
  return missed.length;
}

export async function completeRecurringDuty(formData: FormData) {
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const ruleId = z.string().uuid().parse(text(formData, "ruleId"));

  await requireProjectAccess(profile, projectId);

  const supabase = getSupabaseAdmin();
  const today = todayISO();

  const { data: rule, error: ruleError } = await supabase
    .from("recurring_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (ruleError) {
    throw new Error(ruleError.message);
  }

  if (!rule) {
    throw new Error("Recurring duty not found");
  }

  // Find the single live ticket for this rule.
  const { data: existing, error: existingError } = await supabase
    .from("tasks")
    .select("id, generated_for_date")
    .eq("recurring_rule_id", ruleId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  let targetId = existing?.id ?? null;
  let occurrenceDate = existing?.generated_for_date ?? null;

  // No live ticket yet (e.g. the daily cron has not generated it). Create it on
  // demand for the current interval so the assignee can still mark it complete.
  if (!targetId) {
    const scheduledDate = rule.next_run_on as string;
    occurrenceDate = scheduledDate <= today ? scheduledDate : today;

    const { data: created, error: createError } = await supabase
      .from("tasks")
      .insert({
        project_id: projectId,
        recurring_rule_id: ruleId,
        title: rule.title,
        description: rule.description,
        assignee_id: rule.assignee_id,
        due_date: occurrenceDate,
        generated_for_date: occurrenceDate,
        status: "today",
        created_by: rule.created_by,
      })
      .select("id")
      .single();

    if (createError) {
      throw new Error(createError.message);
    }

    targetId = created.id;

    // If we consumed the scheduled occurrence, advance the rule like the cron would.
    if (scheduledDate <= today) {
      await supabase.from("recurring_rules").update({ next_run_on: nextRunDate(rule) }).eq("id", ruleId);
    }
  }

  if (!occurrenceDate) {
    occurrenceDate = today;
  }

  await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString(), overdue_notified_at: null })
    .eq("id", targetId)
    .eq("project_id", projectId);

  // Record the completion in the occurrence history log.
  await syncRecurringOccurrence(supabase, {
    ruleId,
    projectId,
    occurrenceDate,
    assigneeId: rule.assignee_id,
    done: true,
  });

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath("/today");
  revalidatePath("/manager");
}

export type ClientTicketDraft = {
  isClientFacing: boolean;
  reason: string;
  message: string | null;
};

const clientTicketDraftSchema = z.object({
  is_client_facing: z.boolean(),
  reason: z.string(),
  message: z.string().nullable(),
});

const CLIENT_TICKET_SYSTEM_PROMPT = `You are an assistant that helps a manager decide whether an internal task should be raised with an external client, and if so drafts a short, client-ready message.

You will receive the title and description of a task. Decide whether this task is something the manager needs to raise to the client (for example: a blocker caused by the client, missing assets/access the client must provide, a question only the client can answer, a defect/issue to report to the client, or an approval/decision the client owns). Internal-only work (engineering chores, internal coordination, routine updates) is NOT client-facing.

Respond with ONLY a JSON object, no markdown, matching exactly this shape:
{
  "is_client_facing": boolean,
  "reason": string,
  "message": string | null
}

Rules:
- "reason": one short sentence explaining your decision.
- If "is_client_facing" is false, set "message" to null.
- If "is_client_facing" is true, set "message" to a clean, professional, copy-paste-ready message addressed to the client. It MUST use exactly this two-section format with these literal labels, each on its own line:

Description:
<a clear, concise description of the issue/request rewritten for the client>

Relevant Link or UUID:
<any link or UUID found in the task content, or "No relevant link or UUID provided" if none>

- Do not invent links or UUIDs. Only extract ones present in the task content.
- Keep the message professional and free of internal jargon.`;

export async function draftClientTicketMessage(taskId: string): Promise<ClientTicketDraft> {
  await requireManager();

  const id = z.string().uuid().parse(taskId);

  const { data: task, error } = await getSupabaseAdmin()
    .from("tasks")
    .select("title, description")
    .eq("id", id)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const userPrompt = `Task title: ${task.title}\n\nTask description:\n${task.description ?? "(no description provided)"}`;

  const raw = await callLabelboxModel({
    system: CLIENT_TICKET_SYSTEM_PROMPT,
    user: userPrompt,
  });

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The agent returned a response that could not be parsed. Please try again.");
  }

  const result = clientTicketDraftSchema.parse(parsed);

  return {
    isClientFacing: result.is_client_facing,
    reason: result.reason,
    message: result.is_client_facing ? result.message : null,
  };
}
