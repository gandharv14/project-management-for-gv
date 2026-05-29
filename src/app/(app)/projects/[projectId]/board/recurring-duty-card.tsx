"use client";

import * as React from "react";
import type { FormEvent } from "react";
import { CalendarClock, Repeat, Trash2 } from "lucide-react";

import { deleteRecurringRule } from "@/app/actions";
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
import type { RecurringRule } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type RecurringDutyCardProps = {
  projectId: string;
  rule: RecurringRule;
};

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

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-lg border bg-background/60 p-3 text-left text-sm transition-colors hover:border-primary/50 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
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
