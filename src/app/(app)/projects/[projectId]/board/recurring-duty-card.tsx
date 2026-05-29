"use client";

import * as React from "react";
import type { FormEvent } from "react";
import { CalendarClock, CheckCircle2, Repeat, Trash2 } from "lucide-react";

import { completeRecurringDuty, deleteRecurringRule } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RecurringOccurrence, RecurringRule, RecurringRuleWithHistory } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type RecurringDutyCardProps = {
  projectId: string;
  rule: RecurringRuleWithHistory;
};

function periodNoun(rule: RecurringRule) {
  if (rule.frequency === "weekly") {
    return "week";
  }

  if (rule.frequency === "custom" && (rule.interval_days ?? 1) > 1) {
    return "interval";
  }

  return "day";
}

function formatSchedule(rule: RecurringRule) {
  if (rule.frequency === "daily") {
    return "Every day";
  }

  if (rule.frequency === "custom") {
    const days = rule.interval_days ?? 1;
    return days === 1 ? "Every day" : `Every ${days} days`;
  }

  if (rule.weekdays.length === 0) {
    return "Weekly";
  }

  const days = [...rule.weekdays]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_LABELS[day] ?? `Day ${day}`)
    .join(", ");

  return `Weekly on ${days}`;
}

export function RecurringDutyCard({ projectId, rule }: RecurringDutyCardProps) {
  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm(`Delete recurring duty "${rule.title}"? This cannot be undone.`)) {
      event.preventDefault();
    }
  }

  const completionLabel = `${rule.completedCount}/${rule.history.length || 0} done`;

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="rounded-md text-left text-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="font-medium">{rule.title}</div>
            <div className="text-muted-foreground">
              {rule.frequency} · next run {formatDate(rule.next_run_on)}
            </div>
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Repeat className="h-4 w-4" />
              {rule.title}
            </DialogTitle>
            <DialogDescription>Details for this recurring duty.</DialogDescription>
          </DialogHeader>

          <dl className="grid gap-3 text-sm">
            {rule.description ? (
              <Detail label="Description">
                <p className="whitespace-pre-wrap text-foreground">{rule.description}</p>
              </Detail>
            ) : null}
            <Detail label="Schedule">
              <span className="text-foreground">{formatSchedule(rule)}</span>
            </Detail>
            <Detail label="Next run">
              <span className="flex items-center gap-1 text-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                {formatDate(rule.next_run_on)}
              </span>
            </Detail>
            <Detail label="Assignee">
              <span className="text-foreground">{rule.assignee?.display_name ?? "Unassigned"}</span>
            </Detail>
            <Detail label="Status">
              <Badge variant={rule.is_active ? "secondary" : "outline"}>
                {rule.is_active ? "Active" : "Paused"}
              </Badge>
            </Detail>
            <Detail label={`Last ${rule.history.length || 7} (${completionLabel})`}>
              <HistoryStrip history={rule.history} />
            </Detail>
            <Detail label="Created">
              <span className="text-foreground">{formatDate(rule.created_at.slice(0, 10))}</span>
            </Detail>
          </dl>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
            <ActionForm action={deleteRecurringRule} onSubmit={confirmDelete}>
              <input name="projectId" type="hidden" value={projectId} />
              <input name="ruleId" type="hidden" value={rule.id} />
              <FormSubmitButton pendingLabel="Deleting..." size="sm" variant="destructive">
                <Trash2 className="h-4 w-4" />
                Delete duty
              </FormSubmitButton>
            </ActionForm>
            <div className="flex gap-2">
              {rule.currentPeriodDone ? (
                <span className="flex items-center gap-1 text-sm font-medium text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Done this {periodNoun(rule)}
                </span>
              ) : (
                <ActionForm action={completeRecurringDuty}>
                  <input name="projectId" type="hidden" value={projectId} />
                  <input name="ruleId" type="hidden" value={rule.id} />
                  <FormSubmitButton pendingLabel="Completing..." size="sm">
                    <CheckCircle2 className="h-4 w-4" />
                    Mark done
                  </FormSubmitButton>
                </ActionForm>
              )}
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Close
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between gap-2">
        <HistoryStrip history={rule.history} />
        {rule.currentPeriodDone ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Done
          </span>
        ) : (
          <ActionForm action={completeRecurringDuty}>
            <input name="projectId" type="hidden" value={projectId} />
            <input name="ruleId" type="hidden" value={rule.id} />
            <FormSubmitButton pendingLabel="..." size="sm" variant="secondary">
              <CheckCircle2 className="h-4 w-4" />
              Mark done
            </FormSubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

const OCCURRENCE_STYLES: Record<RecurringOccurrence["status"], string> = {
  done: "bg-emerald-500",
  missed: "bg-destructive",
  pending: "bg-muted-foreground/40",
};

function HistoryStrip({ history }: { history: RecurringOccurrence[] }) {
  if (history.length === 0) {
    return <span className="text-xs text-muted-foreground">No history yet</span>;
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
