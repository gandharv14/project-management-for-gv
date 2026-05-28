import Link from "next/link";
import type React from "react";
import { CalendarDays, CheckCircle2, Repeat } from "lucide-react";

import { updateTaskStatus } from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAppContext, getTodayTasks } from "@/lib/data";
import { formatDate } from "@/lib/utils";

export default async function TodayPage() {
  const { profile } = await getAppContext();
  const tasks = await getTodayTasks(profile.id);

  const recurring = tasks.filter((task) => task.recurring_rule_id);
  const oneOff = tasks.filter((task) => !task.recurring_rule_id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <RealtimeRefresh tables={["tasks", "notifications"]} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        <p className="text-muted-foreground">
          Your due, overdue, Today-column, and generated recurring task instances.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Today tasks" value={tasks.length} />
        <MetricCard label="Recurring duties" value={recurring.length} />
        <MetricCard label="Overdue or due" value={tasks.filter((task) => task.due_date).length} />
      </div>

      <TaskSection title="Recurring duties" description="Fresh instances generated for the current cycle.">
        {recurring.map((task) => (
          <TodayTask key={task.id} task={task} />
        ))}
        {recurring.length === 0 ? <EmptyState>No recurring duties today.</EmptyState> : null}
      </TaskSection>

      <TaskSection title="Tasks" description="One-off work due today or explicitly moved into Today.">
        {oneOff.map((task) => (
          <TodayTask key={task.id} task={task} />
        ))}
        {oneOff.length === 0 ? <EmptyState>No one-off tasks today.</EmptyState> : null}
      </TaskSection>
    </div>
  );
}

function TodayTask({
  task,
}: {
  task: Awaited<ReturnType<typeof getTodayTasks>>[number];
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{task.title}</h3>
            <Badge variant={task.status === "blocked" ? "destructive" : "secondary"}>
              {task.status.replace("_", " ")}
            </Badge>
            {task.recurring_rule_id ? (
              <Badge variant="outline">
                <Repeat className="mr-1 h-3 w-3" />
                recurring
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {task.projects?.name ?? "Project"} · due {formatDate(task.due_date)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/projects/${task.project_id}/board`}>Open</Link>
          </Button>
          <form action={updateTaskStatus}>
            <input name="projectId" type="hidden" value={task.project_id} />
            <input name="taskId" type="hidden" value={task.id} />
            <input name="status" type="hidden" value="done" />
            <FormSubmitButton pendingLabel="Completing...">
              <CheckCircle2 className="h-4 w-4" />
              Done
            </FormSubmitButton>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
        <CalendarDays className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{children}</div>;
}
