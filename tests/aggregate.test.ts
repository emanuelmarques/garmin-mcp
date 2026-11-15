import { describe, expect, it } from "vitest";
import { aggregate, type Point } from "@/lib/aggregate";

const range = { from: "2026-01-01", to: "2026-01-31" };

describe("aggregate", () => {
  it("returns [] for no points", () => {
    expect(aggregate([], "month", range)).toEqual([]);
  });
  it("computes avg/min/max/count per month", () => {
    const pts: Point[] = [
      { date: "2026-01-02", value: 10 },
      { date: "2026-01-03", value: 20 },
    ];
    expect(aggregate(pts, "month", range)).toEqual([
      { key: "2026-01", count: 2, avg: 15, min: 10, max: 20, partial: false },
    ]);
  });
  it("ignores null values and gives avg null when all are null", () => {
    const pts: Point[] = [{ date: "2026-01-02", value: null }];
    expect(aggregate(pts, "month", range)).toEqual([
      { key: "2026-01", count: 0, avg: null, min: null, max: null, partial: false },
    ]);
  });
  it("marks a week cut by the range start as partial", () => {
    const pts: Point[] = [{ date: "2026-01-01", value: 5 }];
    const [g] = aggregate(pts, "week", range);
    expect(g.key).toBe("2026-W01");
    expect(g.partial).toBe(true);
  });
  it("marks a month cut by the range end as partial", () => {
    const pts: Point[] = [{ date: "2026-01-10", value: 5 }];
    const [g] = aggregate(pts, "month", { from: "2026-01-01", to: "2026-01-20" });
    expect(g.partial).toBe(true);
  });
  it("groups everything under 'all'", () => {
    const pts: Point[] = [
      { date: "2026-01-02", value: 1 },
      { date: "2026-01-20", value: 3 },
    ];
    expect(aggregate(pts, "all", range)).toEqual([
      { key: "all", count: 2, avg: 2, min: 1, max: 3, partial: false },
    ]);
  });
  it("sorts groups chronologically", () => {
    const pts: Point[] = [
      { date: "2026-02-02", value: 1 },
      { date: "2026-01-02", value: 1 },
    ];
    expect(aggregate(pts, "month", { from: "2026-01-01", to: "2026-02-28" }).map((g) => g.key)).toEqual([
      "2026-01",
      "2026-02",
    ]);
  });
});
