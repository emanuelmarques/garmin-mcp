import { describe, expect, it, vi } from "vitest";
import type { GarminClient } from "@/lib/garmin/client";
import { GarminError } from "@/lib/garmin/client";
import { asToolResult, expiryWarning, slim, ToolInputError } from "@/lib/tools/common";
import { runHealthSeries } from "@/lib/tools/healthSeries";
import { runActivitiesList, runActivitiesSummary } from "@/lib/tools/activities";
import { runActivityDetail, runDailySummary, runProfile } from "@/lib/tools/details";

const ctx = { today: "2026-06-30", now: () => 0 };

function client(over: Partial<GarminClient> = {}): GarminClient {
  return {
    get: vi.fn(async () => ({})) as any,
    getChunked: vi.fn(async () => ({ chunks: [], reachedDate: null })) as any,
    ...over,
  };
}

describe("expiryWarning", () => {
  it("warns within 14 days", () => {
    expect(expiryWarning("2026-07-05", "2026-06-30")[0]).toMatch(/5 days/);
  });
  it("warns when already expired", () => {
    expect(expiryWarning("2026-06-01", "2026-06-30")[0]).toMatch(/expired/i);
  });
  it("is silent when far away or unset", () => {
    expect(expiryWarning("2027-01-01", "2026-06-30")).toEqual([]);
    expect(expiryWarning(undefined, "2026-06-30")).toEqual([]);
  });
});

describe("asToolResult", () => {
  it("wraps data as JSON text", async () => {
    const r = await asToolResult(async () => ({ a: 1 }));
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 });
  });
  it("maps KEY_INVALID to a clear message without secrets", async () => {
    const r = await asToolResult(async () => {
      throw new GarminError("KEY_INVALID", "Garmin key invalid or expired", 401);
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Garmin key invalid or expired/);
  });
  it("maps input errors and hides unexpected ones", async () => {
    const a = await asToolResult(async () => {
      throw new ToolInputError("bad range");
    });
    expect(a.content[0].text).toBe("bad range");
    const b = await asToolResult(async () => {
      throw new Error("db password hunter2");
    });
    expect(b.isError).toBe(true);
    expect(b.content[0].text).not.toContain("hunter2");
  });
});

describe("slim", () => {
  it("truncates oversized output", () => {
    const s = slim({ big: "x".repeat(50_000) }, 1000);
    expect(JSON.stringify(s).length).toBeLessThan(1500);
  });
  it("caps long arrays", () => {
    const s = slim({ a: Array.from({ length: 100 }, (_, i) => i) }) as any;
    expect(s.a.length).toBeLessThanOrEqual(21);
  });
});

describe("runHealthSeries", () => {
  it("aggregates chunked data by month", async () => {
    const c = client({
      getChunked: vi.fn(async () => ({
        chunks: [[{ calendarDate: "2026-06-01", totalSteps: 1000 }, { calendarDate: "2026-06-02", totalSteps: 3000 }]],
        reachedDate: null,
      })) as any,
    });
    const r = await runHealthSeries(c, { metric: "steps", from: "2026-06-01", to: "2026-06-30" }, ctx);
    expect(r.groups).toEqual([{ key: "2026-06", count: 2, avg: 2000, min: 1000, max: 3000, partial: false }]);
    expect(r.reachedDate).toBeNull();
    expect(r.daily).toBeUndefined();
  });
  it("from after to gives empty groups and a warning, no Garmin calls", async () => {
    const c = client();
    const r = await runHealthSeries(c, { metric: "steps", from: "2026-06-30", to: "2026-06-01" }, ctx);
    expect(r.groups).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/after/);
    expect(c.getChunked).not.toHaveBeenCalled();
  });
  it("clamps future dates and warns", async () => {
    const c = client();
    const r = await runHealthSeries(c, { metric: "steps", from: "2026-06-01", to: "2026-12-31" }, ctx);
    expect(r.to).toBe("2026-06-30");
    expect(r.warnings.join(" ")).toMatch(/future/);
  });
  it("entirely future range returns empty without calls", async () => {
    const c = client();
    const r = await runHealthSeries(c, { metric: "steps", from: "2026-08-01", to: "2026-08-31" }, ctx);
    expect(r.groups).toEqual([]);
    expect(c.getChunked).not.toHaveBeenCalled();
  });
  it("warns when no data was found", async () => {
    const r = await runHealthSeries(client(), { metric: "hrv", from: "2026-06-01", to: "2026-06-10" }, ctx);
    expect(r.groups).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/No data/);
  });
  it("rejects daily detail for more than 31 days", async () => {
    await expect(
      runHealthSeries(client(), { metric: "steps", from: "2026-01-01", to: "2026-06-30", daily: true }, ctx),
    ).rejects.toBeInstanceOf(ToolInputError);
  });
  it("returns daily points for short ranges", async () => {
    const c = client({
      getChunked: vi.fn(async () => ({ chunks: [[{ calendarDate: "2026-06-01", totalSteps: 5 }]], reachedDate: null })) as any,
    });
    const r = await runHealthSeries(c, { metric: "steps", from: "2026-06-01", to: "2026-06-10", daily: true }, ctx);
    expect(r.daily).toEqual([{ date: "2026-06-01", value: 5 }]);
  });
  it("reports partial results with reachedDate and a warning", async () => {
    const c = client({
      getChunked: vi.fn(async () => ({
        chunks: [[{ calendarDate: "2026-01-02", totalSteps: 5 }]],
        reachedDate: "2026-01-28",
      })) as any,
    });
    const r = await runHealthSeries(c, { metric: "steps", from: "2026-01-01", to: "2026-06-01" }, ctx);
    expect(r.reachedDate).toBe("2026-01-28");
    expect(r.warnings.join(" ")).toMatch(/2026-01-29/);
  });
  it("adds the key expiry warning", async () => {
    const r = await runHealthSeries(client(), { metric: "steps", from: "2026-06-01", to: "2026-06-02" }, { ...ctx, keyExpires: "2026-07-03" });
    expect(r.warnings.join(" ")).toMatch(/expires in 3 days/);
  });
});

describe("runActivitiesSummary", () => {
  it("aggregates by month and type", async () => {
    const page = [
      { startTimeLocal: "2026-06-01 07:00:00", distance: 10000, duration: 3600, activityType: { typeKey: "running" } },
      { startTimeLocal: "2026-06-03 07:00:00", distance: 5000, duration: 1800, activityType: { typeKey: "running" } },
      { startTimeLocal: "2026-06-04 07:00:00", distance: 20000, duration: 3600, activityType: { typeKey: "cycling" } },
    ];
    const c = client({ get: vi.fn(async () => page) as any });
    const r = await runActivitiesSummary(c, { from: "2026-06-01", to: "2026-06-30" }, ctx);
    expect(r.groups).toEqual([
      { key: "2026-06", count: 3, distanceKm: 35, durationHours: 2.5, byType: { running: 2, cycling: 1 } },
    ]);
    expect(r.reachedDate).toBeNull();
  });
  it("pages until a short page", async () => {
    const full = Array.from({ length: 100 }, () => ({ startTimeLocal: "2026-06-01 07:00:00", distance: 1000, duration: 60, activityType: { typeKey: "running" } }));
    const get = vi.fn().mockResolvedValueOnce(full).mockResolvedValueOnce([full[0]]);
    const r = await runActivitiesSummary(client({ get: get as any }), { from: "2026-06-01", to: "2026-06-30" }, ctx);
    expect(get).toHaveBeenCalledTimes(2);
    expect(r.groups[0].count).toBe(101);
  });
  it("empty and inverted ranges are explicit", async () => {
    const empty = await runActivitiesSummary(client(), { from: "2026-06-01", to: "2026-06-30" }, ctx);
    expect(empty.groups).toEqual([]);
    expect(empty.warnings.join(" ")).toMatch(/No activities/);
    const inv = await runActivitiesSummary(client(), { from: "2026-06-30", to: "2026-06-01" }, ctx);
    expect(inv.warnings.join(" ")).toMatch(/after/);
  });
  it("keeps fetched pages when a later page is rate limited", async () => {
    const full = Array.from({ length: 100 }, () => ({ startTimeLocal: "2026-06-01 07:00:00", distance: 1000, duration: 60, activityType: { typeKey: "running" } }));
    const get = vi
      .fn()
      .mockResolvedValueOnce(full)
      .mockRejectedValueOnce(new GarminError("RATE_LIMITED", "Garmin rate limit reached", 429));
    const r = await runActivitiesSummary(client({ get: get as any }), { from: "2026-01-01", to: "2026-06-30" }, ctx);
    expect(r.groups[0].count).toBe(100);
    expect(r.reachedDate).toBe("2026-06-01");
    expect(r.warnings.join(" ")).toMatch(/Partial/);
  });
  it("rethrows when the very first page fails", async () => {
    const get = vi.fn().mockRejectedValueOnce(new GarminError("RATE_LIMITED", "x", 429));
    await expect(runActivitiesSummary(client({ get: get as any }), { from: "2026-01-01", to: "2026-06-30" }, ctx)).rejects.toBeInstanceOf(GarminError);
  });
  it("stops at the deadline and says how far it got", async () => {
    let t = 0;
    const full = Array.from({ length: 100 }, () => ({ startTimeLocal: "2026-06-01 07:00:00", distance: 1000, duration: 60, activityType: { typeKey: "running" } }));
    const get = vi.fn(async () => {
      t += 6000;
      return full;
    });
    const r = await runActivitiesSummary(client({ get: get as any }), { from: "2026-01-01", to: "2026-06-30" }, { today: ctx.today, now: () => t, deadlineMs: 10_000 });
    expect(get.mock.calls.length).toBeLessThan(5);
    expect(r.reachedDate).not.toBeNull();
    expect(r.warnings.join(" ")).toMatch(/Partial/);
  });
});

describe("runActivitiesList", () => {
  const rows = [
    { activityId: 111, activityName: "Morning Run", startTimeLocal: "2026-03-05 07:00:00", distance: 10000, duration: 3000, activityType: { typeKey: "running" } },
    { activityId: 222, startTimeLocal: "2026-03-02 07:00:00", distance: 5000, duration: 1500, activityType: { typeKey: "running" } },
  ];
  it("returns ids and the essentials, newest first", async () => {
    const get = vi.fn(async () => rows);
    const r = await runActivitiesList(client({ get: get as any }), { from: "2026-03-01", to: "2026-03-31" }, ctx);
    expect(r.activities[0]).toEqual({ id: "111", date: "2026-03-05", name: "Morning Run", type: "running", distanceKm: 10, durationMin: 50 });
    expect(r.activities).toHaveLength(2);
  });
  it("caps the limit at 50 and defaults to 20", async () => {
    const get = vi.fn(async () => rows);
    await runActivitiesList(client({ get: get as any }), { from: "2026-03-01", to: "2026-03-31", limit: 500 }, ctx);
    expect((get.mock.calls[0] as any[])[1].limit).toBe("50");
    await runActivitiesList(client({ get: get as any }), { from: "2026-03-01", to: "2026-03-31" }, ctx);
    expect((get.mock.calls[1] as any[])[1].limit).toBe("20");
  });
  it("empty range is explicit", async () => {
    const r = await runActivitiesList(client(), { from: "2026-03-31", to: "2026-03-01" }, ctx);
    expect(r.activities).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/after/);
  });
});

describe("details", () => {
  it("activity id must be digits", async () => {
    await expect(runActivityDetail(client(), { activityId: "../../x" })).rejects.toBeInstanceOf(ToolInputError);
  });
  it("fetches the activity path", async () => {
    const c = client();
    await runActivityDetail(c, { activityId: "123" });
    expect((c.get as any).mock.calls[0][0]).toBe("/activity-service/activity/123");
  });
  it("daily summary validates the date", async () => {
    await expect(runDailySummary(client(), { date: "yesterday" })).rejects.toBeInstanceOf(ToolInputError);
  });
  it("profile calls the settings endpoint", async () => {
    const c = client();
    await runProfile(c);
    expect((c.get as any).mock.calls[0][0]).toBe("/userprofile-service/userprofile/settings");
  });
});
