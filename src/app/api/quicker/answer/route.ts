import { z } from "zod";
import { answer } from "@/lib/server/registry";
import { fail, json, readJson, roomAndMember } from "@/lib/server/http";

// One typed answer: { room, token, raceId, index, answer }, or a pass: { ..., index, pass: true }. The server checks
// it against that person's next question and measures the time itself; the reply carries the points (the "+100"
// float) and the new score, after a pass the new question. Only the in-memory registry is read; the room's new state
// goes out on the streams after this reply.
const schema = z
  .object({
    room: z.string().max(40),
    token: z.string().max(64),
    raceId: z.string().max(40),
    index: z.number().int().min(0).max(100),
    answer: z.string().regex(/^\d{1,2}$/).optional(),
    pass: z.literal(true).optional(),
  })
  .refine((b) => b.pass || b.answer !== undefined);

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail("Invalid request.");
  const found = roomAndMember(body.data.room, body.data.token);
  if (!found) return json({ ok: false, error: "NOT_FOUND" }, 404);
  const { raceId, index, pass } = body.data;
  const reply = answer(found.room, found.member, { raceId, index, answer: body.data.answer ?? "", pass: pass === true });
  return json(reply, reply.ok || reply.error !== "TOO_FAST" ? 200 : 429);
}
