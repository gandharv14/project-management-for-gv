import { differenceInCalendarDays } from "date-fns";
import type React from "react";

import { createBlocker, updateBlockerStatus } from "@/app/actions";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAppContext, listBlockers, listProjectMembers, listTasks } from "@/lib/data";

export default async function BlockersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { activeProject } = await getAppContext(projectId);

  if (!activeProject) {
    return null;
  }

  const [blockers, tasks, members] = await Promise.all([
    listBlockers(projectId),
    listTasks(projectId),
    listProjectMembers(projectId),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <RealtimeRefresh tables={["blockers", "tasks"]} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Blockers</h1>
        <p className="text-muted-foreground">{activeProject.name} blockers, sorted by age.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-3">
          {blockers.map((blocker) => (
            <Card key={blocker.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{blocker.title}</CardTitle>
                    <CardDescription>
                      {blocker.task ? `Task: ${blocker.task.title}` : "Project-level blocker"} · raised{" "}
                      {differenceInCalendarDays(new Date(), new Date(blocker.created_at))} days ago
                    </CardDescription>
                  </div>
                  <Badge variant={blocker.status === "resolved" ? "secondary" : "destructive"}>
                    {blocker.status.replace("_", " ")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {blocker.description ? <p className="text-sm text-muted-foreground">{blocker.description}</p> : null}
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">Owner</p>
                    <p>{blocker.owner?.display_name ?? "Unowned"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Raised by</p>
                    <p>{blocker.raiser?.display_name ?? "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Task status</p>
                    <p>{blocker.task?.status ?? "Project blocker"}</p>
                  </div>
                </div>
                <form action={updateBlockerStatus} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input name="projectId" type="hidden" value={projectId} />
                  <input name="blockerId" type="hidden" value={blocker.id} />
                  <Select name="status" defaultValue={blocker.status}>
                    <option value="open">Open</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="resolved">Resolved</option>
                  </Select>
                  <Button type="submit" variant="secondary">
                    Update
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
          {blockers.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">No blockers raised yet.</CardContent>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Raise blocker</CardTitle>
            <CardDescription>Block a task or call out a project-level issue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createBlocker} className="grid gap-3">
              <input name="projectId" type="hidden" value={projectId} />
              <Field label="Task">
                <Select name="taskId" defaultValue="">
                  <option value="">Project-level blocker</option>
                  {tasks
                    .filter((task) => task.status !== "done")
                    .map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Owner">
                <Select name="ownerId" defaultValue="">
                  <option value="">Default manager</option>
                  {members.map((member) => (
                    <option key={member.profile_id} value={member.profile_id}>
                      {member.profiles?.display_name ?? member.profile_id}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title">
                <Input name="title" required />
              </Field>
              <Field label="Description">
                <Textarea name="description" />
              </Field>
              <Button type="submit">Raise blocker</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
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
