import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryStore } from "@/lib/auth/store";
import { verifyJwt } from "@/lib/auth/tokens";
import {
  authorizeGet,
  authorizePost,
  register,
  tokenEndpoint,
  authServerMetadata,
  protectedResourceMetadata,
} from "@/lib/auth/handlers";

const cfg = { signingSecret: "s".repeat(32), accessKey: "open-sesame" };
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(50);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const ORIGIN = "https://garmin.example.com";

async function registerClient(uris = [REDIRECT]) {
  const res = await register(
    new Request(`${ORIGIN}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: uris, client_name: "Claude" }),
    }),
    cfg,
  );
  return { res, body: (await res.json()) as Record<string, any> };
}

const authQuery = (clientId: string, over: Record<string, string> = {}) =>
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
    ...over,
  });

const post = (url: string, params: URLSearchParams, ip = "1.1.1.1") =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    body: params,
  });

async function login(clientId: string, store: MemoryStore, key = "open-sesame", over: Record<string, string> = {}) {
  const p = authQuery(clientId, over);
  p.set("access_key", key);
  return authorizePost(post(`${ORIGIN}/authorize`, p), cfg, store);
}

async function getCode(clientId: string, store: MemoryStore) {
  const res = await login(clientId, store);
  expect(res.status).toBe(302);
  return new URL(res.headers.get("location")!).searchParams;
}

const exchange = (store: MemoryStore, clientId: string, code: string, verifier = VERIFIER, redirect = REDIRECT) =>
  tokenEndpoint(
    post(
      `${ORIGIN}/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        client_id: clientId,
      }),
    ),
    cfg,
    store,
  );

describe("metadata", () => {
  it("advertises endpoints under the request origin", () => {
    const m = authServerMetadata(ORIGIN) as any;
    expect(m.issuer).toBe(ORIGIN);
    expect(m.token_endpoint).toBe(`${ORIGIN}/token`);
    expect(m.registration_endpoint).toBe(`${ORIGIN}/register`);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    const r = protectedResourceMetadata(ORIGIN) as any;
    expect(r.resource).toBe(`${ORIGIN}/mcp`);
    expect(r.authorization_servers).toEqual([ORIGIN]);
  });
});

describe("registration", () => {
  it("issues a signed client_id", async () => {
    const { res, body } = await registerClient();
    expect(res.status).toBe(201);
    const claims = await verifyJwt(cfg.signingSecret, "client", body.client_id);
    expect(claims.redirectUris).toEqual([REDIRECT]);
  });
  it("rejects empty or invalid redirect_uris", async () => {
    expect((await registerClient([])).res.status).toBe(400);
    expect((await registerClient(["not a url"])).res.status).toBe(400);
    expect((await registerClient(["http://evil.example/cb"])).res.status).toBe(400);
  });
});

describe("phishing defenses", () => {
  it("shows the redirect host on the consent page", async () => {
    const { body } = await registerClient();
    const form = await authorizeGet(new Request(`${ORIGIN}/authorize?${authQuery(body.client_id)}`), cfg);
    expect(await form.text()).toContain("<strong>claude.ai</strong>");
  });
  it("rejects registration for hosts outside the allowlist", async () => {
    const strict = { ...cfg, allowedRedirectHosts: ["claude.ai", "chatgpt.com"] };
    const mk = (uri: string) =>
      register(
        new Request(`${ORIGIN}/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ redirect_uris: [uri], client_name: "Claude" }),
        }),
        strict,
      );
    expect((await mk("https://evil.example/cb")).status).toBe(400);
    expect((await mk("https://claude.ai/api/mcp/auth_callback")).status).toBe(201);
    expect((await mk("https://sub.claude.ai/cb")).status).toBe(400);
  });
});

describe("authorize + token flow", () => {
  it("completes end to end", async () => {
    const store = new MemoryStore();
    const { body } = await registerClient();
    const form = await authorizeGet(new Request(`${ORIGIN}/authorize?${authQuery(body.client_id)}`), cfg);
    expect(form.status).toBe(200);
    expect(await form.text()).toContain("access_key");

    const q = await getCode(body.client_id, store);
    expect(q.get("state")).toBe("xyz");
    const res = await exchange(store, body.client_id, q.get("code")!);
    expect(res.status).toBe(200);
    const t = (await res.json()) as any;
    expect(t.token_type).toBe("Bearer");
    await verifyJwt(cfg.signingSecret, "access", t.access_token);
    await verifyJwt(cfg.signingSecret, "refresh", t.refresh_token);
  });

  it("refresh_token grant returns a new access token", async () => {
    const store = new MemoryStore();
    const { body } = await registerClient();
    const q = await getCode(body.client_id, store);
    const t = (await (await exchange(store, body.client_id, q.get("code")!)).json()) as any;
    const res = await tokenEndpoint(
      post(`${ORIGIN}/token`, new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: body.client_id })),
      cfg,
      store,
    );
    expect(res.status).toBe(200);
    await verifyJwt(cfg.signingSecret, "access", ((await res.json()) as any).access_token);
  });

  it("refresh_token grant rejects an access token", async () => {
    const store = new MemoryStore();
    const { body } = await registerClient();
    const q = await getCode(body.client_id, store);
    const t = (await (await exchange(store, body.client_id, q.get("code")!)).json()) as any;
    const res = await tokenEndpoint(
      post(`${ORIGIN}/token`, new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.access_token, client_id: body.client_id })),
      cfg,
      store,
    );
    expect(res.status).toBe(400);
  });

  it("wrong access key: 401 and no code", async () => {
    const store = new MemoryStore();
    const { body } = await registerClient();
    const res = await login(body.client_id, store, "nope");
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("unregistered redirect_uri: 400, never redirects", async () => {
    const { body } = await registerClient();
    const res = await authorizeGet(
      new Request(`${ORIGIN}/authorize?${authQuery(body.client_id, { redirect_uri: "https://evil.example/cb" })}`),
      cfg,
    );
    expect(res.status).toBe(400);
    const res2 = await login(body.client_id, new MemoryStore(), "open-sesame", { redirect_uri: "https://evil.example/cb" });
    expect(res2.status).toBe(400);
    expect(res2.headers.get("location")).toBeNull();
  });

  it("forged client_id: 400", async () => {
    const res = await authorizeGet(new Request(`${ORIGIN}/authorize?${authQuery("garbage")}`), cfg);
    expect(res.status).toBe(400);
  });

  it("rejects non-S256 challenge methods", async () => {
    const { body } = await registerClient();
    const res = await authorizeGet(
      new Request(`${ORIGIN}/authorize?${authQuery(body.client_id, { code_challenge_method: "plain" })}`),
      cfg,
    );
    expect(res.status).toBe(400);
  });

  it("wrong code_verifier: invalid_grant", async () => {
    const store = new MemoryStore();
    const { body } = await registerClient();
    const q = await getCode(body.client_id, store);
    const res = await exchange(store, body.client_id, q.get("code")!, "w".repeat(50));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("invalid_grant");
  });

  it("a code can be used only once", async () => {
    const store = new MemoryStore();
    const { body } = await registerClient();
    const q = await getCode(body.client_id, store);
    expect((await exchange(store, body.client_id, q.get("code")!)).status).toBe(200);
    const again = await exchange(store, body.client_id, q.get("code")!);
    expect(again.status).toBe(400);
    expect(((await again.json()) as any).error).toBe("invalid_grant");
  });

  it("redirect_uri at /token must match the one in the code", async () => {
    const store = new MemoryStore();
    const { body } = await registerClient([REDIRECT, "https://chatgpt.com/connector/oauth/abc"]);
    const q = await getCode(body.client_id, store);
    const res = await exchange(store, body.client_id, q.get("code")!, VERIFIER, "https://chatgpt.com/connector/oauth/abc");
    expect(res.status).toBe(400);
  });

  it("limits login attempts per IP (429 after 5)", async () => {
    const store = new MemoryStore();
    const { body } = await registerClient();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await login(body.client_id, store, "bad")).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
