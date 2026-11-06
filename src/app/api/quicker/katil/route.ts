import { z } from "zod";
import { MAX_GUESTS_PER_IP, findRoomByCode, guestSeat, joinCheck, joinLobby, leaveOtherRooms } from "@/lib/server/registry";
import { currentPlayer, fail, joinLimitOk, json, readJson } from "@/lib/server/http";

// Joining a lobby from its invite link: { kod }. Anyone with the link; a browser already in the lobby gets its seat
// back by its signed cookie (server/guest-id.ts: every tab, every new tap on the link).
const schema = z.object({ kod: z.string().regex(/^[A-Za-z0-9]{6}$/) });

const MESSAGES = {
  DOLU: "Lobi dolu.",
  BASLADI: "Yarış başladı, bitince katılabilirsin.",
  AG_DOLU: `Bu ağdan bu lobiye en fazla ${MAX_GUESTS_PER_IP} kişi katılabilir.`,
} as const;

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail("Lobi bulunamadı ya da kapandı.", 404);
  const { ip, browser, member } = await currentPlayer();
  if (!joinLimitOk(ip)) return fail("Çok fazla deneme yaptın. Biraz sonra tekrar dene.", 429);
  const room = findRoomByCode(body.data.kod);
  if (!room || room.kind !== "LOBI") return fail("Lobi bulunamadı ya da kapandı.", 404);

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
