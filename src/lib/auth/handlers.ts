import { randomUUID } from "node:crypto";
import { isRegisteredRedirect, safeEqual, verifyPkce } from "./oauth";
import type { Store } from "./store";
import { signJwt, verifyJwt } from "./tokens";

export type AuthConfig = { signingSecret: string; accessKey: string; allowedRedirectHosts?: string[] };

const CODE_TTL = 300;
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 86400;
const CLIENT_TTL = 365 * 86400;
const LOGIN_WINDOW = 900;
const LOGIN_MAX = 5;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status);

const html = (body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Garmin MCP</title>${body}`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" },
  });

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function protectedResourceMetadata(origin: string) {
  return { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ["header"] };
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

function validRedirect(uri: unknown, allowedHosts?: string[]): uri is string {
  if (typeof uri !== "string") return false;
  try {
    const u = new URL(uri);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (!(u.protocol === "https:" || (u.protocol === "http:" && local))) return false;
    return !allowedHosts || local || allowedHosts.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function register(req: Request, cfg: AuthConfig): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON");
  }
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => validRedirect(u, cfg.allowedRedirectHosts))) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be https (or localhost http) URLs on an allowed host");
  }
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 80) : "MCP client";
  const clientId = await signJwt(cfg.signingSecret, "client", { redirectUris: uris, name }, CLIENT_TTL);
  return json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

type AuthParams = {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  clientName: string;
};

/** Validates authorization request parameters. Returns an error Response, never redirects on error. */
async function parseAuthRequest(get: (k: string) => string | null, cfg: AuthConfig): Promise<AuthParams | Response> {
  const clientId = get("client_id") ?? "";
  const redirectUri = get("redirect_uri") ?? "";
  let client;
  try {
    client = await verifyJwt(cfg.signingSecret, "client", clientId);
  } catch {
    return html("<p>Invalid client.</p>", 400);
  }
  const uris = (client.redirectUris as string[]) ?? [];
  if (!isRegisteredRedirect({ redirectUris: uris }, redirectUri)) {
    return html("<p>Redirect URI is not registered for this client.</p>", 400);
  }
  if (get("response_type") !== "code") return html("<p>Unsupported response_type.</p>", 400);
  const challenge = get("code_challenge") ?? "";
  if (get("code_challenge_method") !== "S256" || !challenge) {
    return html("<p>PKCE with S256 is required.</p>", 400);
  }
  return { clientId, redirectUri, state: get("state") ?? "", challenge, clientName: String(client.name ?? "MCP client") };
}

function loginForm(p: AuthParams, error?: string, status = 200) {
  const hidden = (n: string, v: string) => `<input type="hidden" name="${n}" value="${esc(v)}">`;
  return html(
    `<style>body{font-family:system-ui;max-width:24rem;margin:4rem auto;padding:0 1rem}input,button{font:inherit;padding:.5rem;width:100%;box-sizing:border-box;margin:.25rem 0}</style>
<h1>Garmin MCP</h1>
<p><strong>${esc(p.clientName)}</strong> wants to read your Garmin data.</p>
<p>After you authorize, this will send you back to <strong>${esc(new URL(p.redirectUri).hostname)}</strong>. If you do not recognize that site, close this page.</p>
${error ? `<p role="alert" style="color:#b00">${esc(error)}</p>` : ""}
<form method="post">
${hidden("client_id", p.clientId)}${hidden("redirect_uri", p.redirectUri)}${hidden("response_type", "code")}${hidden("code_challenge", p.challenge)}${hidden("code_challenge_method", "S256")}${hidden("state", p.state)}
<label>Access key<input type="password" name="access_key" autocomplete="current-password" required autofocus></label>
<button type="submit">Authorize</button>
</form>`,
    status,
  );
}

export async function authorizeGet(req: Request, cfg: AuthConfig): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const p = await parseAuthRequest((k) => q.get(k), cfg);
  return p instanceof Response ? p : loginForm(p);
}

export async function authorizePost(req: Request, cfg: AuthConfig, store: Store): Promise<Response> {
  const form = new URLSearchParams(await req.text());
  const p = await parseAuthRequest((k) => form.get(k), cfg);
  if (p instanceof Response) return p;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!(await store.hit(`login:${ip}`, LOGIN_WINDOW, LOGIN_MAX))) {
    return loginForm(p, "Too many attempts. Try again later.", 429);
  }
  if (!safeEqual(form.get("access_key") ?? "", cfg.accessKey)) {
    return loginForm(p, "Wrong access key.", 401);
  }
  const code = await signJwt(
    cfg.signingSecret,
    "code",
    { jti: randomUUID(), clientId: p.clientId, redirectUri: p.redirectUri, challenge: p.challenge },
    CODE_TTL,
  );
  const target = new URL(p.redirectUri);
  target.searchParams.set("code", code);
  if (p.state) target.searchParams.set("state", p.state);
  return new Response(null, { status: 302, headers: { location: target.toString(), "cache-control": "no-store" } });
}

async function issueTokens(cfg: AuthConfig, clientId: string) {
  return {
    access_token: await signJwt(cfg.signingSecret, "access", { sub: "owner", clientId }, ACCESS_TTL),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: await signJwt(cfg.signingSecret, "refresh", { sub: "owner", clientId }, REFRESH_TTL),
  };
}

export async function tokenEndpoint(req: Request, cfg: AuthConfig, store: Store): Promise<Response> {
  const form = new URLSearchParams(await req.text());
  const grant = form.get("grant_type");

  if (grant === "authorization_code") {
    let code;
    try {
      code = await verifyJwt(cfg.signingSecret, "code", form.get("code") ?? "");
    } catch {
      return oauthError("invalid_grant", "Invalid or expired code");
    }
    if (
      code.clientId !== form.get("client_id") ||
      code.redirectUri !== form.get("redirect_uri") ||
      !verifyPkce(form.get("code_verifier") ?? "", String(code.challenge))
    ) {
      return oauthError("invalid_grant", "Code does not match this request");
    }
    if (!(await store.consumeOnce(String(code.jti), CODE_TTL))) {
      return oauthError("invalid_grant", "Code already used");
    }
    return json(await issueTokens(cfg, String(code.clientId)));
  }

  if (grant === "refresh_token") {
    try {
      const r = await verifyJwt(cfg.signingSecret, "refresh", form.get("refresh_token") ?? "");
      return json(await issueTokens(cfg, String(r.clientId)));
    } catch {
      return oauthError("invalid_grant", "Invalid or expired refresh token");
    }
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}
