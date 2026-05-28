import { addProjectMember } from "@/app/actions";
import { AddWorkspaceMemberFormFields } from "@/components/add-workspace-member-form-fields";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppContext, listProjectMembers, listWorkspaceProfiles } from "@/lib/data";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { activeProject, profile } = await getAppContext(projectId);

  if (!activeProject) {
    return null;
  }

  const [members, workspaceMembers] = await Promise.all([listProjectMembers(projectId), listWorkspaceProfiles()]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Project settings</h1>
        <p className="text-muted-foreground">
          Manage members for {activeProject.name}. Workspace members are included automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                Project-only members get access to this project without joining the full workspace.
              </CardDescription>
            </div>
            <Badge variant="secondary">{members.length} members</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            {members.map((member) => {
              const membershipScope = member.profiles?.membership_scope ?? "project";

              return (
                <div
                  key={member.profile_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
                >
                  <div>
                    <p className="font-medium">{member.profiles?.display_name ?? "Unknown"}</p>
                    <p className="text-sm text-muted-foreground">{member.profiles?.email ?? "No email"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={membershipScope === "workspace" ? "secondary" : "outline"}>
                      {membershipScope}
                    </Badge>
                    <Badge variant={member.profiles?.role === "manager" ? "default" : "secondary"}>
                      {member.profiles?.role ?? "member"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>

          {profile.role === "manager" ? (
            <form action={addProjectMember} className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <AddWorkspaceMemberFormFields
                members={members}
                projectId={projectId}
                selectId="project-member-profile"
                workspaceMembers={workspaceMembers}
              />
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
