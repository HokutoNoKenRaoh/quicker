import { z } from "zod";
import { kick, renameGuest, setBots, setQuestionCount, setReady, setVisibility, startLobby } from "@/lib/server/registry";
import { botLevelsSchema, fail, json, questionCountSchema, readJson, roomAndMember } from "@/lib/server/http";

// Lobby actions with the secret racer token: Hazırım / hazır değilim, and for the host the bot slots, removing a
// person, the question count, Herkese açık / Sadece davetle and Başlat; a guest's own name. The new state reaches everyone through the event stream.
const seat = { oda: z.string().max(40), t: z.string().max(64) };
const schema = z.discriminatedUnion("islem", [
  z.object({ ...seat, islem: z.literal("hazir"), hazir: z.boolean() }),
  z.object({ ...seat, islem: z.literal("botlar"), bots: botLevelsSchema }),
  z.object({ ...seat, islem: z.literal("sorular"), sorular: questionCountSchema }),
  z.object({ ...seat, islem: z.literal("at"), key: z.string().max(40) }),
  z.object({ ...seat, islem: z.literal("isim"), isim: z.string().max(60) }),
  z.object({ ...seat, islem: z.literal("gorunurluk"), gorunurluk: z.enum(["ACIK", "DAVET"]) }),
  z.object({ ...seat, islem: z.literal("baslat") }),
]);

const START_ERRORS = {
  NOT_HOST: "Yarışı yalnızca lobiyi kuran başlatabilir.",
  NOT_READY: "Herkes hazır olunca başlatabilirsin.",
  PHASE: "Yarış zaten başladı.",
} as const;

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail("Geçersiz istek.");
  const found = roomAndMember(body.data.oda, body.data.t);
  if (!found || found.room.kind !== "LOBI") return json({ ok: false, error: "YOK", message: "Lobi bulunamadı ya da kapandı." }, 404);
  const { room, member } = found;
  const a = body.data;
  if (a.islem === "hazir") return json({ ok: setReady(room, member, a.hazir) });
  if (a.islem === "botlar") return setBots(room, member, a.bots) ? json({ ok: true }) : fail("Botları yalnızca lobiyi kuran değiştirebilir.", 403);
  if (a.islem === "sorular") return setQuestionCount(room, member, a.sorular) ? json({ ok: true }) : fail("Soru sayısını yalnızca lobiyi kuran değiştirebilir.", 403);
  if (a.islem === "isim") {
    const error = renameGuest(room, member, a.isim);
    return error ? fail(error, 422) : json({ ok: true });
  }
  if (a.islem === "gorunurluk") return setVisibility(room, member, a.gorunurluk) ? json({ ok: true }) : fail("Bunu yalnızca lobiyi kuran değiştirebilir.", 403);
  if (a.islem === "at") return kick(room, member, a.key) ? json({ ok: true }) : fail("Bu kişi lobiden çıkarılamadı.", 403);
  const started = startLobby(room, member);
  return started === "OK" ? json({ ok: true }) : fail(START_ERRORS[started], 409);
}
