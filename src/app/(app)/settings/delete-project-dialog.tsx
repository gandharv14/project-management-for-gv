"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { deleteProject } from "@/app/actions";
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

type DeleteProjectDialogProps = {
  projectId: string;
  projectName: string;
};

export function DeleteProjectDialog({ projectId, projectName }: DeleteProjectDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [confirmName, setConfirmName] = React.useState("");
  const canDelete = confirmName === projectName;

  async function action(formData: FormData) {
    await deleteProject(formData);
    setConfirmName("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="destructive">
          <Trash2 className="h-4 w-4" />
          Delete project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {projectName}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the project and its tasks, blockers, suggestions, recurring rules, and memberships.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="grid gap-4">
          <input name="projectId" type="hidden" value={projectId} />
          <div className="grid gap-2">
            <Label htmlFor={`delete-confirm-${projectId}`}>
              Type <span className="font-medium text-foreground">{projectName}</span> to confirm
            </Label>
            <Input
              autoComplete="off"
              id={`delete-confirm-${projectId}`}
              name="confirmName"
              onChange={(event) => setConfirmName(event.target.value)}
              value={confirmName}
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <FormSubmitButton disabled={!canDelete} pendingLabel="Deleting..." variant="destructive">
              Delete project
            </FormSubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
