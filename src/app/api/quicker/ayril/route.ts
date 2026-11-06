import { z } from "zod";
import { leaveRoom } from "@/lib/server/registry";
import { fail, json, readJson, roomAndMember } from "@/lib/server/http";

// "Oyundan çık": during a race the person stays on the track greyed out ("ayrıldı"); in a lobby they leave it.
const schema = z.object({ oda: z.string().max(40), t: z.string().max(64) });

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail("Geçersiz istek.");
  const found = roomAndMember(body.data.oda, body.data.t);
  if (found) leaveRoom(found.room, found.member);
  return json({ ok: true });
}
