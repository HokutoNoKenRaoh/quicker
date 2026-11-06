import { z } from "zod";
import { ROOMS_FULL, createLobby, leaveOtherRooms, roomForOneMore } from "@/lib/server/registry";
import { botLevelsSchema, optionalQuestionCount, currentPlayer, fail, json, readJson, startLimitOk } from "@/lib/server/http";

// Lobi kur: a lobby with a short code for the invite link (/lobi/<kod>), listed under "Açık lobiler" unless it is
// "Sadece davetle". Joining one needs only the link (../katil).
const schema = z.object({ bots: botLevelsSchema, sorular: optionalQuestionCount, gorunurluk: z.enum(["ACIK", "DAVET"]).optional() });

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail("Geçersiz istek.");
  const { ip, browser, member } = await currentPlayer();
  // The room cap (MAX_ROOMS, and from BUSY_ROOMS on this network's share) before the person leaves their other rooms,
  // so a refusal keeps them where they are.
  if (!roomForOneMore(ip)) return fail(ROOMS_FULL, 503);
  if (!startLimitOk(ip)) return fail("Çok fazla yarış başlattın. Biraz sonra tekrar dene.", 429);
  leaveOtherRooms(browser);
  const me = member();
  const room = createLobby(me, body.data.bots, body.data.sorular, body.data.gorunurluk ?? "ACIK");
  if (!room) return fail(ROOMS_FULL, 503);
  return json({ ok: true, roomId: room.id, token: me.token, key: me.key, code: room.code });
}
