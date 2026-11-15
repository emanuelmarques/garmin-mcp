import { describe, expect, it } from "vitest";
import { METRICS } from "@/lib/garmin/metrics";

describe("metric extractors (assumed shapes, see docs/garmin-api-findings.md)", () => {
  it("steps: array of rows", () => {
    expect(METRICS.steps.extract([{ calendarDate: "2026-01-01", totalSteps: 1000 }])).toEqual([
      { date: "2026-01-01", value: 1000 },
    ]);
  });
  it("hrv: rows nested under a wrapper object", () => {
    expect(METRICS.hrv.extract({ hrvSummaries: [{ calendarDate: "2026-01-01", lastNightAvg: 55 }] })).toEqual([
      { date: "2026-01-01", value: 55 },
    ]);
  });
  it("weight: converts grams to kg", () => {
    const raw = { dailyWeightSummaries: [{ summaryDate: "2026-01-01", latestWeight: { weight: 80000 } }] };
    expect(METRICS.weight.extract(raw)).toEqual([{ date: "2026-01-01", value: 80 }]);
  });
  it("sleep: converts seconds to hours", () => {
    expect(METRICS.sleep.extract([{ calendarDate: "2026-01-01", sleepTimeSeconds: 28800 }])).toEqual([
      { date: "2026-01-01", value: 8 },
    ]);
  });
  it("missing value gives null; row without a date is skipped; junk gives []", () => {
    expect(METRICS.steps.extract([{ calendarDate: "2026-01-01" }, { totalSteps: 3 }])).toEqual([
      { date: "2026-01-01", value: null },
    ]);
    expect(METRICS.steps.extract(null)).toEqual([]);
    expect(METRICS.steps.extract("oops")).toEqual([]);
  });
  it("builds paths and queries", () => {
    expect(METRICS.steps.path("2026-01-01", "2026-01-28")).toBe("/usersummary-service/stats/steps/daily/2026-01-01/2026-01-28");
    expect(METRICS.sleep.query?.("2026-01-01", "2026-01-28")).toEqual({ startDate: "2026-01-01", endDate: "2026-01-28" });
  });
});
