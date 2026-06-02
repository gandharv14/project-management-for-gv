"use client";

import type { FormEvent } from "react";
import { Trash2 } from "lucide-react";

import { deleteProjectDocument } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";

type DeleteProjectDocumentButtonProps = {
  documentId: string;
  documentTitle: string;
  projectId: string;
};

export function DeleteProjectDocumentButton({
  documentId,
  documentTitle,
  projectId,
}: DeleteProjectDocumentButtonProps) {
  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm(`Delete "${documentTitle}"? This only removes the saved link.`)) {
      event.preventDefault();
    }
  }

  return (
    <ActionForm action={deleteProjectDocument} onSubmit={confirmDelete}>
      <input name="projectId" type="hidden" value={projectId} />
      <input name="documentId" type="hidden" value={documentId} />
      <FormSubmitButton
        aria-label={`Delete ${documentTitle}`}
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        size="icon"
        variant="ghost"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </FormSubmitButton>
    </ActionForm>
  );
}
