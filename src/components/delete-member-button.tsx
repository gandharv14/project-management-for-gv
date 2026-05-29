"use client";

import type { FormEvent } from "react";
import { Trash2 } from "lucide-react";

import { deleteProjectMember, deleteWorkspaceMember } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";

type DeleteMemberButtonProps = {
  memberName: string;
  profileId: string;
};

type DeleteProjectMemberButtonProps = DeleteMemberButtonProps & {
  compact?: boolean;
  projectId: string;
  projectName: string;
};

function confirmDelete(message: string) {
  return (event: FormEvent<HTMLFormElement>) => {
    if (!window.confirm(message)) {
      event.preventDefault();
    }
  };
}

export function DeleteWorkspaceMemberButton({ memberName, profileId }: DeleteMemberButtonProps) {
  return (
    <ActionForm
      action={deleteWorkspaceMember}
      onSubmit={confirmDelete(`Delete ${memberName} from the workspace? This removes their workspace access.`)}
    >
      <input name="profileId" type="hidden" value={profileId} />
      <FormSubmitButton
        aria-label={`Delete workspace member ${memberName}`}
        pendingLabel="Deleting..."
        size="sm"
        variant="destructive"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
        Delete
      </FormSubmitButton>
    </ActionForm>
  );
}

export function DeleteProjectMemberButton({
  compact = false,
  memberName,
  profileId,
  projectId,
  projectName,
}: DeleteProjectMemberButtonProps) {
  return (
    <ActionForm
      action={deleteProjectMember}
      onSubmit={confirmDelete(`Remove ${memberName} from ${projectName}? This removes their project access.`)}
    >
      <input name="projectId" type="hidden" value={projectId} />
      <input name="profileId" type="hidden" value={profileId} />
      <FormSubmitButton
        aria-label={`Remove project member ${memberName} from ${projectName}`}
        className={compact ? "h-6 px-2" : undefined}
        pendingLabel={compact ? undefined : "Removing..."}
        showSpinner={!compact}
        size="sm"
        variant={compact ? "ghost" : "destructive"}
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        {compact ? <span className="sr-only">Remove</span> : "Remove"}
      </FormSubmitButton>
    </ActionForm>
  );
}
