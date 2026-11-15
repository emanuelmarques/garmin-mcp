import type { Point } from "../aggregate";

/**
 * UNVERIFIED: endpoint query styles, maxDays and response shapes below are best guesses from the
 * Swagger path list. Run `npm run spike`, read docs/garmin-api-findings.md, and correct this table.
 */
export type MetricName = "sleep" | "hrv" | "steps" | "stress" | "weight" | "bodyBattery" | "hydration";

export type MetricDef = {
  path(from: string, to: string): string;
  query?(from: string, to: string): Record<string, string>;
  maxDays: number;
  extract(raw: unknown): Point[];
  unit: string;
};

const DATE_KEYS = ["calendarDate", "summaryDate", "date", "startDate"];

function getPath(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function findRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  if (raw && typeof raw === "object") {
    for (const v of Object.values(raw)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return findRows(v);
    }
  }
  return [];
}

function rows(raw: unknown, valuePaths: string[], scale = 1): Point[] {
  return findRows(raw).flatMap((r) => {
    const dateKey = DATE_KEYS.find((k) => typeof r[k] === "string");
    if (!dateKey) return [];
    const date = String(r[dateKey]).slice(0, 10);
    const vp = valuePaths.map((p) => getPath(r, p)).find((v) => typeof v === "number") as number | undefined;
    return [{ date, value: vp === undefined ? null : vp * scale }];
  });
}

const dated = (base: string) => (f: string, t: string) => `${base}/${f}/${t}`;
const q = (f: string, t: string) => ({ startDate: f, endDate: t });

export const METRICS: Record<MetricName, MetricDef> = {
  steps: { path: dated("/usersummary-service/stats/steps/daily"), maxDays: 28, unit: "steps", extract: (r) => rows(r, ["totalSteps", "steps"]) },
  stress: { path: dated("/usersummary-service/stats/stress/daily"), maxDays: 28, unit: "stress level (0-100)", extract: (r) => rows(r, ["values.overallStressLevel", "overallStressLevel"]) },
  hydration: { path: dated("/usersummary-service/stats/hydration/daily"), maxDays: 28, unit: "ml", extract: (r) => rows(r, ["valueInML", "intakeInML"]) },
  hrv: { path: dated("/hrv-service/hrv/daily"), maxDays: 28, unit: "ms (last-night average)", extract: (r) => rows(r, ["lastNightAvg", "weeklyAvg"]) },
  weight: { path: dated("/weight-service/weight/range"), maxDays: 90, unit: "kg", extract: (r) => rows(r, ["latestWeight.weight", "weight"], 0.001) },
  sleep: { path: () => "/sleep-service/sleep/dailySleepSummariesByDate", query: q, maxDays: 28, unit: "hours slept", extract: (r) => rows(r, ["sleepTimeSeconds", "dailySleepDTO.sleepTimeSeconds"], 1 / 3600) },
  bodyBattery: { path: () => "/wellness-service/wellness/bodyBattery/reports/daily", query: q, maxDays: 28, unit: "body battery (charged)", extract: (r) => rows(r, ["charged", "bodyBatteryCharged"]) },
};

export const METRIC_NAMES = Object.keys(METRICS) as MetricName[];
