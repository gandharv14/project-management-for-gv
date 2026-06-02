"use client";

import * as React from "react";
import { CalendarClock, CheckCircle2, Eye, EyeOff, Repeat, ShieldAlert } from "lucide-react";

import { createBlocker, updateTaskStatus } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Task, TaskStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";

import { DeleteTaskButton } from "./delete-task-button";

type Column = { id: TaskStatus; label: string };

type BoardViewProps = {
  projectId: string;
  columns: Column[];
  tasks: Task[];
};

export function BoardView({ projectId, columns, tasks }: BoardViewProps) {
  const [showRecurring, setShowRecurring] = React.useState(true);

  const recurringCount = React.useMemo(
    () => tasks.filter((task) => task.recurring_rule_id).length,
    [tasks],
  );
  const visibleTasks = React.useMemo(
    () => (showRecurring ? tasks : tasks.filter((task) => !task.recurring_rule_id)),
    [showRecurring, tasks],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button
          aria-pressed={showRecurring}
          onClick={() => setShowRecurring((value) => !value)}
          size="sm"
          type="button"
          variant="outline"
        >
          {showRecurring ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showRecurring ? "Hide recurring duties" : "Show recurring duties"}
          {recurringCount > 0 ? (
            <Badge variant="secondary">{recurringCount}</Badge>
          ) : null}
        </Button>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-full grid-flow-col auto-cols-[minmax(18rem,1fr)] gap-4">
          {columns.map((column) => (
            <TaskColumn
              key={column.id}
              column={column}
              columns={columns}
              projectId={projectId}
              tasks={visibleTasks.filter((task) => task.status === column.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskColumn({
  column,
  columns,
  projectId,
  tasks,
}: {
  column: Column;
  columns: Column[];
  projectId: string;
  tasks: Task[];
}) {
  return (
    <section className="flex min-h-[32rem] flex-col rounded-xl border bg-card/70">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-sm font-semibold">{column.label}</h2>
        <Badge variant="secondary">{tasks.length}</Badge>
      </div>
      <div className="grid gap-3 p-4">
        {tasks.map((task) => (
          <TaskCard key={task.id} columns={columns} projectId={projectId} task={task} />
        ))}
        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No tasks</p>
        ) : null}
      </div>
    </section>
  );
}

function TaskCard({ columns, projectId, task }: { columns: Column[]; projectId: string; task: Task }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium leading-snug">{task.title}</h3>
          {task.description ? <p className="mt-1 text-sm text-muted-foreground">{task.description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {task.recurring_rule_id ? (
            <Badge variant="outline">
              <Repeat className="mr-1 h-3 w-3" />
              recurring
            </Badge>
          ) : null}
          <DeleteTaskButton projectId={projectId} taskId={task.id} taskTitle={task.title} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{task.assignee?.display_name ?? "Unassigned"}</span>
        <span className="flex items-center gap-1">
          <CalendarClock className="h-3 w-3" />
          {formatDate(task.due_date)}
        </span>
      </div>
      <ActionForm action={updateTaskStatus} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <input name="projectId" type="hidden" value={projectId} />
        <input name="taskId" type="hidden" value={task.id} />
        <Select name="status" defaultValue={task.status}>
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.label}
            </option>
          ))}
        </Select>
        <FormSubmitButton pendingLabel="Moving..." size="sm" variant="secondary">
          Move
        </FormSubmitButton>
      </ActionForm>
      {task.status === "blocked" ? (
        <ActionForm action={updateTaskStatus} className="mt-2">
          <input name="projectId" type="hidden" value={projectId} />
          <input name="taskId" type="hidden" value={task.id} />
          <input name="status" type="hidden" value="in_progress" />
          <FormSubmitButton className="w-full" pendingLabel="Confirming..." size="sm" variant="outline">
            <CheckCircle2 className="h-4 w-4" />
            Confirm unblocked
          </FormSubmitButton>
        </ActionForm>
      ) : (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Raise blocker</summary>
          <ActionForm action={createBlocker} className="mt-2 grid gap-2">
            <input name="projectId" type="hidden" value={projectId} />
            <input name="taskId" type="hidden" value={task.id} />
            <Input name="title" placeholder="What is blocking this?" required />
            <Textarea name="description" placeholder="Details" />
            <FormSubmitButton pendingLabel="Raising..." size="sm" variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              Raise
            </FormSubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
