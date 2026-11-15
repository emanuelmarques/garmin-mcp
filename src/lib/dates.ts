const DAY_MS = 864e5;

/** Parses YYYY-MM-DD as a UTC midnight timestamp (no timezone effects). */
export function toMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fromMs(toMs(date) + n * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

/** Consecutive inclusive blocks of at most maxDays days. [] when from > to. */
export function splitRange(from: string, to: string, maxDays: number): Array<{ from: string; to: string }> {
  if (from > to) return [];
  const blocks: Array<{ from: string; to: string }> = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, maxDays - 1);
    blocks.push({ from: start, to: end < to ? end : to });
    start = addDays(start, maxDays);
  }
  return blocks;
}

/** Monday of the ISO week containing date. */
export function isoWeekStart(date: string): string {
  const dow = (new Date(toMs(date)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}

export function isoWeekKey(date: string): string {
  // ISO week-year is the year of the Thursday of that week.
  const thursday = addDays(isoWeekStart(date), 3);
  const year = Number(thursday.slice(0, 4));
  const jan1 = `${year}-01-01`;
  const week = Math.floor(daysBetween(jan1, thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function monthBounds(date: string): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}
