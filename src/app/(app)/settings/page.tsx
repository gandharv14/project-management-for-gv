import { addProjectMember, addTeamMember, createProject } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { AddWorkspaceMemberFormFields } from "@/components/add-workspace-member-form-fields";
import { DeleteProjectMemberButton, DeleteWorkspaceMemberButton } from "@/components/delete-member-button";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAppContext, listProjectMembers, listWorkspaceProfiles } from "@/lib/data";
import { DeleteProjectDialog } from "./delete-project-dialog";

export default async function SettingsPage() {
  const { profile, projects } = await getAppContext();
  const [workspaceMembers, projectMembers] = await Promise.all([
    listWorkspaceProfiles(),
    Promise.all(
      projects.map(async (project) => ({
        project,
        members: await listProjectMembers(project.id),
      })),
    ),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage the single-team workspace, projects, and project memberships.
        </p>
      </div>

      {profile.role === "manager" ? (
        <Card>
          <CardHeader>
            <CardTitle>Create project</CardTitle>
            <CardDescription>Projects tie together tasks and suggestions.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createProject} className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
              <div className="grid gap-2">
                <Label htmlFor="name">Project name</Label>
                <Input id="name" name="name" placeholder="Launch plan" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" placeholder="What this project covers" />
              </div>
              <div className="flex items-end">
                <FormSubmitButton pendingLabel="Creating...">Create</FormSubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Workspace members</CardTitle>
          <CardDescription>
            Workspace members are automatically part of every project. If they sign in with Labelbox SSO, the app
            links them to the same profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {profile.role === "manager" ? (
            <ActionForm action={addTeamMember} className="grid gap-3 lg:grid-cols-[1fr_1fr_12rem_auto]">
              <div className="grid gap-2">
                <Label htmlFor="team-display-name">Name</Label>
                <Input id="team-display-name" name="displayName" placeholder="Ada Lovelace" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="team-email">Email</Label>
                <Input id="team-email" name="email" type="email" placeholder="teammate@labelbox.com" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="team-role">Role</Label>
                <Select id="team-role" name="role" defaultValue="member">
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                </Select>
              </div>
              <div className="flex items-end">
                <FormSubmitButton pendingLabel="Adding..." variant="secondary">
                  Add workspace member
                </FormSubmitButton>
              </div>
            </ActionForm>
          ) : null}

          <div className="grid gap-2">
            {workspaceMembers.map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
              >
                <div>
                  <p className="font-medium">{member.display_name}</p>
                  <p className="text-sm text-muted-foreground">{member.email}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {member.id === profile.id ? <Badge variant="secondary">you</Badge> : null}
                  <Badge variant="outline">workspace</Badge>
                  <Badge variant={member.role === "manager" ? "default" : "secondary"}>{member.role}</Badge>
                  {profile.role === "manager" && member.id !== profile.id ? (
                    <DeleteWorkspaceMemberButton memberName={member.display_name} profileId={member.id} />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {projectMembers.map(({ project, members }) => (
          <Card key={project.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>{project.description ?? "No description yet."}</CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant="secondary">{members.length} members</Badge>
                  {profile.role === "manager" ? (
                    <DeleteProjectDialog projectId={project.id} projectName={project.name} />
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                {members.map((member) => {
                  const membershipScope = member.profiles?.membership_scope ?? "workspace";
                  const memberName = member.profiles?.display_name ?? "Unknown";

                  return (
                    <div
                      key={member.profile_id}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium"
                    >
                      <span>{memberName} · {membershipScope}</span>
                      {profile.role === "manager" && membershipScope === "project" ? (
                        <DeleteProjectMemberButton
                          compact
                          memberName={memberName}
                          profileId={member.profile_id}
                          projectId={project.id}
                          projectName={project.name}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {profile.role === "manager" ? (
                <ActionForm action={addProjectMember} className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <AddWorkspaceMemberFormFields
                    members={members}
                    projectId={project.id}
                    selectId={`profile-${project.id}`}
                    workspaceMembers={workspaceMembers}
                  />
                </ActionForm>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
