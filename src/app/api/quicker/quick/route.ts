import { z } from "zod";
import { ROOMS_FULL, createQuickRace, leaveOtherRooms, roomForOneMore } from "@/lib/server/registry";
import { botLevelsSchema, optionalQuestionCount, currentPlayer, fail, json, readJson, startLimitOk } from "@/lib/server/http";

// Quick start: a server-run race of one person and their bots (0 bots: alone against the clock). The countdown
// starts at once; the browser then opens the event stream (../stream) with the secret racer token it gets here.
const schema = z.object({ bots: botLevelsSchema, questions: optionalQuestionCount });

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
  const room = createQuickRace(me, body.data.bots, body.data.questions);
  if (!room) return fail(ROOMS_FULL, 503);
  return json({ ok: true, roomId: room.id, token: me.token, key: me.key });
}
