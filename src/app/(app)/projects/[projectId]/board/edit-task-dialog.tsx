"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { updateTask } from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectMember, Task, TaskStatus } from "@/lib/types";

type ColumnOption = {
  id: TaskStatus;
  label: string;
};

type EditTaskDialogProps = {
  projectId: string;
  task: Task;
  members: ProjectMember[];
  columns: ColumnOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditTaskDialog({
  projectId,
  task,
  members,
  columns,
  open,
  onOpenChange,
}: EditTaskDialogProps) {
  const router = useRouter();

  async function action(formData: FormData) {
    await updateTask(formData);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Update details. Reassigning notifies the new assignee.</DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-3">
          <input name="projectId" type="hidden" value={projectId} />
          <input name="taskId" type="hidden" value={task.id} />
          <Field htmlFor="edit-task-title" label="Title">
            <Input defaultValue={task.title} id="edit-task-title" name="title" required />
          </Field>
          <Field htmlFor="edit-task-description" label="Description">
            <Textarea
              className="min-h-20"
              defaultValue={task.description ?? ""}
              id="edit-task-description"
              name="description"
              placeholder="Context, links, acceptance criteria"
            />
          </Field>
          <Field htmlFor="edit-task-assignee" label="Assignee">
            <Select defaultValue={task.assignee_id ?? ""} id="edit-task-assignee" name="assigneeId">
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.profile_id} value={member.profile_id}>
                  {member.profiles?.display_name ?? member.profile_id}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field htmlFor="edit-task-due-date" label="Due date">
              <Input
                defaultValue={task.due_date ?? ""}
                id="edit-task-due-date"
                name="dueDate"
                type="date"
              />
            </Field>
            <Field htmlFor="edit-task-status" label="Queue">
              <Select defaultValue={task.status} id="edit-task-status" name="status">
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <FormSubmitButton pendingLabel="Saving...">Save changes</FormSubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
