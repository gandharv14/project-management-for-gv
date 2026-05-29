"use client";

import type { FormEvent } from "react";
import { Trash2 } from "lucide-react";

import { deleteTask } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";

type DeleteTaskButtonProps = {
  projectId: string;
  taskId: string;
  taskTitle: string;
};

export function DeleteTaskButton({ projectId, taskId, taskTitle }: DeleteTaskButtonProps) {
  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm(`Delete "${taskTitle}"? This cannot be undone.`)) {
      event.preventDefault();
    }
  }

  return (
    <ActionForm action={deleteTask} onSubmit={confirmDelete}>
      <input name="projectId" type="hidden" value={projectId} />
      <input name="taskId" type="hidden" value={taskId} />
      <FormSubmitButton
        aria-label={`Delete ${taskTitle}`}
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        size="icon"
        variant="ghost"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </FormSubmitButton>
    </ActionForm>
  );
}
