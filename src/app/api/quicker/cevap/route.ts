import { z } from "zod";
import { answer } from "@/lib/server/registry";
import { fail, json, readJson, roomAndMember } from "@/lib/server/http";

// One typed answer: { oda, t, raceId, index, answer }, or a pass: { ..., index, pas: true }. The server checks it
// against that person's next question and measures the time itself; the reply carries the points (the "+100" float)
// and the new score, after a pass the new question. Only the in-memory registry is read; the room's new state goes
// out on the streams after this reply.
const schema = z
  .object({
    oda: z.string().max(40),
    t: z.string().max(64),
    raceId: z.string().max(40),
    index: z.number().int().min(0).max(100),
    answer: z.string().regex(/^\d{1,2}$/).optional(),
    pas: z.literal(true).optional(),
  })
  .refine((b) => b.pas || b.answer !== undefined);

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail("Geçersiz istek.");
  const found = roomAndMember(body.data.oda, body.data.t);
  if (!found) return json({ ok: false, error: "YOK" }, 404);
  const { raceId, index, pas } = body.data;
  const reply = answer(found.room, found.member, { raceId, index, answer: body.data.answer ?? "", pas: pas === true });
  return json(reply, reply.ok || reply.error !== "COK_HIZLI" ? 200 : 429);
}
