/**
 * Spike: probes the Garmin Personal API with the REAL key.
 * Run by the user:  GARMIN_API_KEY=... npx tsx scripts/spike.ts
 * (PowerShell: $env:GARMIN_API_KEY="..."; npx tsx scripts/spike.ts)
 * Writes docs/garmin-api-findings.md with response SHAPES only (keys/types, no values).
 */
import { writeFileSync } from "node:fs";

const BASE = "https://personal.connectapi.garmin.com";
const key = process.env.GARMIN_API_KEY;
if (!key) {
  console.error("Set GARMIN_API_KEY first.");
  process.exit(1);
}

const day = (offset: number) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);

function shape(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length ? [`len=${v.length}`, shape(v[0], depth + 1)] : [];
  if (v && typeof v === "object") {
    if (depth > 3) return "{…}";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return v === null ? "null" : typeof v;
}

async function token(): Promise<string> {
  const r = await fetch(`${BASE}/personalapitoken-service/personal-api/personal-api-key/token`, {
    method: "POST",
    headers: { Authorization: `ApiKey ${key}` },
  });
  if (!r.ok) throw new Error(`token request failed: HTTP ${r.status}`);
  const raw = (await r.text()).trim();
  let t: string | undefined = raw;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    t = (j.access_token ?? j.accessToken ?? j.token) as string | undefined;
  } catch {}
  if (!t || /\s/.test(t)) throw new Error("token response was not a token");
  return t;
}

type Probe = { name: string; path: (from: string, to: string) => string };
const probes: Probe[] = [
  { name: "steps", path: (f, t) => `/usersummary-service/stats/steps/daily/${f}/${t}` },
  { name: "stress", path: (f, t) => `/usersummary-service/stats/stress/daily/${f}/${t}` },
  { name: "hydration", path: (f, t) => `/usersummary-service/stats/hydration/daily/${f}/${t}` },
  { name: "hrv", path: (f, t) => `/hrv-service/hrv/daily/${f}/${t}` },
  { name: "weight-range", path: (f, t) => `/weight-service/weight/range/${f}/${t}` },
  { name: "weight-all", path: (f, t) => `/weight-service/weight/all/${f}/${t}` },
  { name: "sleep-summaries", path: (f, t) => `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${f}&endDate=${t}` },
  { name: "dailysummaries-v2", path: (f, t) => `/usersummary-service/v2/dailysummaries?startDate=${f}&endDate=${t}` },
  { name: "bodyBattery", path: (f, t) => `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${f}&endDate=${t}` },
  { name: "dailyHeartRate", path: (_f, t) => `/wellness-service/wellness/dailyHeartRate?date=${t}` },
  { name: "activities-search", path: () => `/activitylist-service/activities/search/activities?start=0&limit=5` },
  { name: "activity-range", path: (f, t) => `/wellnessactivity-service/activity/summary/range/${f}/${t}` },
  { name: "profile", path: () => `/userprofile-service/userprofile/settings` },
];

const t = await token();
let md = `# Garmin Personal API — findings (${day(0)})\n\nShapes only; no personal values.\n`;

for (const p of probes) {
  for (const days of [7, 400]) {
    const from = day(days);
    const to = day(1);
    const t0 = Date.now();
    let line: string;
    try {
      const r = await fetch(BASE + p.path(from, to), { headers: { Authorization: `Bearer ${t}` } });
      const ms = Date.now() - t0;
      const text = await r.text();
      let body: unknown = text.slice(0, 120);
      try {
        body = shape(JSON.parse(text));
      } catch {}
      line = `- HTTP ${r.status}, ${ms} ms, ${text.length} bytes\n\n\`\`\`json\n${JSON.stringify(body, null, 1).slice(0, 1500)}\n\`\`\``;
    } catch (e) {
      line = `- ERROR ${(e as Error).message}`;
    }
    md += `\n## ${p.name} — ${days} days (${from}..${to})\n\nPath: \`${p.path(from, to).replace(/\d{4}-\d{2}-\d{2}/g, "<date>")}\`\n${line}\n`;
  }
}

writeFileSync("docs/garmin-api-findings.md", md);
console.log("Wrote docs/garmin-api-findings.md");
