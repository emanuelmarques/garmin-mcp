import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { verifyJwt } from "@/lib/auth/tokens";
import { loadConfig } from "@/lib/config";
import { createGarminClient, type GarminClient } from "@/lib/garmin/client";
import { METRIC_NAMES, type MetricName } from "@/lib/garmin/metrics";
import { runActivitiesList, runActivitiesSummary } from "@/lib/tools/activities";
import { asToolResult, todayUtc, type ToolCtx } from "@/lib/tools/common";
import { runActivityDetail, runDailySummary, runProfile } from "@/lib/tools/details";
import { runHealthSeries } from "@/lib/tools/healthSeries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let client: GarminClient | undefined;
const getClient = () => (client ??= createGarminClient({ apiKey: loadConfig().garminApiKey }));
const ctx = (): ToolCtx => ({ today: todayUtc(), keyExpires: loadConfig().garminKeyExpires });

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const readOnly = { readOnlyHint: true, openWorldHint: true };

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_health_series",
      {
        description:
          "Historical Garmin health metric over a date range, aggregated by week/month/all (avg/min/max/count; partial periods flagged). " +
          "Use for trends over weeks, months or years. Set daily=true (max 31 days) for day-by-day values. " +
          "Metrics: " + METRIC_NAMES.join(", ") + ". Dates are YYYY-MM-DD (local calendar dates).",
        inputSchema: z.object({
          metric: z.enum(METRIC_NAMES as [MetricName, ...MetricName[]]),
          from: date,
          to: date,
          groupBy: z.enum(["week", "month", "all"]).optional(),
          daily: z.boolean().optional(),
        }),
        annotations: readOnly,
      },
      async (args) => asToolResult(() => runHealthSeries(getClient(), args, ctx())),
    );

    server.registerTool(
      "get_activities_summary",
      {
        description:
          "Summary of Garmin activities (runs, rides, etc.) in a date range, grouped by week or month: count, distance (km), duration (hours), counts by activity type.",
        inputSchema: z.object({ from: date, to: date, groupBy: z.enum(["week", "month"]).optional() }),
        annotations: readOnly,
      },
      async (args) => asToolResult(() => runActivitiesSummary(getClient(), args, ctx())),
    );

    server.registerTool(
      "list_activities",
      {
        description:
          "List individual Garmin activities in a date range (newest first) with id, date, name, type, distance and duration. Default 20, max 50. Use the id with get_activity.",
        inputSchema: z.object({ from: date, to: date, limit: z.number().int().min(1).max(50).optional() }),
        annotations: readOnly,
      },
      async (args) => asToolResult(() => runActivitiesList(getClient(), args, ctx())),
    );

    server.registerTool(
      "get_activity",
      {
        description: "Details of one Garmin activity by numeric activityId (get ids from list_activities).",
        inputSchema: z.object({ activityId: z.string() }),
        annotations: readOnly,
      },
      async (args) => asToolResult(() => runActivityDetail(getClient(), args)),
    );

    server.registerTool(
      "get_daily_summary",
      {
        description: "Garmin daily summary (steps, calories, heart rate, stress, etc.) for one date.",
        inputSchema: z.object({ date }),
        annotations: readOnly,
      },
      async (args) => asToolResult(() => runDailySummary(getClient(), args)),
    );

    server.registerTool(
      "get_profile",
      {
        description: "Garmin user settings (units, time zone, etc.).",
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      async () => asToolResult(() => runProfile(getClient())),
    );
  },
  { serverInfo: { name: "garmin-mcp", version: "0.1.0" } },
);

const authed = withMcpAuth(
  handler,
  async (_req, bearer) => {
    if (!bearer) return undefined;
    try {
      const p = await verifyJwt(loadConfig().signingSecret, "access", bearer);
      return { token: bearer, clientId: String(p.clientId ?? "owner"), scopes: [], expiresAt: p.exp };
    } catch {
      return undefined;
    }
  },
  { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource" },
);

export { authed as GET, authed as POST, authed as DELETE };
