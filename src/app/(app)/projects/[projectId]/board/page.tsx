import { Repeat } from "lucide-react";
import type React from "react";

import { createRecurringRule } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getAppContext, listProjectMembers, listRecurringRulesWithHistory, listTasks } from "@/lib/data";
import type { TaskStatus } from "@/lib/types";
import { pluralize } from "@/lib/utils";

import { BoardView } from "./board-view";
import { CreateTaskDialog } from "./create-task-dialog";
import { RecurringDutyCard } from "./recurring-duty-card";

const columns: Array<{ id: TaskStatus; label: string }> = [
  { id: "backlog", label: "Backlog" },
  { id: "today", label: "Today" },
  { id: "in_progress", label: "In Progress" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

export default async function BoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { activeProject, profile } = await getAppContext(projectId);

  if (!activeProject) {
    return <EmptyProjectState />;
  }

  const [tasks, members, recurringRules] = await Promise.all([
    listTasks(projectId),
    listProjectMembers(projectId),
    listRecurringRulesWithHistory(projectId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresh tables={["tasks"]} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{activeProject.name}</h1>
            <Badge variant="secondary">{pluralize(tasks.length, "task")}</Badge>
          </div>
          <p className="text-muted-foreground">{activeProject.description ?? "Project task board"}</p>
        </div>
        <CreateTaskDialog columns={columns} members={members} projectId={projectId} />
      </div>

      <BoardView columns={columns} members={members} projectId={projectId} tasks={tasks} viewerRole={profile.role} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4" />
            Recurring duty
          </CardTitle>
          <CardDescription>Creates a fresh task instance every cycle.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ActionForm action={createRecurringRule} className="grid gap-3">
            <input name="projectId" type="hidden" value={projectId} />
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Title">
                <Input name="title" placeholder="Daily triage" required />
              </Field>
              <Field label="Assignee">
                <Select name="assigneeId" defaultValue="">
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.profile_id} value={member.profile_id}>
                      {member.profiles?.display_name ?? member.profile_id}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Frequency">
                <Select name="frequency" defaultValue="daily">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="custom">Custom</option>
                </Select>
              </Field>
              <Field label="Interval days">
                <Input min="1" name="intervalDays" type="number" defaultValue="1" />
              </Field>
              <Field label="Next run">
                <Input name="nextRunOn" type="date" />
              </Field>
              <Field label="Weekly days">
                <Input name="weekdays" placeholder="1,3,5 for Mon/Wed/Fri" />
              </Field>
            </div>
            <div>
              <FormSubmitButton pendingLabel="Adding..." variant="secondary">
                Add recurrence
              </FormSubmitButton>
            </div>
          </ActionForm>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {recurringRules.map((rule) => (
              <RecurringDutyCard key={rule.id} projectId={projectId} rule={rule} />
            ))}
            {recurringRules.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                No recurring duties yet.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
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

function EmptyProjectState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No project found</CardTitle>
        <CardDescription>Create a project in Settings before using the board.</CardDescription>
      </CardHeader>
    </Card>
  );
}
