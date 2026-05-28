"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { createTask } from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectMember, TaskStatus } from "@/lib/types";

type ColumnOption = {
  id: TaskStatus;
  label: string;
};

type CreateTaskDialogProps = {
  projectId: string;
  members: ProjectMember[];
  columns: ColumnOption[];
};

export function CreateTaskDialog({ projectId, members, columns }: CreateTaskDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function action(formData: FormData) {
    await createTask(formData);
    formRef.current?.reset();
    setOpen(false);
    router.refresh();
    window.location.reload();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Create task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create task</DialogTitle>
          <DialogDescription>Add a task to any queue. Assignments notify the assignee.</DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={action} className="grid gap-3">
          <input name="projectId" type="hidden" value={projectId} />
          <Field htmlFor="task-title" label="Title">
            <Input id="task-title" name="title" placeholder="Write launch checklist" required />
          </Field>
          <Field htmlFor="task-description" label="Description">
            <Textarea
              id="task-description"
              name="description"
              placeholder="Context, links, acceptance criteria"
              className="min-h-20"
            />
          </Field>
          <Field htmlFor="task-assignee" label="Assignee">
            <Select id="task-assignee" name="assigneeId" defaultValue="">
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.profile_id} value={member.profile_id}>
                  {member.profiles?.display_name ?? member.profile_id}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field htmlFor="task-due-date" label="Due date">
              <Input id="task-due-date" name="dueDate" type="date" />
            </Field>
            <Field htmlFor="task-status" label="Queue">
              <Select id="task-status" name="status" defaultValue="backlog">
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
            <FormSubmitButton pendingLabel="Creating...">Create task</FormSubmitButton>
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
