import { getClientIp } from "@/lib/server/client-ip";
import { openLobbies } from "@/lib/server/registry";
import { fail, json } from "@/lib/server/http";

// "Açık lobiler": the public lobbies waiting for players (GET; the page polls it while the list is open, the button's
// count less often). Only what the list shows; joining goes through the lobby's own link. An in-memory limit per IP.

export const dynamic = "force-dynamic";

const PER_MINUTE = 30;
const g = globalThis as unknown as { __quickerListHits?: Map<string, number[]> };
const hits = () => (g.__quickerListHits ??= new Map<string, number[]>());

function limitOk(ip: string, now = Date.now()) {
  const map = hits();
  const recent = (map.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_MINUTE) return false;
  recent.push(now);
  map.set(ip, recent);
  // Old entries go now and then, so the map can't grow without bound.
  if (map.size > 5000) for (const [k, v] of map) if (!v.some((t) => now - t < 60_000)) map.delete(k);
  return true;
}

export async function GET() {
  const ip = await getClientIp();
  if (ip !== "unknown" && !limitOk(ip)) return fail("Çok sık yenilendi. Biraz bekle.", 429);
  return json({ ok: true, lobbies: openLobbies() });
}
