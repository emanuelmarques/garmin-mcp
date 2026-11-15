import type { GarminClient } from "../garmin/client";
import { assertDate, slim, ToolInputError } from "./common";

export async function runActivityDetail(client: GarminClient, args: { activityId: string }) {
  if (!/^\d{1,20}$/.test(args.activityId)) throw new ToolInputError("activityId must be numeric");
  return slim(await client.get(`/activity-service/activity/${args.activityId}`));
}

/** UNVERIFIED: query parameter name `calendarDate`; confirm with the spike. */
export async function runDailySummary(client: GarminClient, args: { date: string }) {
  assertDate(args.date, "date");
  return slim(await client.get("/usersummary-service/usersummary/daily", { calendarDate: args.date }));
}

export async function runProfile(client: GarminClient) {
  return slim(await client.get("/userprofile-service/userprofile/settings"));
}
