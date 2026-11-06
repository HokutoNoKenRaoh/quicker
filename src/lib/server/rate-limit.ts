import "server-only";

// In-memory fixed-window rate limit (single process; resets on restart).
const windows = new Map<string, { count: number; resetAt: number }>();

/** true when `key` may make another `action` request: at most `limit` per `minutes`. */
export function checkRateLimit(key: string, action: string, limit: number, minutes: number): boolean {
  const now = Date.now();
  const id = `${action}|${key}`;
  const w = windows.get(id);
  if (!w || w.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + minutes * 60_000 });
    if (windows.size > 50_000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}
