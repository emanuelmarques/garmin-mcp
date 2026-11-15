/**
 * Small state surface the auth layer needs. The in-memory implementation is per serverless
 * instance (weak on Vercel); swap in Redis/KV behind this interface for strict guarantees.
 */
export interface Store {
  /** true only the first time `id` is seen within ttlSec. */
  consumeOnce(id: string, ttlSec: number): Promise<boolean>;
  /** Records an attempt; false once more than `max` attempts happened within windowSec. */
  hit(key: string, windowSec: number, max: number): Promise<boolean>;
}

export class MemoryStore implements Store {
  private seen = new Map<string, number>();
  private hits = new Map<string, number[]>();

  constructor(private now: () => number = Date.now) {}

  async consumeOnce(id: string, ttlSec: number): Promise<boolean> {
    const t = this.now();
    for (const [k, exp] of this.seen) if (exp <= t) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, t + ttlSec * 1000);
    return true;
  }

  async hit(key: string, windowSec: number, max: number): Promise<boolean> {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => x > t - windowSec * 1000);
    recent.push(t);
    this.hits.set(key, recent);
    return recent.length <= max;
  }
}

let shared: Store | undefined;
/** Process-wide store used by the routes. */
export function getStore(): Store {
  return (shared ??= new MemoryStore());
}
