import { addDays, isoWeekKey, isoWeekStart, monthBounds, monthKey } from "./dates";

export type Point = { date: string; value: number | null };
export type Group = {
  key: string;
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  partial: boolean;
};

function bounds(by: "week" | "month", anyDate: string): { from: string; to: string } {
  if (by === "month") return monthBounds(anyDate);
  const from = isoWeekStart(anyDate);
  return { from, to: addDays(from, 6) };
}

/** Groups points by week/month/all; null values are ignored. Sorted chronologically. */
export function aggregate(
  points: Point[],
  by: "week" | "month" | "all",
  range: { from: string; to: string },
): Group[] {
  const buckets = new Map<string, { values: number[]; sample: string }>();
  for (const p of points) {
    const key = by === "all" ? "all" : by === "week" ? isoWeekKey(p.date) : monthKey(p.date);
    const b = buckets.get(key) ?? { values: [], sample: p.date };
    if (p.value !== null) b.values.push(p.value);
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { values, sample }]) => {
      const partial =
        by === "all"
          ? false
          : (() => {
              const b = bounds(by, sample);
              return b.from < range.from || b.to > range.to;
            })();
      return {
        key,
        count: values.length,
        avg: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
        partial,
      };
    });
}
