import { addDays, formatISO } from "date-fns";

import type { RecurringRule } from "@/lib/types";

export type RecurrenceCadence = Pick<
  RecurringRule,
  "frequency" | "interval_days" | "weekdays" | "next_run_on"
>;

// Upper bound on catch-up iterations so a malformed rule can never spin forever.
const MAX_CATCH_UP_ITERATIONS = 366;

export function nextRunDate(rule: RecurrenceCadence) {
  const current = new Date(`${rule.next_run_on}T00:00:00`);

  if (rule.frequency === "daily") {
    return formatISO(addDays(current, 1), { representation: "date" });
  }

  if (rule.frequency === "custom") {
    return formatISO(addDays(current, rule.interval_days ?? 1), { representation: "date" });
  }

  const weekdays = rule.weekdays.length > 0 ? rule.weekdays : [current.getDay()];
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addDays(current, offset);
    if (weekdays.includes(candidate.getDay())) {
      return formatISO(candidate, { representation: "date" });
    }
  }

  return formatISO(addDays(current, 7), { representation: "date" });
}

/**
 * Returns every scheduled run date from the rule's current `next_run_on` up to
 * and including `today`. Used so a cron that missed one or more days generates
 * an instance for each missed occurrence instead of advancing a single period.
 * ISO date strings (YYYY-MM-DD) compare lexicographically in chronological
 * order, so plain string comparison is safe here.
 */
export function recurringRunDatesUpTo(rule: RecurrenceCadence, today: string): string[] {
  const dates: string[] = [];
  let cursor = rule.next_run_on;
  let iterations = 0;

  while (cursor <= today && iterations < MAX_CATCH_UP_ITERATIONS) {
    dates.push(cursor);
    cursor = nextRunDate({ ...rule, next_run_on: cursor });
    iterations += 1;
  }

  return dates;
}
