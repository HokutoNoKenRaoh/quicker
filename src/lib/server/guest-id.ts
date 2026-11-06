import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

// A guest's browser in lobbies: a random id in a signed, expiring cookie ("<id>.<expiry unix s>.<HMAC-SHA256>"),
// so every tab of the same browser finds the same seat and nobody can pick another guest's id.

const COOKIE = "quicker_guest";
const TTL_SECONDS = 30 * 24 * 60 * 60;
const PATH = "/api/quicker";

function secret() {
  const s = process.env.QUICKER_GUEST_SECRET;
  if (!s || s.length < 32) throw new Error("QUICKER_GUEST_SECRET must be set (32+ characters).");
  return s;
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(`quicker-guest|${payload}`).digest("base64url");
}

async function readGuestId(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const [id, exp] = payload.split(".");
  return id && exp && Number(exp) > Date.now() / 1000 ? id : null;
}

/** This browser's guest id; a new one (and its cookie) when it has none yet. Call from a route handler. */
export async function guestId(): Promise<string> {
  const known = await readGuestId();
  if (known) return known;
  const id = crypto.randomBytes(18).toString("base64url");
  const payload = `${id}.${Math.floor(Date.now() / 1000) + TTL_SECONDS}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TTL_SECONDS,
    path: PATH,
  });
  return id;
}
