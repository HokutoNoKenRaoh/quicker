import { z } from "zod";
import { leaveRoom } from "@/lib/server/registry";
import { fail, json, readJson, roomAndMember } from "@/lib/server/http";

// "Leave game": during a race the person stays on the track greyed out ("left"); in a lobby they leave it.
const schema = z.object({ room: z.string().max(40), token: z.string().max(64) });

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail("Invalid request.");
  const found = roomAndMember(body.data.room, body.data.token);
  if (found) leaveRoom(found.room, found.member);
  return json({ ok: true });
}
