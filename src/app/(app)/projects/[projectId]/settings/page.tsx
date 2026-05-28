import { addProjectMember } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAppContext, listProjectMembers } from "@/lib/data";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { activeProject, profile } = await getAppContext(projectId);

  if (!activeProject) {
    return null;
  }

  const members = await listProjectMembers(projectId);

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
            <form action={addProjectMember} className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
              <input name="projectId" type="hidden" value={projectId} />
              <div className="grid gap-2">
                <Label htmlFor="project-member-display-name">Project member name</Label>
                <Input id="project-member-display-name" name="displayName" placeholder="Grace Hopper" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-member-email">Project member email</Label>
                <Input
                  id="project-member-email"
                  name="email"
                  type="email"
                  placeholder="teammate@labelbox.com"
                  required
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="secondary">
                  Add to project
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
