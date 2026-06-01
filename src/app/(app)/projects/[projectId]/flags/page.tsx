import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { ImageIcon } from "lucide-react";

import { createProjectUserFlag, updateProjectUserFlagStage } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getAppContext, getProjectUserFlagsState } from "@/lib/data";
import type { FlagStage, ProfileRole, ProjectUserFlag } from "@/lib/types";

const STAGE_META: Record<
  FlagStage,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  flagged: { label: "Flagged", variant: "destructive" },
  warned: { label: "Warned / Steered", variant: "secondary" },
  remove_requested: { label: "Remove Requested", variant: "destructive" },
  removed: { label: "Removed", variant: "outline" },
};

type StageAction = {
  nextStage: FlagStage;
  buttonLabel: string;
  pendingLabel: string;
  managerOnly: boolean;
  description: string;
};

const STAGE_ACTIONS: Record<FlagStage, StageAction | null> = {
  flagged: {
    nextStage: "warned",
    buttonLabel: "Mark Warned / Steered",
    pendingLabel: "Updating...",
    managerOnly: false,
    description: "Reach out to the user once, then record that they were warned or steered.",
  },
  warned: {
    nextStage: "remove_requested",
    buttonLabel: "Mark Remove",
    pendingLabel: "Requesting...",
    managerOnly: false,
    description: "If the user continues, request removal. Managers are notified.",
  },
  remove_requested: {
    nextStage: "removed",
    buttonLabel: "Mark Removed",
    pendingLabel: "Removing...",
    managerOnly: true,
    description: "Only a manager can confirm removal.",
  },
  removed: null,
};

export default async function FlagsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { activeProject, profile } = await getAppContext(projectId);

  if (!activeProject) {
    return null;
  }

  const { flags, setupRequired } = await getProjectUserFlagsState(projectId);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <RealtimeRefresh tables={["project_user_flags", "project_user_flag_events"]} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Flag User</h1>
        <p className="text-muted-foreground">
          Track flagged users for {activeProject.name}, including who submitted each report.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-3">
          {setupRequired ? (
            <Card>
              <CardHeader>
                <CardTitle>Flag User setup required</CardTitle>
                <CardDescription>
                  Apply the latest Supabase migration before submitting or viewing project user flags.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                The `project_user_flags` table is not available in the connected database yet.
              </CardContent>
            </Card>
          ) : null}
          {flags.map((flag) => (
            <FlagCard flag={flag} key={flag.id} projectId={projectId} viewerRole={profile.role} />
          ))}
          {flags.length === 0 && !setupRequired ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">No users have been flagged yet.</CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Flag User</CardTitle>
            <CardDescription>
              Record either an email or alias email, plus Discord ID, reason, task link, and screenshot evidence.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={createProjectUserFlag} className="grid gap-3">
              <input name="projectId" type="hidden" value={projectId} />
              <Field label="Email">
                <Input name="email" placeholder="Required if alias email is blank" type="email" />
              </Field>
              <Field label="Discord ID">
                <Input name="discordId" placeholder="Optional" />
              </Field>
              <Field label="Alias email">
                <Input name="aliasEmail" placeholder="Required if email is blank" type="email" />
              </Field>
              <Field label="Task link">
                <Input name="taskLink" placeholder="https://..." type="url" />
              </Field>
              <Field label="Reason for flagging">
                <Textarea name="reason" required />
              </Field>
              <Field label="Attach screenshots">
                <Input accept="image/png,image/jpeg,image/webp,image/gif" multiple name="screenshots" type="file" />
              </Field>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5" />
                Up to 4 PNG, JPEG, WebP, or GIF images, 5MB each.
              </p>
              <FormSubmitButton disabled={setupRequired} pendingLabel="Flagging...">
                Flag user
              </FormSubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FlagCard({
  flag,
  projectId,
  viewerRole,
}: {
  flag: ProjectUserFlag;
  projectId: string;
  viewerRole: ProfileRole;
}) {
  const reporter = flag.reporter?.display_name ?? flag.reporter?.email ?? "Unknown member";
  const primaryIdentifier = flag.email ?? flag.alias_email ?? "Unknown flagged user";
  const stageMeta = STAGE_META[flag.stage];
  const stageAction = STAGE_ACTIONS[flag.stage];
  const canAct = stageAction ? !stageAction.managerOnly || viewerRole === "manager" : false;
  const events = flag.events ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={stageMeta.variant}>{stageMeta.label}</Badge>
              {flag.email && flag.alias_email ? <Badge variant="secondary">Alias: {flag.alias_email}</Badge> : null}
            </div>
            <CardTitle className="break-words">{primaryIdentifier}</CardTitle>
            <CardDescription>
              flagged by {reporter} · {formatDistanceToNow(new Date(flag.created_at), { addSuffix: true })}
            </CardDescription>
          </div>
          {flag.task_link ? (
            <Button asChild size="sm" variant="outline">
              <Link href={flag.task_link} rel="noreferrer" target="_blank">
                Task link
              </Link>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Email</p>
            <p className="break-words">{flag.email ?? "Not provided"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Discord ID</p>
            <p className="break-words">{flag.discord_id ?? "Not provided"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Alias email</p>
            <p className="break-words">{flag.alias_email ?? "Not provided"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Reporter</p>
            <p className="break-words">{reporter}</p>
          </div>
        </div>

        <div className="rounded-lg border bg-background/60 p-4">
          <p className="mb-2 text-sm font-medium">Reason</p>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{flag.reason}</p>
        </div>

        {flag.screenshot_urls.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Screenshots</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {flag.screenshot_urls.map((url, index) => (
                <Link
                  className="block overflow-hidden rounded-lg border bg-muted"
                  href={url}
                  key={url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <Image
                    alt={`Flag screenshot ${index + 1}`}
                    className="h-36 w-full object-cover"
                    height={144}
                    src={url}
                    width={256}
                  />
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border bg-background/60 p-4">
          <p className="mb-3 text-sm font-medium">Stage progress</p>
          {events.length > 0 ? (
            <ol className="mb-4 grid gap-3">
              {events.map((event) => (
                <li className="flex flex-col gap-1 border-l-2 pl-3 text-sm" key={event.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STAGE_META[event.stage].variant}>{STAGE_META[event.stage].label}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {event.actor?.display_name ?? event.actor?.email ?? "Unknown member"} ·{" "}
                      {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {event.note ? <p className="whitespace-pre-wrap text-muted-foreground">{event.note}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mb-4 text-sm text-muted-foreground">No stage updates yet.</p>
          )}

          {stageAction && canAct ? (
            <ActionForm action={updateProjectUserFlagStage} className="grid gap-2">
              <input name="projectId" type="hidden" value={projectId} />
              <input name="flagId" type="hidden" value={flag.id} />
              <input name="stage" type="hidden" value={stageAction.nextStage} />
              <p className="text-xs text-muted-foreground">{stageAction.description}</p>
              <Textarea name="note" placeholder="Add an optional note about this update" rows={2} />
              <FormSubmitButton pendingLabel={stageAction.pendingLabel}>{stageAction.buttonLabel}</FormSubmitButton>
            </ActionForm>
          ) : stageAction && !canAct ? (
            <p className="text-sm text-muted-foreground">{stageAction.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">This user has been removed. No further action is needed.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
