import "server-only";
import { headers } from "next/headers";

// The client's address, for the per-network limits. Behind a reverse proxy set QUICKER_TRUST_PROXY=true so the
// proxy's X-Real-IP (or the first X-Forwarded-For entry) is used; without it every request is "unknown" and the
// per-network limits are skipped (a browser could otherwise forge the header).
export async function getClientIp(): Promise<string> {
  if (process.env.QUICKER_TRUST_PROXY !== "true") return "unknown";
  const h = await headers();
  const ip = h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip && ip.length <= 64 ? ip : "unknown";
}
