import { describe, expect, it } from "vitest";

import { nextRunDate, recurringRunDatesUpTo, type RecurrenceCadence } from "@/lib/recurrence";

function cadence(overrides: Partial<RecurrenceCadence>): RecurrenceCadence {
  return {
    frequency: "daily",
    interval_days: null,
    weekdays: [],
    next_run_on: "2026-01-01",
    ...overrides,
  };
}

// 2026-01-01 is a Thursday (day 4); 2026-01-05 is the following Monday (day 1).

describe("nextRunDate", () => {
  it("advances one day for daily rules", () => {
    expect(nextRunDate(cadence({ frequency: "daily", next_run_on: "2026-01-01" }))).toBe("2026-01-02");
  });

  it("advances by interval_days for custom rules", () => {
    expect(
      nextRunDate(cadence({ frequency: "custom", interval_days: 3, next_run_on: "2026-01-01" })),
    ).toBe("2026-01-04");
  });

  it("defaults custom interval to 1 day when interval_days is null", () => {
    expect(
      nextRunDate(cadence({ frequency: "custom", interval_days: null, next_run_on: "2026-01-01" })),
    ).toBe("2026-01-02");
  });

  it("advances to the next configured weekday for weekly rules", () => {
    expect(
      nextRunDate(cadence({ frequency: "weekly", weekdays: [1], next_run_on: "2026-01-01" })),
    ).toBe("2026-01-05");
  });

  it("advances a full week when the only weekday matches the current day", () => {
    expect(
      nextRunDate(cadence({ frequency: "weekly", weekdays: [4], next_run_on: "2026-01-01" })),
    ).toBe("2026-01-08");
  });
});

describe("recurringRunDatesUpTo (catch-up)", () => {
  it("returns every missed daily occurrence up to and including today", () => {
    const dates = recurringRunDatesUpTo(cadence({ frequency: "daily", next_run_on: "2026-01-01" }), "2026-01-05");
    expect(dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
  });

  it("returns a single date when next_run_on equals today", () => {
    const dates = recurringRunDatesUpTo(cadence({ frequency: "daily", next_run_on: "2026-01-05" }), "2026-01-05");
    expect(dates).toEqual(["2026-01-05"]);
  });

  it("returns no dates when next_run_on is in the future", () => {
    const dates = recurringRunDatesUpTo(cadence({ frequency: "daily", next_run_on: "2026-01-10" }), "2026-01-05");
    expect(dates).toEqual([]);
  });

  it("catches up weekly occurrences across multiple weeks", () => {
    const dates = recurringRunDatesUpTo(
      cadence({ frequency: "weekly", weekdays: [1], next_run_on: "2026-01-01" }),
      "2026-01-20",
    );
    expect(dates).toEqual(["2026-01-01", "2026-01-05", "2026-01-12", "2026-01-19"]);
  });

  it("catches up custom interval occurrences", () => {
    const dates = recurringRunDatesUpTo(
      cadence({ frequency: "custom", interval_days: 2, next_run_on: "2026-01-01" }),
      "2026-01-06",
    );
    expect(dates).toEqual(["2026-01-01", "2026-01-03", "2026-01-05"]);
  });

  it("is bounded so a long-stale daily rule cannot loop unbounded", () => {
    const dates = recurringRunDatesUpTo(cadence({ frequency: "daily", next_run_on: "2020-01-01" }), "2026-01-01");
    expect(dates).toHaveLength(366);
  });
});
