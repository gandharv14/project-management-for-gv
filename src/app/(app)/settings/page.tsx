import { addProjectMember, createProject } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAppContext, listProjectMembers } from "@/lib/data";

export default async function SettingsPage() {
  const { profile, projects } = await getAppContext();
  const projectMembers = await Promise.all(
    projects.map(async (project) => ({
      project,
      members: await listProjectMembers(project.id),
    })),
  );

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
            <CardDescription>Projects tie together tasks, blockers, and suggestions.</CardDescription>
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
                <Button type="submit">Create</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4">
        {projectMembers.map(({ project, members }) => (
          <Card key={project.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>{project.description ?? "No description yet."}</CardDescription>
                </div>
                <Badge variant="secondary">{members.length} members</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                {members.map((member) => (
                  <Badge key={member.profile_id} variant="outline">
                    {member.profiles?.display_name ?? "Unknown"}
                  </Badge>
                ))}
              </div>
              {profile.role === "manager" ? (
                <form action={addProjectMember} className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <input name="projectId" type="hidden" value={project.id} />
                  <div className="grid gap-2">
                    <Label htmlFor={`email-${project.id}`}>Add existing user by email</Label>
                    <Input id={`email-${project.id}`} name="email" type="email" placeholder="teammate@labelbox.com" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Role</Label>
                    <Select disabled defaultValue="member">
                      <option value="member">Member</option>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" variant="secondary">
                      Add
                    </Button>
                  </div>
                </form>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
