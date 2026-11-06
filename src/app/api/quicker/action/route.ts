import { z } from "zod";
import { kick, renameGuest, setBots, setQuestionCount, setReady, setVisibility, startLobby } from "@/lib/server/registry";
import { botLevelsSchema, fail, json, questionCountSchema, readJson, roomAndMember } from "@/lib/server/http";

// Lobby actions with the secret racer token: ready / not ready, and for the host the bot slots, removing a person,
// the question count, public / invite-only and Start; a player's own name. The new state reaches everyone through the
// event stream.
const seat = { room: z.string().max(40), token: z.string().max(64) };
const schema = z.discriminatedUnion("action", [
  z.object({ ...seat, action: z.literal("ready"), ready: z.boolean() }),
  z.object({ ...seat, action: z.literal("bots"), bots: botLevelsSchema }),
  z.object({ ...seat, action: z.literal("questions"), questions: questionCountSchema }),
  z.object({ ...seat, action: z.literal("kick"), key: z.string().max(40) }),
  z.object({ ...seat, action: z.literal("name"), name: z.string().max(60) }),
  z.object({ ...seat, action: z.literal("visibility"), visibility: z.enum(["PUBLIC", "INVITE"]) }),
  z.object({ ...seat, action: z.literal("start") }),
]);

const START_ERRORS = {
  NOT_HOST: "Only the lobby's host can start the race.",
  NOT_READY: "You can start once everyone is ready.",
  PHASE: "The race has already started.",
} as const;
const HOST_ONLY = "Only the lobby's host can change this.";

export async function POST(request: Request) {
  const body = schema.safeParse(await readJson(request));
  if (!body.success) return fail("Invalid request.");
  const found = roomAndMember(body.data.room, body.data.token);
  if (!found || found.room.kind !== "LOBBY") return json({ ok: false, error: "NOT_FOUND", message: "Lobby not found or closed." }, 404);
  const { room, member } = found;
  const a = body.data;
  if (a.action === "ready") return json({ ok: setReady(room, member, a.ready) });
  if (a.action === "bots") return setBots(room, member, a.bots) ? json({ ok: true }) : fail(HOST_ONLY, 403);
  if (a.action === "questions") return setQuestionCount(room, member, a.questions) ? json({ ok: true }) : fail(HOST_ONLY, 403);
  if (a.action === "name") {
    const error = renameGuest(room, member, a.name);
    return error ? fail(error, 422) : json({ ok: true });
  }
  if (a.action === "visibility") return setVisibility(room, member, a.visibility) ? json({ ok: true }) : fail(HOST_ONLY, 403);
  if (a.action === "kick") return kick(room, member, a.key) ? json({ ok: true }) : fail("This person couldn't be removed from the lobby.", 403);
  const started = startLobby(room, member);
  return started === "OK" ? json({ ok: true }) : fail(START_ERRORS[started], 409);
}
