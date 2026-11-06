import "server-only";
import { z } from "zod";
import { letterAvatar } from "@/lib/avatar";
import { BOT_LEVEL_KEYS, DEFAULT_QUESTIONS, MAX_RACERS, isQuestionCount, type BotLevel, type QuestionCount } from "@/lib/engine";
import { getClientIp } from "./client-ip";
import { guestId } from "./guest-id";
import { checkRateLimit } from "./rate-limit";
import { findRoom, memberOf, newMember } from "./registry";

// Shared by the route handlers (src/app/api/quicker/*): who is playing, limits, and JSON replies.

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (message: string, status = 400) => json({ ok: false, message }, status);

export const botLevelsSchema = z.array(z.enum(BOT_LEVEL_KEYS as [BotLevel, ...BotLevel[]])).max(MAX_RACERS - 1);
/** One of QUESTION_COUNTS (10–30); left out = the default. */
export const questionCountSchema = z.custom<QuestionCount>(isQuestionCount);
export const optionalQuestionCount = questionCountSchema.optional().transform((n): QuestionCount => n ?? DEFAULT_QUESTIONS);

/** The person making the request: always a guest ("Guest"), known again by the browser's signed cookie. */
export async function currentPlayer() {
  const [ip, browser] = await Promise.all([getClientIp(), guestId()]);
  return {
    ip,
    browser,
    member: () => newMember({ name: "Guest", avatar: letterAvatar("Guest"), ip, guestKey: browser }),
  };
}

/** New races / lobbies: per IP (in memory, server/rate-limit.ts); an unknown address isn't limited. */
export function startLimitOk(ip: string) {
  return ip === "unknown" || checkRateLimit(ip, "quicker:start", 40, 10);
}

/** Joining by code: per IP, so lobby codes can't be guessed by trying many. */
export function joinLimitOk(ip: string) {
  return ip === "unknown" || checkRateLimit(ip, "quicker:join", 30, 10);
}

/** The room and the person a secret racer token belongs to. */
export function roomAndMember(roomId: unknown, token: unknown) {
  if (typeof roomId !== "string" || typeof token !== "string" || roomId.length > 40 || token.length > 64) return null;
  const room = findRoom(roomId);
  const member = room ? memberOf(room, token) : null;
  return room && member ? { room, member } : null;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    return text.length > 2000 ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
