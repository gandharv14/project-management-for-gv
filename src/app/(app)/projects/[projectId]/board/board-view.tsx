"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  ImageIcon,
  LinkIcon,
  Maximize2,
  Pencil,
  Repeat,
  UserPlus,
} from "lucide-react";

import { updateTaskStatus } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import { MarkdownBody } from "@/components/markdown-body";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ProfileRole, ProjectMember, Task, TaskStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";

import { ClientTicketAgent } from "./client-ticket-agent";
import { DeleteTaskButton } from "./delete-task-button";
import { EditTaskDialog } from "./edit-task-dialog";

type Column = { id: TaskStatus; label: string };

const UNASSIGNED_FILTER = "__unassigned__";

function referenceLinkLabel(url: string, index: number) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || `Link ${index + 1}`;
  } catch {
    return `Link ${index + 1}`;
  }
}

type BoardViewProps = {
  projectId: string;
  columns: Column[];
  tasks: Task[];
  members: ProjectMember[];
  viewerRole: ProfileRole;
};

export function BoardView({ projectId, columns, tasks, members, viewerRole }: BoardViewProps) {
  const [showRecurring, setShowRecurring] = React.useState(true);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string>("all");

  const recurringCount = React.useMemo(
    () => tasks.filter((task) => task.recurring_rule_id).length,
    [tasks],
  );
  const visibleTasks = React.useMemo(() => {
    let next = showRecurring ? tasks : tasks.filter((task) => !task.recurring_rule_id);

    if (assigneeFilter === UNASSIGNED_FILTER) {
      next = next.filter((task) => !task.assignee_id);
    } else if (assigneeFilter !== "all") {
      next = next.filter((task) => task.assignee_id === assigneeFilter);
    }

    return next;
  }, [assigneeFilter, showRecurring, tasks]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid w-full max-w-xs gap-2 sm:w-auto">
          <Label htmlFor="board-assignee-filter">Filter by assignee</Label>
          <Select
            id="board-assignee-filter"
            onChange={(event) => setAssigneeFilter(event.target.value)}
            value={assigneeFilter}
          >
            <option value="all">All assignees</option>
            <option value={UNASSIGNED_FILTER}>Unassigned</option>
            {members.map((member) => (
              <option key={member.profile_id} value={member.profile_id}>
                {member.profiles?.display_name ?? member.profile_id}
              </option>
            ))}
          </Select>
        </div>
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
              members={members}
              projectId={projectId}
              tasks={visibleTasks.filter((task) => task.status === column.id)}
              viewerRole={viewerRole}
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
  members,
  projectId,
  tasks,
  viewerRole,
}: {
  column: Column;
  columns: Column[];
  members: ProjectMember[];
  projectId: string;
  tasks: Task[];
  viewerRole: ProfileRole;
}) {
  return (
    <section className="flex min-h-[32rem] flex-col rounded-xl border bg-card/70">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-sm font-semibold">{column.label}</h2>
        <Badge variant="secondary">{tasks.length}</Badge>
      </div>
      <div className="grid gap-3 p-4">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            columns={columns}
            members={members}
            projectId={projectId}
            task={task}
            viewerRole={viewerRole}
          />
        ))}
        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No tasks</p>
        ) : null}
      </div>
    </section>
  );
}

function TaskCard({
  columns,
  members,
  projectId,
  task,
  viewerRole,
}: {
  columns: Column[];
  members: ProjectMember[];
  projectId: string;
  task: Task;
  viewerRole: ProfileRole;
}) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const imageUrls = task.image_urls ?? [];
  const referenceLinks = task.reference_links ?? [];

  return (
    <div className="min-w-0 rounded-lg border bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            className="block w-full text-left font-medium leading-snug outline-none hover:text-primary focus-visible:text-primary"
            onClick={() => setDetailOpen(true)}
            type="button"
          >
            {task.title}
          </button>
          {task.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {task.recurring_rule_id ? (
            <Badge variant="outline">
              <Repeat className="mr-1 h-3 w-3" />
              recurring
            </Badge>
          ) : null}
          {referenceLinks.length > 0 ? (
            <Badge aria-label={`${referenceLinks.length} associated links`} variant="secondary">
              <LinkIcon className="mr-1 h-3 w-3" />
              {referenceLinks.length}
            </Badge>
          ) : null}
          {imageUrls.length > 0 ? (
            <Badge aria-label={`${imageUrls.length} attached images`} variant="secondary">
              <ImageIcon className="mr-1 h-3 w-3" />
              {imageUrls.length}
            </Badge>
          ) : null}
          <Button
            aria-label={`Edit ${task.title}`}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setEditOpen(true)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Button
            aria-label={`Expand ${task.title}`}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setDetailOpen(true)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Maximize2 aria-hidden="true" className="h-4 w-4" />
          </Button>
          <DeleteTaskButton projectId={projectId} taskId={task.id} taskTitle={task.title} />
        </div>
      </div>
      <TaskDetailDialog
        columns={columns}
        onEdit={() => {
          setDetailOpen(false);
          setEditOpen(true);
        }}
        onOpenChange={setDetailOpen}
        open={detailOpen}
        task={task}
        viewerRole={viewerRole}
      />
      <EditTaskDialog
        columns={columns}
        members={members}
        onOpenChange={setEditOpen}
        open={editOpen}
        projectId={projectId}
        task={task}
      />
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{task.assignee?.display_name ?? "Unassigned"}</span>
        <span className="flex items-center gap-1">
          <CalendarClock className="h-3 w-3" />
          {formatDate(task.due_date)}
        </span>
        <span className="flex items-center gap-1">
          <UserPlus className="h-3 w-3" />
          {task.creator?.display_name ?? "Unknown"}
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
      ) : null}
    </div>
  );
}

function TaskDetailDialog({
  columns,
  onEdit,
  onOpenChange,
  open,
  task,
  viewerRole,
}: {
  columns: Column[];
  onEdit: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  task: Task;
  viewerRole: ProfileRole;
}) {
  const statusLabel = columns.find((column) => column.id === task.status)?.label ?? task.status;
  const imageUrls = task.image_urls ?? [];
  const referenceLinks = task.reference_links ?? [];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-6">{task.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{statusLabel}</Badge>
            {task.recurring_rule_id ? (
              <Badge variant="outline">
                <Repeat className="mr-1 h-3 w-3" />
                recurring
              </Badge>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button onClick={onEdit} size="sm" type="button" variant="outline">
            <Pencil className="h-4 w-4" />
            Edit task
          </Button>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assignee</dt>
            <dd>{task.assignee?.display_name ?? "Unassigned"}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Due date</dt>
            <dd className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              {formatDate(task.due_date)}
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Created by</dt>
            <dd className="flex items-center gap-1">
              <UserPlus className="h-3 w-3" />
              {task.creator?.display_name ?? "Unknown"}
            </dd>
          </div>
        </dl>

        <div className="grid gap-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</h4>
          {task.description ? (
            <MarkdownBody content={task.description} />
          ) : (
            <p className="text-sm text-muted-foreground">No description provided.</p>
          )}
        </div>

        {referenceLinks.length > 0 ? (
          <div className="grid gap-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Associated links</h4>
            <div className="flex flex-wrap gap-2">
              {referenceLinks.map((url, index) => (
                <Button asChild key={`${url}-${index}`} size="sm" variant="outline">
                  <Link href={url} rel="noreferrer" target="_blank">
                    <ExternalLink className="h-4 w-4" />
                    {referenceLinkLabel(url, index)}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {imageUrls.length > 0 ? (
          <div className="grid gap-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Images / screenshots</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {imageUrls.map((url, index) => (
                <Link
                  className="block overflow-hidden rounded-lg border bg-muted"
                  href={url}
                  key={`${url}-${index}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <Image
                    alt={`Task screenshot ${index + 1}`}
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

        {viewerRole === "manager" ? <ClientTicketAgent task={task} /> : null}
      </DialogContent>
    </Dialog>
  );
}
