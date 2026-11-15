import { GarminError } from "../garmin/client";
import { daysBetween } from "../dates";

export class ToolInputError extends Error {}

export type ToolCtx = { today: string; now?: () => number; deadlineMs?: number; keyExpires?: string };

export const todayUtc = () => new Date().toISOString().slice(0, 10);

export function assertDate(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ToolInputError(`${name} must be a date in YYYY-MM-DD format`);
  }
}

/** Warns when the Garmin key is about to expire (or has). Empty when unset or far away. */
export function expiryWarning(expires: string | undefined, today: string): string[] {
  if (!expires) return [];
  const days = daysBetween(today, expires);
  if (days < 0) return [`The Garmin API key expired on ${expires}. Generate a new key and update GARMIN_API_KEY.`];
  if (days <= 14) return [`The Garmin API key expires in ${days} days (${expires}). Generate a new key soon.`];
  return [];
}

/** Shrinks arbitrary Garmin JSON: depth-limited, arrays capped, total size capped. */
export function slim(value: unknown, maxChars = 12_000): unknown {
  const walk = (v: unknown, depth: number): unknown => {
    if (Array.isArray(v)) {
      const items = v.slice(0, 20).map((x) => walk(x, depth + 1));
      return v.length > 20 ? [...items, `… ${v.length - 20} more`] : items;
    }
    if (v && typeof v === "object") {
      if (depth >= 3) return "{…}";
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)]));
    }
    return v;
  };
  const out = walk(value, 0);
  const text = JSON.stringify(out);
  return text.length > maxChars ? { truncated: true, preview: text.slice(0, maxChars) } : out;
}

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

/** Runs a tool body and converts results and known errors into MCP tool results. */
export async function asToolResult(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return text(JSON.stringify(await fn()));
  } catch (e) {
    if (e instanceof ToolInputError) return text(e.message, true);
    if (e instanceof GarminError) {
      if (e.code === "KEY_INVALID") {
        return text("Garmin key invalid or expired. Generate a new Personal API key and update GARMIN_API_KEY.", true);
      }
      if (e.code === "RATE_LIMITED") return text("Garmin rate limit reached. Try again later or use a smaller range.", true);
      return text(e.message, true);
    }
    return text("Unexpected server error.", true);
  }
}
