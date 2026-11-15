import { splitRange } from "../dates";

const BASE = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const TOKEN_TTL_MS = 23 * 3600e3; // Garmin tokens last 24 h; renew early
const REQUEST_TIMEOUT_MS = 10_000; // keeps one hung call from eating the whole function budget

export class GarminError extends Error {
  constructor(
    public code: "KEY_INVALID" | "RATE_LIMITED" | "UPSTREAM",
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "GarminError";
  }
}

export type ChunkedArgs = {
  path: (from: string, to: string) => string;
  query?: (from: string, to: string) => Record<string, string>;
  range: { from: string; to: string };
  maxDays: number;
  deadlineMs: number;
};

export type GarminClient = {
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  getChunked<T>(args: ChunkedArgs): Promise<{ chunks: T[]; reachedDate: string | null }>;
};

export function createGarminClient(opts: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): GarminClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;

  /** fetch with a per-request timeout; network errors and timeouts become GarminError("UPSTREAM"). */
  async function call(url: string, authorization: string, method: "GET" | "POST" = "GET"): Promise<Response> {
    try {
      return await doFetch(url, { method, headers: { Authorization: authorization }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new GarminError("UPSTREAM", "Could not reach Garmin (network error or timeout)");
    }
  }

  /** Parses a JSON body; an empty body (e.g. 204) is null; anything else unparseable is UPSTREAM. */
  async function readJson<T>(r: Response): Promise<T> {
    let text: string;
    try {
      text = await r.text();
    } catch {
      throw new GarminError("UPSTREAM", "Could not read Garmin response", r.status);
    }
    if (!text.trim()) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GarminError("UPSTREAM", "Garmin returned a non-JSON response", r.status);
    }
  }

  async function token(): Promise<string> {
    if (cached && now() < cached.expiresAt) return cached.token;
    // Per Garmin's docs the token request is a POST (a GET answers 404).
    const r = await call(BASE + TOKEN_PATH, `ApiKey ${opts.apiKey}`, "POST");
    if (r.status === 401 || r.status === 403) {
      throw new GarminError("KEY_INVALID", "Garmin key invalid or expired", r.status);
    }
    if (!r.ok) throw new GarminError("UPSTREAM", `Garmin token request failed (HTTP ${r.status})`, r.status);
    // Garmin returns the token as a raw JWT with content-type text/plain; accept JSON too.
    let raw = "";
    try {
      raw = (await r.text()).trim();
    } catch {
      /* handled below */
    }
    let t: string | undefined = raw;
    try {
      const j = JSON.parse(raw) as unknown;
      t = typeof j === "string" ? j : ((j as Record<string, unknown> | null)?.access_token ?? (j as Record<string, unknown> | null)?.accessToken ?? (j as Record<string, unknown> | null)?.token) as string | undefined;
    } catch {
      /* not JSON: keep the raw text */
    }
    if (!t || /\s/.test(t)) throw new GarminError("UPSTREAM", "Garmin token response was not a token");
    cached = { token: t, expiresAt: now() + TOKEN_TTL_MS };
    return t;
  }

  async function get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
    const url = BASE + path + qs;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await call(url, `Bearer ${await token()}`);
      if (r.status === 401 && attempt === 0) {
        cached = null; // token may have been revoked early; retry once with a fresh one
        continue;
      }
      if (r.status === 401 || r.status === 403) {
        throw new GarminError("KEY_INVALID", "Garmin key invalid or expired", r.status);
      }
      if (r.status === 429) throw new GarminError("RATE_LIMITED", "Garmin rate limit reached", 429);
      if (!r.ok) throw new GarminError("UPSTREAM", `Garmin request failed (HTTP ${r.status})`, r.status);
      return readJson<T>(r);
    }
    throw new GarminError("KEY_INVALID", "Garmin key invalid or expired", 401);
  }

  async function getChunked<T>(a: ChunkedArgs) {
    const start = now();
    const chunks: T[] = [];
    let reached: string | null = null;
    const blocks = splitRange(a.range.from, a.range.to, a.maxDays);
    for (const b of blocks) {
      if (now() - start >= a.deadlineMs) break;
      try {
        chunks.push(await get<T>(a.path(b.from, b.to), a.query?.(b.from, b.to)));
      } catch (e) {
        // Keep earlier blocks on a transient failure; if nothing succeeded yet, surface the error.
        if (e instanceof GarminError && e.code !== "KEY_INVALID" && chunks.length > 0) break;
        throw e;
      }
      reached = b.to;
    }
    const complete = blocks.length > 0 && reached === blocks[blocks.length - 1].to;
    return {
      chunks,
      reachedDate: complete || blocks.length === 0 ? null : reached,
    };
  }

  return { get, getChunked };
}
