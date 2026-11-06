import { z } from "zod";
import { ROOMS_FULL, createLobby, leaveOtherRooms, roomForOneMore } from "@/lib/server/registry";
import { botLevelsSchema, optionalQuestionCount, currentPlayer, fail, json, readJson, startLimitOk } from "@/lib/server/http";

// Create lobby: a lobby with a short code for the invite link (/lobby/<code>), listed under "Open lobbies" unless it
// is invite-only. Joining one needs only the link (../join).
const schema = z.object({ bots: botLevelsSchema, questions: optionalQuestionCount, visibility: z.enum(["PUBLIC", "INVITE"]).optional() });

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail("Invalid request.");
  const { ip, browser, member } = await currentPlayer();
  // The room cap (MAX_ROOMS, and from BUSY_ROOMS on this network's share) before the person leaves their other rooms,
  // so a refusal keeps them where they are.
  if (!roomForOneMore(ip)) return fail(ROOMS_FULL, 503);
  if (!startLimitOk(ip)) return fail("You've started too many races. Try again in a little while.", 429);
  leaveOtherRooms(browser);
  const me = member();
  const room = createLobby(me, body.data.bots, body.data.questions, body.data.visibility ?? "PUBLIC");
  if (!room) return fail(ROOMS_FULL, 503);
  return json({ ok: true, roomId: room.id, token: me.token, key: me.key, code: room.code });
}
