"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ensureCurrentProfile, nextRunDate, requireManager, requireProjectAccess, todayISO } from "@/lib/data";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SUGGESTION_CATEGORIES } from "@/lib/types";
import type {
  BlockerStatus,
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

function revalidateProjectMembership(projectId: string) {
  revalidatePath("/settings");
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}/blockers`);
  revalidatePath(`/projects/${projectId}/suggestions`);
  revalidatePath(`/projects/${projectId}/settings`);
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
  const profile = await ensureCurrentProfile();
  const projectId = z.string().uuid().parse(text(formData, "projectId"));
  const taskId = z.string().uuid().parse(text(formData, "taskId"));
  const status = z
    .enum(["backlog", "today", "in_progress", "blocked", "done"])
    .parse(text(formData, "status")) as TaskStatus;

  await requireProjectAccess(profile, projectId);

  await getSupabaseAdmin()
    .from("tasks")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .eq("project_id", projectId);

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

  await getSupabaseAdmin().from("blockers").insert({
    project_id: projectId,
    task_id: taskId,
    title,
    description: text(formData, "description"),
    owner_id: ownerId,
    raised_by: profile.id,
  });

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
    .select("title, task:tasks!blockers_task_id_fkey(assignee_id)")
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
