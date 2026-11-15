import { aggregate, type Group, type Point } from "../aggregate";
import { addDays, daysBetween } from "../dates";
import type { GarminClient } from "../garmin/client";
import { METRICS, type MetricName } from "../garmin/metrics";
import { assertDate, expiryWarning, ToolInputError, type ToolCtx } from "./common";

export type HealthArgs = {
  metric: MetricName;
  from: string;
  to: string;
  groupBy?: "week" | "month" | "all";
  daily?: boolean;
};

export type HealthResult = {
  metric: MetricName;
  unit: string;
  from: string;
  to: string;
  groupBy: "week" | "month" | "all";
  groups: Group[];
  daily?: Point[];
  reachedDate: string | null;
  warnings: string[];
};

const DEFAULT_DEADLINE_MS = 20_000;
const MAX_DAILY_DAYS = 31;

export async function runHealthSeries(client: GarminClient, args: HealthArgs, ctx: ToolCtx): Promise<HealthResult> {
  assertDate(args.from, "from");
  assertDate(args.to, "to");
  const def = METRICS[args.metric];
  const groupBy = args.groupBy ?? "month";
  const warnings = expiryWarning(ctx.keyExpires, ctx.today);
  let to = args.to;
  const base = { metric: args.metric, unit: def.unit, from: args.from, groupBy, groups: [] as Group[], reachedDate: null };
  const empty = (msg: string): HealthResult => ({ ...base, to, warnings: [...warnings, msg] });

  if (args.from > args.to) return empty("'from' is after 'to'; nothing to fetch.");
  if (to > ctx.today) {
    to = ctx.today;
    warnings.push(`'to' is in the future; clamped to ${ctx.today}.`);
  }
  if (args.from > to) return empty("The whole range is in the future; nothing to fetch.");
  if (args.daily && daysBetween(args.from, to) + 1 > MAX_DAILY_DAYS) {
    throw new ToolInputError(`daily detail is limited to ${MAX_DAILY_DAYS} days; use groupBy for longer ranges.`);
  }

  const { chunks, reachedDate } = await client.getChunked<unknown>({
    path: def.path,
    query: def.query,
    range: { from: args.from, to },
    maxDays: def.maxDays,
    deadlineMs: ctx.deadlineMs ?? DEFAULT_DEADLINE_MS,
  });

  const points = chunks
    .flatMap((c) => def.extract(c))
    .sort((a, b) => a.date.localeCompare(b.date));
  const groups = aggregate(points, groupBy, { from: args.from, to });

  if (reachedDate) {
    warnings.push(`Partial result: data covers ${args.from} to ${reachedDate}. Ask again from ${addDays(reachedDate, 1)} for the rest.`);
  } else if (groups.length === 0) {
    warnings.push("No data found in this range.");
  }

  return {
    ...base,
    to,
    groups,
    ...(args.daily ? { daily: points } : {}),
    reachedDate,
    warnings,
  };
}
