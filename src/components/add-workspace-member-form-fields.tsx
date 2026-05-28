import { FormSubmitButton } from "@/components/form-submit-button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Profile, ProjectMember } from "@/lib/types";

type AddWorkspaceMemberFormFieldsProps = {
  members: ProjectMember[];
  projectId: string;
  selectId: string;
  workspaceMembers: Profile[];
};

export function AddWorkspaceMemberFormFields({
  members,
  projectId,
  selectId,
  workspaceMembers,
}: AddWorkspaceMemberFormFieldsProps) {
  const projectMemberIds = new Set(members.map((member) => member.profile_id));
  const hasWorkspaceMembers = workspaceMembers.length > 0;

  return (
    <>
      <input name="projectId" type="hidden" value={projectId} />
      <div className="grid gap-2">
        <Label htmlFor={selectId}>Add workspace member</Label>
        <Select id={selectId} name="profileId" defaultValue="" required disabled={!hasWorkspaceMembers}>
          <option value="" disabled>
            {hasWorkspaceMembers ? "Select a workspace member" : "No workspace members available"}
          </option>
          {workspaceMembers.map((member) => {
            const alreadyAdded = projectMemberIds.has(member.id);

            return (
              <option key={member.id} value={member.id}>
                {member.display_name} · {member.email}
                {alreadyAdded ? " (already added)" : ""}
              </option>
            );
          })}
        </Select>
      </div>
      <div className="flex items-end">
        <FormSubmitButton disabled={!hasWorkspaceMembers} pendingLabel="Adding..." variant="secondary">
          Add to project
        </FormSubmitButton>
      </div>
    </>
  );
}
