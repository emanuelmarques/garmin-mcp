# Garmin MCP

A remote MCP server (hosted on Vercel) that gives Claude and ChatGPT **read-only** access to your Garmin Connect data, focused on history (trends in sleep, HRV, steps, weight, activities…). It uses the [Garmin Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api). Personal use only: a single user.

Design: [docs/superpowers/specs/2026-11-15-garmin-mcp-design.md](docs/superpowers/specs/2026-11-15-garmin-mcp-design.md) (written in Portuguese)

## 1. Verified against a real account

The health and activity endpoints were written from Garmin's Swagger list and then checked against a real Garmin account: profile, steps, sleep, HRV, stress, Body Battery, weight, the activity list and summaries, and the daily summary all returned data. Hydration returned none for that account. Other accounts may differ, for example in the maximum range each endpoint accepts or in the response fields.

To re-check the response shapes against your own account, run this once in your terminal (it makes no changes):

```powershell
$env:GARMIN_API_KEY="<your Garmin key>"; npm run spike
```

It writes `docs/garmin-api-findings.md` (response shapes only, no personal values). If something differs, adjust `src/lib/garmin/metrics.ts` (`path`, `query`, `maxDays`, `extract`) and `src/lib/tools/activities.ts` / `details.ts` (parameters marked `UNVERIFIED`).

## 2. Environment variables

| Variable | What it is |
|---|---|
| `GARMIN_API_KEY` | Key from https://connect.garmin.com/app/settings/personalApiToken |
| `ACCESS_KEY` | Password for the OAuth login, **at least 20 random characters** (this is your main defense) |
| `ALLOWED_REDIRECT_HOSTS` | Recommended, e.g. `claude.ai,claude.com,chatgpt.com`. Without it, anyone can register a client pointing at their own site and try to trick you on the login page |
| `SIGNING_SECRET` | Secret used to sign tokens, at least 32 random characters |
| `GARMIN_KEY_EXPIRES` | Optional, `YYYY-MM-DD`: warns 14 days before your Garmin key expires |

Generate a random secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Never put real values in `.env.example`. For local runs use `.env.local`, which git ignores.

## 3. Deploy to Vercel

```bash
npm i -g vercel
vercel link
vercel env add GARMIN_API_KEY production
vercel env add ACCESS_KEY production
vercel env add SIGNING_SECRET production
vercel env add ALLOWED_REDIRECT_HOSTS production
vercel --prod
```

Do not enable "Deployment Protection" on the production URL: it would block the remote clients that need to reach `/authorize`, `/token` and `/mcp`.

## 4. Connect your clients

The MCP endpoint is `https://<your-project>.vercel.app/mcp`. The first time you connect, a page on your own server opens: enter your `ACCESS_KEY` once.

- **Claude Code:** `claude mcp add --transport http garmin https://<your-project>.vercel.app/mcp`, then run `/mcp` to authenticate.
- **claude.ai / desktop / mobile:** Settings → Connectors → Add custom connector → the URL above.
- **ChatGPT:** Settings → Connectors → developer mode → add a remote MCP server with the URL above (OAuth authentication).

## Tools

`get_health_series`, `get_activities_summary`, `list_activities`, `get_activity`, `get_daily_summary`, `get_profile` (all read-only).

## Security notes and limits

- The Garmin key, `ACCESS_KEY` and `SIGNING_SECRET` exist only as environment variables.
- Login codes are single-use **only within the same instance** and last 5 minutes, protected by PKCE. The login attempt limit is also per instance, in memory (weak on serverless), so `ACCESS_KEY` must be strong. For strict guarantees, implement the `Store` interface (`src/lib/auth/store.ts`) with Redis/KV.
- Old per-deployment URLs (`*.vercel.app`) keep serving the old code with the same variables; delete old deployments or protect the non-production URLs.
- Rotating `SIGNING_SECRET` invalidates all sessions. When your Garmin key expires, generate a new one and update `GARMIN_API_KEY` (and `GARMIN_KEY_EXPIRES`).
- Assumed plan: Hobby. Very long requests return a partial result with `reachedDate`.

## Development

```bash
npm install
npm test
npm run build
```
