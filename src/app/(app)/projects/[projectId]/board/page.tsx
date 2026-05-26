import { CalendarClock, CheckCircle2, Repeat, ShieldAlert } from "lucide-react";
import type React from "react";

import { createBlocker, createRecurringRule, createTask, updateTaskStatus } from "@/app/actions";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAppContext, listProjectMembers, listRecurringRules, listTasks } from "@/lib/data";
import type { Task, TaskStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const columns: Array<{ id: TaskStatus; label: string }> = [
  { id: "backlog", label: "Backlog" },
  { id: "today", label: "Today" },
  { id: "in_progress", label: "In Progress" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

export default async function BoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { activeProject } = await getAppContext(projectId);

  if (!activeProject) {
    return <EmptyProjectState />;
  }

  const [tasks, members, recurringRules] = await Promise.all([
    listTasks(projectId),
    listProjectMembers(projectId),
    listRecurringRules(projectId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresh tables={["tasks", "blockers"]} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{activeProject.name}</h1>
        <p className="text-muted-foreground">{activeProject.description ?? "Project task board"}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="grid gap-4 xl:grid-cols-5">
          {columns.map((column) => {
            const columnTasks = tasks.filter((task) => task.status === column.id);
            return (
              <Card key={column.id} className="min-h-96">
                <CardHeader className="p-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{column.label}</CardTitle>
                    <Badge variant="secondary">{columnTasks.length}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 p-4 pt-0">
                  {columnTasks.map((task) => (
                    <TaskCard key={task.id} projectId={projectId} task={task} />
                  ))}
                  {columnTasks.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No tasks</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Create task</CardTitle>
              <CardDescription>Assignments notify the assignee.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createTask} className="grid gap-3">
                <input name="projectId" type="hidden" value={projectId} />
                <Field label="Title">
                  <Input name="title" placeholder="Write launch checklist" required />
                </Field>
                <Field label="Description">
                  <Textarea name="description" placeholder="Context, links, acceptance criteria" />
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Due date">
                    <Input name="dueDate" type="date" />
                  </Field>
                  <Field label="Column">
                    <Select name="status" defaultValue="backlog">
                      {columns.map((column) => (
                        <option key={column.id} value={column.id}>
                          {column.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Button type="submit">Create task</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Repeat className="h-4 w-4" />
                Recurring duty
              </CardTitle>
              <CardDescription>Creates a fresh task instance every cycle.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form action={createRecurringRule} className="grid gap-3">
                <input name="projectId" type="hidden" value={projectId} />
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
                <div className="grid gap-3 sm:grid-cols-3">
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
                </div>
                <Field label="Weekly days">
                  <Input name="weekdays" placeholder="1,3,5 for Mon/Wed/Fri" />
                </Field>
                <Button type="submit" variant="secondary">
                  Add recurrence
                </Button>
              </form>
              <div className="grid gap-2">
                {recurringRules.map((rule) => (
                  <div key={rule.id} className="rounded-lg border p-3 text-sm">
                    <div className="font-medium">{rule.title}</div>
                    <div className="text-muted-foreground">
                      {rule.frequency} · next run {formatDate(rule.next_run_on)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TaskCard({ projectId, task }: { projectId: string; task: Task }) {
  return (
    <div className="rounded-lg border bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium leading-snug">{task.title}</h3>
          {task.description ? <p className="mt-1 text-sm text-muted-foreground">{task.description}</p> : null}
        </div>
        {task.recurring_rule_id ? (
          <Badge variant="outline">
            <Repeat className="mr-1 h-3 w-3" />
            recurring
          </Badge>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{task.assignee?.display_name ?? "Unassigned"}</span>
        <span className="flex items-center gap-1">
          <CalendarClock className="h-3 w-3" />
          {formatDate(task.due_date)}
        </span>
      </div>
      <form action={updateTaskStatus} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <input name="projectId" type="hidden" value={projectId} />
        <input name="taskId" type="hidden" value={task.id} />
        <Select name="status" defaultValue={task.status}>
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.label}
            </option>
          ))}
        </Select>
        <Button size="sm" type="submit" variant="secondary">
          Move
        </Button>
      </form>
      {task.status === "blocked" ? (
        <form action={updateTaskStatus} className="mt-2">
          <input name="projectId" type="hidden" value={projectId} />
          <input name="taskId" type="hidden" value={task.id} />
          <input name="status" type="hidden" value="in_progress" />
          <Button className="w-full" size="sm" type="submit" variant="outline">
            <CheckCircle2 className="h-4 w-4" />
            Confirm unblocked
          </Button>
        </form>
      ) : (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Raise blocker</summary>
          <form action={createBlocker} className="mt-2 grid gap-2">
            <input name="projectId" type="hidden" value={projectId} />
            <input name="taskId" type="hidden" value={task.id} />
            <Input name="title" placeholder="What is blocking this?" required />
            <Textarea name="description" placeholder="Details" />
            <Button size="sm" type="submit" variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              Raise
            </Button>
          </form>
        </details>
      )}
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
