import { beforeAll, describe, expect, it } from "vitest";
import { signJwt } from "@/lib/auth/tokens";

const SECRET = "s".repeat(32);
let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  process.env.GARMIN_API_KEY = "g";
  process.env.ACCESS_KEY = "k".repeat(20);
  process.env.SIGNING_SECRET = SECRET;
  ({ POST } = await import("@/app/mcp/route"));
});

const rpc = (method: string, params: unknown, id: number, bearer?: string) =>
  new Request("https://garmin.example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

const init = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "0" },
};

describe("/mcp authentication", () => {
  it("rejects requests without a bearer, pointing to the metadata", async () => {
    const res = await POST(rpc("initialize", init, 1));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/resource_metadata=".*\/\.well-known\/oauth-protected-resource"/);
  });
  it("rejects a refresh token used as bearer", async () => {
    const t = await signJwt(SECRET, "refresh", { clientId: "c" }, 60);
    expect((await POST(rpc("initialize", init, 1, t))).status).toBe(401);
  });
  it("rejects a token signed with another secret", async () => {
    const t = await signJwt("z".repeat(32), "access", { clientId: "c" }, 60);
    expect((await POST(rpc("initialize", init, 1, t))).status).toBe(401);
  });
  it("rejects an expired access token", async () => {
    const t = await signJwt(SECRET, "access", { clientId: "c" }, -5);
    expect((await POST(rpc("initialize", init, 1, t))).status).toBe(401);
  });
  it("accepts a valid access token and lists the tools", async () => {
    const t = await signJwt(SECRET, "access", { clientId: "c" }, 60);
    const res = await POST(rpc("tools/list", {}, 2, t));
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const name of ["get_health_series", "get_activities_summary", "list_activities", "get_activity", "get_daily_summary", "get_profile"]) {
      expect(text).toContain(name);
    }
  });
});
