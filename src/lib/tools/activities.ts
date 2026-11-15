import { isoWeekKey, monthKey } from "../dates";
import { GarminError, type GarminClient } from "../garmin/client";
import { assertDate, expiryWarning, type ToolCtx } from "./common";

/** UNVERIFIED: query names (start/limit/startDate/endDate) and field names; confirm with the spike. */
const PATH = "/activitylist-service/activities/search/activities";
const PAGE = 100;
const MAX_PAGES = 50;
const DEFAULT_DEADLINE_MS = 20_000;

type Raw = {
  activityId?: number | string;
  activityName?: string;
  startTimeLocal?: string;
  distance?: number;
  duration?: number;
  activityType?: { typeKey?: string };
};

export type ActivityGroup = {
  key: string;
  count: number;
  distanceKm: number;
  durationHours: number;
  byType: Record<string, number>;
};

export type ActivitiesResult = {
  from: string;
  to: string;
  groupBy: "week" | "month";
  groups: ActivityGroup[];
  reachedDate: string | null;
  warnings: string[];
};

const round = (n: number) => Math.round(n * 100) / 100;

export async function runActivitiesSummary(
  client: GarminClient,
  args: { from: string; to: string; groupBy?: "week" | "month" },
  ctx: ToolCtx,
): Promise<ActivitiesResult> {
  assertDate(args.from, "from");
  assertDate(args.to, "to");
  const groupBy = args.groupBy ?? "month";
  const warnings = expiryWarning(ctx.keyExpires, ctx.today);
  const out = (groups: ActivityGroup[], reachedDate: string | null, extra: string[] = []): ActivitiesResult => ({
    from: args.from,
    to: args.to,
    groupBy,
    groups,
    reachedDate,
    warnings: [...warnings, ...extra],
  });
  if (args.from > args.to) return out([], null, ["'from' is after 'to'; nothing to fetch."]);

  const now = ctx.now ?? Date.now;
  const start = now();
  const deadline = ctx.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const all: Raw[] = [];
  let stoppedEarly = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (now() - start >= deadline) {
      stoppedEarly = true;
      break;
    }
    let rows: Raw[] | null;
    try {
      rows = await client.get<Raw[] | null>(PATH, {
        start: String(page * PAGE),
        limit: String(PAGE),
        startDate: args.from,
        endDate: args.to,
      });
    } catch (e) {
      // Keep what earlier pages gave us; only an error on the very first page (or a bad key) is fatal.
      if (e instanceof GarminError && e.code !== "KEY_INVALID" && all.length > 0) {
        stoppedEarly = true;
        break;
      }
      throw e;
    }
    if (!Array.isArray(rows)) break;
    all.push(...rows);
    if (rows.length < PAGE) break;
    if (page === MAX_PAGES - 1) stoppedEarly = true;
  }

  const buckets = new Map<string, ActivityGroup>();
  let oldest: string | null = null;
  for (const a of all) {
    const date = a.startTimeLocal?.slice(0, 10);
    if (!date) continue;
    if (!oldest || date < oldest) oldest = date;
    const key = groupBy === "week" ? isoWeekKey(date) : monthKey(date);
    const g = buckets.get(key) ?? { key, count: 0, distanceKm: 0, durationHours: 0, byType: {} };
    g.count += 1;
    g.distanceKm += (a.distance ?? 0) / 1000;
    g.durationHours += (a.duration ?? 0) / 3600;
    const type = a.activityType?.typeKey ?? "unknown";
    g.byType[type] = (g.byType[type] ?? 0) + 1;
    buckets.set(key, g);
  }
  const groups = [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((g) => ({ ...g, distanceKm: round(g.distanceKm), durationHours: round(g.durationHours) }));

  if (stoppedEarly && oldest) {
    return out(groups, oldest, [`Partial result: activities from ${oldest} to ${args.to} only (stopped early). Ask again with to=${oldest} for earlier ones.`]);
  }
  if (groups.length === 0) return out([], null, ["No activities found in this range."]);
  return out(groups, null);
}

export type ActivityListItem = {
  id: string;
  date: string;
  name: string | null;
  type: string;
  distanceKm: number;
  durationMin: number;
};

const LIST_DEFAULT = 20;
const LIST_MAX = 50;

/** Newest activities in a range with their ids, so get_activity has something to be called with. */
export async function runActivitiesList(
  client: GarminClient,
  args: { from: string; to: string; limit?: number },
  ctx: ToolCtx,
): Promise<{ from: string; to: string; activities: ActivityListItem[]; warnings: string[] }> {
  assertDate(args.from, "from");
  assertDate(args.to, "to");
  const warnings = expiryWarning(ctx.keyExpires, ctx.today);
  if (args.from > args.to) {
    return { from: args.from, to: args.to, activities: [], warnings: [...warnings, "'from' is after 'to'; nothing to fetch."] };
  }
  const limit = Math.min(Math.max(Math.floor(args.limit ?? LIST_DEFAULT), 1), LIST_MAX);
  const rows = await client.get<Raw[] | null>(PATH, {
    start: "0",
    limit: String(limit),
    startDate: args.from,
    endDate: args.to,
  });
  const activities = (Array.isArray(rows) ? rows : []).flatMap((a): ActivityListItem[] => {
    const date = a.startTimeLocal?.slice(0, 10);
    if (a.activityId === undefined || !date) return [];
    return [
      {
        id: String(a.activityId),
        date,
        name: a.activityName ?? null,
        type: a.activityType?.typeKey ?? "unknown",
        distanceKm: round((a.distance ?? 0) / 1000),
        durationMin: round((a.duration ?? 0) / 60),
      },
    ];
  });
  if (activities.length === 0) warnings.push("No activities found in this range.");
  else if (activities.length === limit) warnings.push(`Showing the newest ${limit}; narrow the range or raise limit (max ${LIST_MAX}) to see others.`);
  return { from: args.from, to: args.to, activities, warnings };
}
