import { describe, expect, it } from "vitest";
import { createGarminClient, GarminError } from "@/lib/garmin/client";

const KEY = "SECRETKEY123";

function fakeFetch(opts: { tokenStatus?: number; dataStatus?: number; onData?: () => void } = {}) {
  const calls: Array<{ url: string; auth: string | null; method: string }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ url: u, auth, method: init?.method ?? "GET" });
    if (u.includes("personal-api-key/token")) {
      const status = opts.tokenStatus ?? 200;
      return new Response(JSON.stringify({ access_token: "tok" }), { status });
    }
    opts.onData?.();
    const status = opts.dataStatus ?? 200;
    return new Response(JSON.stringify({ ok: true, url: u }), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("garmin client", () => {
  it("fetches the token once and reuses it", async () => {
    const f = fakeFetch();
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl });
    await c.get("/a");
    await c.get("/b");
    const tokenCalls = f.calls.filter((x) => x.url.includes("personal-api-key/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].auth).toBe(`ApiKey ${KEY}`);
    expect(tokenCalls[0].method).toBe("POST"); // Garmin docs: curl -X POST ... Authorization: ApiKey <key>
    expect(f.calls.filter((x) => x.auth === "Bearer tok")).toHaveLength(2);
  });

  it("accepts the token as plain text (Garmin returns a raw JWT, content-type text/plain)", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const impl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, auth: new Headers(init?.headers).get("authorization") });
      if (u.includes("personal-api-key/token")) {
        return new Response("eyJhbGciOiJ.eyJzdWIiOiJ4In0.c2ln\n", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;
    const c = createGarminClient({ apiKey: KEY, fetchImpl: impl });
    expect(await c.get("/a")).toEqual({ ok: true });
    expect(calls[1].auth).toBe("Bearer eyJhbGciOiJ.eyJzdWIiOiJ4In0.c2ln");
  });

  it("rejects a token response that is empty or has whitespace inside", async () => {
    const mk = (body: string) =>
      createGarminClient({
        apiKey: KEY,
        fetchImpl: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
      });
    for (const body of ["", "   ", "<html> not a token </html>"]) {
      const err = (await mk(body).get("/a").catch((e) => e)) as GarminError;
      expect(err.code).toBe("UPSTREAM");
    }
  });

  it("maps a rejected key to KEY_INVALID without leaking the key", async () => {
    const f = fakeFetch({ tokenStatus: 401 });
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl });
    const err = (await c.get("/a").catch((e) => e)) as GarminError;
    expect(err).toBeInstanceOf(GarminError);
    expect(err.code).toBe("KEY_INVALID");
    expect(err.message).not.toContain(KEY);
  });

  it("maps 429 to RATE_LIMITED", async () => {
    const f = fakeFetch({ dataStatus: 429 });
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl });
    const err = (await c.get("/a").catch((e) => e)) as GarminError;
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("maps other failures to UPSTREAM with status", async () => {
    const f = fakeFetch({ dataStatus: 500 });
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl });
    const err = (await c.get("/a").catch((e) => e)) as GarminError;
    expect(err.code).toBe("UPSTREAM");
    expect(err.status).toBe(500);
  });

  it("requests a new token after 23 hours", async () => {
    let t = 0;
    const f = fakeFetch();
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl, now: () => t });
    await c.get("/a");
    t = 23 * 3600e3 + 1;
    await c.get("/a");
    expect(f.calls.filter((x) => x.url.includes("personal-api-key/token"))).toHaveLength(2);
  });

  it("wraps network failures as UPSTREAM", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const c = createGarminClient({ apiKey: KEY, fetchImpl: impl });
    const err = (await c.get("/a").catch((e) => e)) as GarminError;
    expect(err).toBeInstanceOf(GarminError);
    expect(err.code).toBe("UPSTREAM");
  });

  it("passes a timeout signal to every request", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const impl = (async (url: string | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return new Response(JSON.stringify({ access_token: "tok" }));
    }) as unknown as typeof fetch;
    await createGarminClient({ apiKey: KEY, fetchImpl: impl }).get("/a");
    expect(signals.length).toBe(2);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it("treats 204 / empty body as null", async () => {
    const impl = (async (url: string | URL) =>
      String(url).includes("personal-api-key/token")
        ? new Response(JSON.stringify({ access_token: "tok" }))
        : new Response(null, { status: 204 })) as unknown as typeof fetch;
    const c = createGarminClient({ apiKey: KEY, fetchImpl: impl });
    expect(await c.get("/a")).toBeNull();
  });

  it("getChunked keeps earlier blocks when a later one fails with a network error", async () => {
    let n = 0;
    const base = fakeFetch().impl;
    const impl = (async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("personal-api-key/token") && ++n === 2) throw new TypeError("socket hang up");
      return base(url, init);
    }) as unknown as typeof fetch;
    const c = createGarminClient({ apiKey: KEY, fetchImpl: impl });
    const r = await c.getChunked({
      path: (from, to) => `/x/${from}/${to}`,
      range: { from: "2026-01-01", to: "2026-01-03" },
      maxDays: 1,
      deadlineMs: 60_000,
    });
    expect(r.chunks).toHaveLength(1);
    expect(r.reachedDate).toBe("2026-01-01");
  });

  it("getChunked covers all blocks when time allows", async () => {
    const f = fakeFetch();
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl });
    const r = await c.getChunked({
      path: (from, to) => `/x/${from}/${to}`,
      range: { from: "2026-01-01", to: "2026-01-03" },
      maxDays: 1,
      deadlineMs: 60_000,
    });
    expect(r.chunks).toHaveLength(3);
    expect(r.reachedDate).toBeNull();
  });

  it("getChunked stops at the deadline and reports reachedDate", async () => {
    let t = 0;
    const f = fakeFetch({ onData: () => (t += 600) });
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl, now: () => t });
    const r = await c.getChunked({
      path: (from, to) => `/x/${from}/${to}`,
      range: { from: "2026-01-01", to: "2026-01-03" },
      maxDays: 1,
      deadlineMs: 1000,
    });
    expect(r.chunks).toHaveLength(2);
    expect(r.reachedDate).toBe("2026-01-02");
  });

  it("getChunked returns what it has when a later block is rate limited", async () => {
    let n = 0;
    const f = fakeFetch();
    const base = f.impl;
    const impl = (async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("personal-api-key/token") && ++n === 2) return new Response("{}", { status: 429 });
      return base(url, init);
    }) as unknown as typeof fetch;
    const c = createGarminClient({ apiKey: KEY, fetchImpl: impl });
    const r = await c.getChunked({
      path: (from, to) => `/x/${from}/${to}`,
      range: { from: "2026-01-01", to: "2026-01-03" },
      maxDays: 1,
      deadlineMs: 60_000,
    });
    expect(r.chunks).toHaveLength(1);
    expect(r.reachedDate).toBe("2026-01-01");
  });

  it("getChunked throws when the very first block fails (no silent empty 'partial')", async () => {
    const f = fakeFetch({ dataStatus: 429 });
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl });
    await expect(
      c.getChunked({
        path: (from, to) => `/x/${from}/${to}`,
        range: { from: "2026-01-01", to: "2026-01-03" },
        maxDays: 1,
        deadlineMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("a token request that Garmin answers with 404 is UPSTREAM, not a bad key", async () => {
    const f = fakeFetch({ tokenStatus: 404 });
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl });
    const err = (await c.get("/a").catch((e) => e)) as GarminError;
    expect(err.code).toBe("UPSTREAM");
  });

  it("getChunked propagates KEY_INVALID", async () => {
    const f = fakeFetch({ tokenStatus: 403 });
    const c = createGarminClient({ apiKey: KEY, fetchImpl: f.impl });
    await expect(
      c.getChunked({
        path: (from, to) => `/x/${from}/${to}`,
        range: { from: "2026-01-01", to: "2026-01-02" },
        maxDays: 1,
        deadlineMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: "KEY_INVALID" });
  });
});
