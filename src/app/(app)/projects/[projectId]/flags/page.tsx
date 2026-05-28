import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { ImageIcon } from "lucide-react";

import { createProjectUserFlag } from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getAppContext, listProjectUserFlags } from "@/lib/data";
import type { ProjectUserFlag } from "@/lib/types";

export default async function FlagsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { activeProject } = await getAppContext(projectId);

  if (!activeProject) {
    return null;
  }

  const flags = await listProjectUserFlags(projectId);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <RealtimeRefresh tables={["project_user_flags"]} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">User flags</h1>
        <p className="text-muted-foreground">
          Track flagged users for {activeProject.name}, including who submitted each report.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-3">
          {flags.map((flag) => (
            <FlagCard flag={flag} key={flag.id} />
          ))}
          {flags.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">No users have been flagged yet.</CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Flag user</CardTitle>
            <CardDescription>Record an email, Discord ID, reason, task link, and screenshot evidence.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createProjectUserFlag} className="grid gap-3">
              <input name="projectId" type="hidden" value={projectId} />
              <Field label="Email">
                <Input name="email" required type="email" />
              </Field>
              <Field label="Discord ID">
                <Input name="discordId" placeholder="Optional" />
              </Field>
              <Field label="Alias email">
                <Input name="aliasEmail" placeholder="Optional" type="email" />
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
              <FormSubmitButton pendingLabel="Flagging...">Flag user</FormSubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FlagCard({ flag }: { flag: ProjectUserFlag }) {
  const reporter = flag.reporter?.display_name ?? flag.reporter?.email ?? "Unknown member";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="destructive">Flagged</Badge>
              {flag.alias_email ? <Badge variant="secondary">Alias: {flag.alias_email}</Badge> : null}
            </div>
            <CardTitle className="break-words">{flag.email}</CardTitle>
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
        <div className="grid gap-2 text-sm sm:grid-cols-3">
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
