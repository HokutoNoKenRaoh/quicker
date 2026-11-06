import { z } from "zod";
import { MAX_GUESTS_PER_IP, findRoomByCode, guestSeat, joinCheck, joinLobby, leaveOtherRooms } from "@/lib/server/registry";
import { currentPlayer, fail, joinLimitOk, json, readJson } from "@/lib/server/http";

// Joining a lobby from its invite link: { code }. Anyone with the link; a browser already in the lobby gets its seat
// back by its signed cookie (server/guest-id.ts: every tab, every new tap on the link).
const schema = z.object({ code: z.string().regex(/^[A-Za-z0-9]{6}$/) });

const NOT_FOUND = "Lobby not found or closed.";
const MESSAGES = {
  FULL: "The lobby is full.",
  STARTED: "The race has started; you can join when it's over.",
  NETWORK_FULL: `At most ${MAX_GUESTS_PER_IP} people from one network can join a lobby.`,
} as const;

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail(NOT_FOUND, 404);
  const { ip, browser, member } = await currentPlayer();
  if (!joinLimitOk(ip)) return fail("Too many attempts. Try again in a little while.", 429);
  const room = findRoomByCode(body.data.code);
  if (!room || room.kind !== "LOBBY") return fail(NOT_FOUND, 404);

  let seat = guestSeat(room, browser);
  if (!seat) {
    const check = joinCheck(room);
    if (check) return json({ ok: false, error: check.error, message: MESSAGES[check.error] }, 409);
    leaveOtherRooms(browser, room.id);
    const res = joinLobby(room, member());
    if ("error" in res) return json({ ok: false, error: res.error, message: MESSAGES[res.error] }, 409);
    seat = res.member;
  }
  return json({ ok: true, roomId: room.id, token: seat.token, key: seat.key, code: room.code });
}
