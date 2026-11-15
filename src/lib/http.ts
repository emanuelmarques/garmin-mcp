import { loadConfig } from "./config";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
};

export function withCors(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export const originOf = (req: Request) => new URL(req.url).origin;

export const authConfig = () => {
  const c = loadConfig();
  return { signingSecret: c.signingSecret, accessKey: c.accessKey, allowedRedirectHosts: c.allowedRedirectHosts };
};
