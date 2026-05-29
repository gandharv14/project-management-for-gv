import Link from "next/link";
import type React from "react";
import { AlertTriangle, Lightbulb, Repeat, TimerReset } from "lucide-react";

import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getManagerDashboard } from "@/lib/data";
import type { RecurringOccurrence } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export default async function ManagerPage() {
  const dashboard = await getManagerDashboard();
  const overdueByPerson = dashboard.profiles.map((profile) => ({
    profile,
    tasks: dashboard.overdueTasks.filter((task) => task.assignee_id === profile.id),
  }));

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresh tables={["tasks", "blockers", "suggestions", "suggestion_votes"]} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Manager Dashboard</h1>
        <p className="text-muted-foreground">
          Overdue tasks, aging blockers, trending ideas, and recurring duty completion.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={<TimerReset />} label="Overdue tasks" value={dashboard.overdueTasks.length} />
        <Metric icon={<AlertTriangle />} label="Open blockers" value={dashboard.blockers.length} />
        <Metric icon={<Lightbulb />} label="Trending suggestions" value={dashboard.suggestions.length} />
        <Metric
          icon={<Repeat />}
          label="Recurring completed"
          value={`${averageCompletion(dashboard.completionByPerson)}%`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overdue by person</CardTitle>
            <CardDescription>Incomplete tasks with due dates before today.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Oldest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueByPerson.map(({ profile, tasks }) => (
                  <TableRow key={profile.id}>
                    <TableCell>{profile.display_name}</TableCell>
                    <TableCell>{tasks.length}</TableCell>
                    <TableCell>{tasks[0] ? formatDate(tasks[0].due_date) : "None"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rolling 30-day recurring completion</CardTitle>
            <CardDescription>Completed generated recurring instances by assignee.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.completionByPerson.map((row) => (
                  <TableRow key={row.profile.id}>
                    <TableCell>{row.profile.display_name}</TableCell>
                    <TableCell>
                      {row.completed}/{row.total}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.rate >= 80 ? "default" : "secondary"}>{row.rate}%</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4" />
            Recurring duty completion (last 7)
          </CardTitle>
          <CardDescription>Whether each recurring duty was completed in its last 7 scheduled occurrences.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Duty</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Last 7</TableHead>
                <TableHead>Done</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.recurringDuties.map((duty) => (
                <TableRow key={duty.id}>
                  <TableCell>
                    <div className="font-medium">{duty.title}</div>
                    {duty.projectName ? (
                      <div className="text-xs text-muted-foreground">{duty.projectName}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{duty.assignee?.display_name ?? "Unassigned"}</TableCell>
                  <TableCell className="capitalize">{duty.frequency}</TableCell>
                  <TableCell>
                    <HistoryStrip history={duty.history} />
                  </TableCell>
                  <TableCell>
                    {duty.completedCount}/{duty.history.length}
                  </TableCell>
                </TableRow>
              ))}
              {dashboard.recurringDuties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    No active recurring duties.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open blockers by age</CardTitle>
            <CardDescription>Oldest unresolved blockers first.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {dashboard.blockers.map((blocker) => (
              <div key={blocker.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{blocker.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {blocker.projects?.name ?? "Project"} · {blocker.ageDays} days old
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/projects/${blocker.project_id}/blockers`}>Open</Link>
                  </Button>
                </div>
              </div>
            ))}
            {dashboard.blockers.length === 0 ? <p className="text-sm text-muted-foreground">No open blockers.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trending suggestions</CardTitle>
            <CardDescription>Open or active suggestions sorted by recent activity.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {dashboard.suggestions.map((suggestion) => (
              <div key={suggestion.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{suggestion.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {suggestion.vote_count ?? 0} votes · {suggestion.status.replace("_", " ")}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/projects/${suggestion.project_id}/suggestions`}>Review</Link>
                  </Button>
                </div>
              </div>
            ))}
            {dashboard.suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active suggestions.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
        <div className="text-muted-foreground [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
      </CardContent>
    </Card>
  );
}

const OCCURRENCE_STYLES: Record<RecurringOccurrence["status"], string> = {
  done: "bg-emerald-500",
  missed: "bg-destructive",
  pending: "bg-muted-foreground/40",
};

function HistoryStrip({ history }: { history: RecurringOccurrence[] }) {
  if (history.length === 0) {
    return <span className="text-xs text-muted-foreground">No history</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {history.map((occurrence, index) => (
        <span
          key={`${occurrence.date}-${index}`}
          title={`${formatDate(occurrence.date)} · ${occurrence.status}`}
          className={`h-2.5 w-2.5 rounded-full ${OCCURRENCE_STYLES[occurrence.status]}`}
        />
      ))}
    </div>
  );
}

function averageCompletion(rows: Array<{ total: number; rate: number }>) {
  const withData = rows.filter((row) => row.total > 0);

  if (withData.length === 0) {
    return 0;
  }

  return Math.round(withData.reduce((sum, row) => sum + row.rate, 0) / withData.length);
}
