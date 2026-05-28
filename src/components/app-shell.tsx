import Link from "next/link";
import type React from "react";
import { Bell, Flag, LayoutDashboard, Lightbulb, ListChecks, ShieldAlert, Settings } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Notification, Profile, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

type AppShellProps = {
  profile: Profile;
  projects: Project[];
  activeProjectId?: string;
  notifications: Notification[];
  children: React.ReactNode;
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppShell({
  profile,
  projects,
  activeProjectId,
  notifications,
  children,
}: AppShellProps) {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const unreadCount = notifications.filter((notification) => !notification.read_at).length;
  const logoutHref = process.env.E2E_AUTH_BYPASS === "1" ? "/api/e2e/session?logout=1&redirectTo=/" : "/auth/logout";

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 hidden w-72 flex-col border-r bg-card/70 p-5 lg:flex">
        <Link href="/today" className="text-lg font-semibold tracking-tight">
          Team Management
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">Single-team operating system</p>

        <nav className="mt-8 flex flex-col gap-1">
          <NavLink href="/today" icon={<ListChecks className="h-4 w-4" />}>
            Today
          </NavLink>
          {profile.role === "manager" ? (
            <NavLink href="/manager" icon={<LayoutDashboard className="h-4 w-4" />}>
              Manager
            </NavLink>
          ) : null}
          <NavLink href="/settings" icon={<Settings className="h-4 w-4" />}>
            Settings
          </NavLink>
        </nav>

        <Separator className="my-6" />

        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Projects</p>
          <Badge variant="secondary">{projects.length}</Badge>
        </div>
        <div className="mt-3 flex flex-col gap-1">
          {projects.map((project) => (
            <div key={project.id} className="flex items-center gap-1">
              <Link
                className={cn(
                  "min-w-0 flex-1 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                  activeProjectId === project.id && "bg-accent text-foreground",
                )}
                href={`/projects/${project.id}/board`}
              >
                {project.name}
              </Link>
              {profile.role === "manager" ? (
                <Link
                  aria-label={`${project.name} settings`}
                  className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                  href={`/projects/${project.id}/settings`}
                >
                  <Settings className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          ))}
          {projects.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Create a project in Settings to get started.
            </p>
          ) : null}
        </div>

        {activeProject ? (
          <>
            <Separator className="my-6" />
            <nav className="flex flex-col gap-1">
              <NavLink href={`/projects/${activeProject.id}/board`} icon={<ListChecks className="h-4 w-4" />}>
                Board
              </NavLink>
              <NavLink
                href={`/projects/${activeProject.id}/blockers`}
                icon={<ShieldAlert className="h-4 w-4" />}
              >
                Blockers
              </NavLink>
              <NavLink
                href={`/projects/${activeProject.id}/suggestions`}
                icon={<Lightbulb className="h-4 w-4" />}
              >
                Suggestions
              </NavLink>
              <NavLink href={`/projects/${activeProject.id}/flags`} icon={<Flag className="h-4 w-4" />}>
                Flag User
              </NavLink>
            </nav>
          </>
        ) : null}

        <div className="mt-auto">
          <div className="mb-4 rounded-lg border bg-background/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Bell className="h-4 w-4" />
              Notifications
              {unreadCount > 0 ? <Badge>{unreadCount}</Badge> : null}
            </div>
            <div className="space-y-2">
              {notifications.slice(0, 3).map((notification) => (
                <Link
                  href={notification.href ?? "/today"}
                  key={notification.id}
                  className="block rounded-md p-2 text-xs hover:bg-accent"
                >
                  <span className="font-medium">{notification.title}</span>
                  {notification.body ? (
                    <span className="mt-1 block text-muted-foreground">{notification.body}</span>
                  ) : null}
                </Link>
              ))}
              {notifications.length === 0 ? (
                <p className="text-xs text-muted-foreground">No notifications yet.</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Avatar>
              {profile.avatar_url ? <AvatarImage src={profile.avatar_url} alt={profile.display_name} /> : null}
              <AvatarFallback>{initials(profile.display_name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{profile.display_name}</p>
              <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <a href={logoutHref}>Log out</a>
            </Button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/today" className="font-semibold">
            Team Management
          </Link>
          <Button asChild size="sm" variant="outline">
            <Link href="/settings">Menu</Link>
          </Button>
        </header>
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {icon}
      {children}
    </Link>
  );
}
