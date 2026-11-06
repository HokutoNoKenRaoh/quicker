import "server-only";
import crypto from "node:crypto";
import { cleanDisplayName, displayNameError } from "@/lib/display-name";
import { letterAvatar, type AvatarView } from "@/lib/avatar";
import { networkKey } from "@/lib/network-key";
import {
  DEFAULT_QUESTIONS,
  MAX_RACERS,
  advance,
  createRace,
  currentQuestion,
  leaveRace,
  pickBots,
  raceDeadline,
  racerResult,
  ranking,
  skipQuestion,
  submitAnswer,
  SKIP_LOCK_MS,
  WRONG_LOCK_MS,
  type BotLevel,
  type Question,
  type QuestionCount,
  type RaceState,
} from "@/lib/engine";

// quicker races run on the server: one in-memory registry of rooms in the Next.js process (globalThis). Run exactly
// one `next start` process, so this is the single source of truth; a restart drops running races and the clients
// show "The server restarted". The server owns the seed, the start time, every answer's timing, the score, the
// bots, the end and the placings. Nothing the browser reports about itself (score, time, "I won") is trusted: it
// only sends typed answers.

const COUNTDOWN_MS = 5_000;
/** Time for the event stream to connect before "5" shows. */
const CONNECT_BUFFER_MS = 600;
const TICK_MS = 250;
/** Network jitter allowance added to every timing limit. */
const GRACE_MS = 150;
/** Answer requests per person per second (a request limit). */
const ANSWERS_PER_SECOND = 10;
const LOBBY_IDLE_MS = 30 * 60_000;
const FINISHED_ROOM_TTL_MS = 10 * 60_000;
/** A person whose stream has been gone this long during a race is counted as left. */
const GONE_MS = 30_000;
const CODE_ALPHABET = "ACDEFHJKMNPQRTUWXY3479";
/** Seats one network (IP) may take in one lobby (only when the address is known, server/client-ip.ts). */
export const MAX_GUESTS_PER_IP = 2;
/**
 * Rooms in memory at once, lobbies and quick races together (the 250 ms clock walks every room on the one event
 * loop, and anyone may start races). A new room beyond it is refused with ROOMS_FULL.
 */
export const MAX_ROOMS = 100;
export const ROOMS_FULL = "It's very busy right now. Please try again in a moment.";
/**
 * From this many rooms in memory on, one network's share is limited: a network (an IPv4 address,
 * an IPv6 /64) that already holds MAX_ROOMS_PER_IP_WHEN_BUSY rooms in use gets ROOMS_FULL for a new one, so a few
 * networks can't keep the last places busy. Below it nothing changes (many players behind one carrier NAT stay fine).
 */
export const BUSY_ROOMS = 80;
export const MAX_ROOMS_PER_IP_WHEN_BUSY = 3;

export type RoomKind = "QUICK" | "LOBBY";
/** A lobby listed under "Open lobbies" (PUBLIC) or reachable only through its invite link (INVITE). */
export type Visibility = "PUBLIC" | "INVITE";
/** "Open lobbies": at most this many, newest activity first, none idle for longer than OPEN_IDLE_MS. */
const OPEN_LIST_SIZE = 20;
const OPEN_IDLE_MS = 10 * 60_000;
export type Phase = "LOBBY" | "COUNTDOWN" | "RACING" | "FINISHED";

export interface Member {
  key: string;
  token: string;
  name: string;
  avatar: AvatarView;
  ip: string;
  ready: boolean;
  joinedAt: number;
  /** Last time a stream of this person was open (or they acted). */
  seenAt: number;
  streams: number;
  /** Answer request times (epoch ms) of the last second, for the per-person limit. */
  hits: number[];
  /** The browser's guest id (signed cookie, server/guest-id.ts): joining again with it gives the same seat. */
  guestKey: string | null;
}

export interface MemberResult {
  key: string;
  placing: number;
  racerCount: number;
  score: number;
  correct: number;
  wrong: number;
  skips: number;
  /** The finishing speed bonus (part of the score). */
  bonus: number;
  finished: boolean;
  averageMs: number | null;
  fastestMs: number | null;
  maxCombo: number;
  finishMs: number | null;
}

export interface Room {
  id: string;
  code: string | null;
  kind: RoomKind;
  createdAt: number;
  activeAt: number;
  hostKey: string;
  members: Member[];
  botLevels: BotLevel[];
  /** Questions of the next race (the race itself carries its own). */
  questionCount: QuestionCount;
  phase: Phase;
  raceId: string | null;
  startAt: number | null;
  race: RaceState | null;
  results: MemberResult[] | null;
  endedAt: number | null;
  subscribers: Set<Subscriber>;
  /** Progress at the last broadcast (the clock re-broadcasts only when something moved). */
  lastKey: string;
  visibility: Visibility;
}

export interface Subscriber {
  memberKey: string;
  send: (payload: unknown) => void;
  close: () => void;
  /** What this screen already has (compact messages, compactFor). */
  sent?: Sent;
}

interface Registry {
  rooms: Map<string, Room>;
  codes: Map<string, string>;
  timer: ReturnType<typeof setInterval> | null;
}

const g = globalThis as unknown as { __quicker?: Registry };
const reg = (): Registry => (g.__quicker ??= { rooms: new Map(), codes: new Map(), timer: null });

const randomId = (bytes = 12) => crypto.randomBytes(bytes).toString("base64url");
const randomSeed = () => crypto.randomBytes(4).readUInt32LE(0);
const sameToken = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function newCode(): string {
  for (;;) {
    let c = "";
    for (let i = 0; i < 6; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!reg().codes.has(c)) return c;
  }
}

export function newMember(input: { name: string; avatar: AvatarView; ip: string; guestKey: string | null }): Member {
  const now = Date.now();
  return { key: `p-${randomId(6)}`, token: randomId(24), ...input, ready: false, joinedAt: now, seenAt: now, streams: 0, hits: [] };
}

export function findRoom(roomId: string) {
  return reg().rooms.get(roomId) ?? null;
}

export function findRoomByCode(code: string) {
  const id = reg().codes.get(code.toUpperCase());
  return id ? findRoom(id) : null;
}

/** The member a secret racer token belongs to. */
export function memberOf(room: Room, token: string) {
  return room.members.find((m) => sameToken(m.token, token)) ?? null;
}

/**
 * The public lobbies for "Open lobbies" (only what the list shows: no tokens, IPs or guest keys; the code is what the
 * invite link already gives away). A lobby is listed while its host is connected and it isn't idle; a running race
 * or a full lobby is listed without a way in.
 */
export function openLobbies(now = Date.now()) {
  const list: { code: string; host: { name: string; avatar: AvatarView }; people: number; bots: BotLevel[]; questionCount: number; openMs: number; racing: boolean; full: boolean; activeAt: number }[] = [];
  for (const room of reg().rooms.values()) {
    if (room.kind !== "LOBBY" || room.visibility !== "PUBLIC" || !room.code || now - room.activeAt > OPEN_IDLE_MS) continue;
    const host = room.members.find((m) => m.key === room.hostKey);
    if (!host || host.streams === 0) continue;
    list.push({
      code: room.code,
      host: { name: host.name, avatar: host.avatar },
      people: room.members.length,
      bots: room.botLevels,
      questionCount: room.questionCount,
      openMs: now - room.createdAt,
      racing: room.phase !== "LOBBY",
      full: room.members.length >= MAX_RACERS,
      activeAt: room.activeAt,
    });
  }
  return list
    .sort((a, b) => b.activeAt - a.activeAt)
    .slice(0, OPEN_LIST_SIZE)
    .map(({ activeAt: _activeAt, ...lobby }) => lobby);
}

export type OpenLobby = ReturnType<typeof openLobbies>[number];

/** Host only: public (listed under Open lobbies) or invite-only (the link only). */
export function setVisibility(room: Room, member: Member, visibility: Visibility) {
  if (room.kind !== "LOBBY" || room.hostKey !== member.key) return false;
  room.visibility = visibility;
  touch(room);
  return true;
}

// ---- Rooms ------------------------------------------------------------------------------------------------------

function addRoom(room: Room) {
  reg().rooms.set(room.id, room);
  if (room.code) reg().codes.set(room.code, room.id);
  ensureTimer();
  return room;
}

function removeRoom(room: Room) {
  reg().rooms.delete(room.id);
  if (room.code) reg().codes.delete(room.code);
  for (const s of [...room.subscribers]) s.close();
  room.subscribers.clear();
}

/** A finished quick race nobody watches any more: roomForOneMore may close it, so it holds no place. */
const closable = (room: Room) => room.kind === "QUICK" && room.phase === "FINISHED" && room.subscribers.size === 0;

/**
 * Rooms in use (anything but a closable one) with at least one member from this network: the same IPv4 address, or
 * for IPv6 the same /64 (lib/network-key.ts).
 */
export function roomsHeldBy(ip: string) {
  const network = networkKey(ip);
  let held = 0;
  for (const room of reg().rooms.values()) if (!closable(room) && room.members.some((m) => networkKey(m.ip) === network)) held++;
  return held;
}

/**
 * Whether one more room fits, for a person from `ip`. From BUSY_ROOMS rooms on, an IP holding MAX_ROOMS_PER_IP_WHEN_BUSY
 * rooms in use gets none (an unknown IP is not limited, like the rate limits; the person's own rooms count, as they
 * are left only after this check). Under MAX_ROOMS there is room; at the cap, the finished quick race nobody watches
 * any more that ended first is closed early to make room (it would go after FINISHED_ROOM_TTL_MS anyway); false when every room is still in use. The start routes ask before a person
 * leaves their other rooms, so a refusal keeps them where they are.
 */
export function roomForOneMore(ip?: string | null): boolean {
  const r = reg();
  if (ip && ip !== "unknown" && r.rooms.size >= BUSY_ROOMS && roomsHeldBy(ip) >= MAX_ROOMS_PER_IP_WHEN_BUSY) return false;
  if (r.rooms.size < MAX_ROOMS) return true;
  let done: Room | null = null;
  for (const room of r.rooms.values()) {
    if (!closable(room)) continue;
    if (!done || (room.endedAt ?? 0) < (done.endedAt ?? 0)) done = room;
  }
  if (!done) return false;
  removeRoom(done);
  return true;
}

/** Quick start: a room of one person and their bots; the countdown starts at once. Null: no room (roomForOneMore). */
export function createQuickRace(member: Member, botLevels: BotLevel[], questionCount: QuestionCount = DEFAULT_QUESTIONS): Room | null {
  if (!roomForOneMore(member.ip)) return null;
  const now = Date.now();
  const room: Room = {
    id: randomId(9),
    code: null,
    kind: "QUICK",
    createdAt: now,
    activeAt: now,
    hostKey: member.key,
    members: [{ ...member, ready: true }],
    botLevels: botLevels.slice(0, MAX_RACERS - 1),
    questionCount,
    phase: "LOBBY",
    raceId: null,
    startAt: null,
    race: null,
    results: null,
    endedAt: null,
    subscribers: new Set(),
    lastKey: "",
    visibility: "INVITE",
  };
  addRoom(room);
  startCountdown(room);
  return room;
}

/** Create lobby: a lobby with a short code; the host adds bots and starts when the people present are ready. Null: no room. */
export function createLobby(member: Member, botLevels: BotLevel[], questionCount: QuestionCount = DEFAULT_QUESTIONS, visibility: Visibility = "PUBLIC"): Room | null {
  if (!roomForOneMore(member.ip)) return null;
  const now = Date.now();
  member.name = `${GUEST_NAME} 1`;
  member.avatar = letterAvatar(member.name);
  return addRoom({
    id: randomId(9),
    code: newCode(),
    kind: "LOBBY",
    createdAt: now,
    activeAt: now,
    hostKey: member.key,
    members: [member],
    botLevels: botLevels.slice(0, MAX_RACERS - 1),
    questionCount,
    phase: "LOBBY",
    raceId: null,
    startAt: null,
    race: null,
    results: null,
    endedAt: null,
    subscribers: new Set(),
    lastKey: "",
    visibility,
  });
}

type JoinError = "FULL" | "STARTED" | "NETWORK_FULL";

/** Whether a new person can join. */
export function joinCheck(room: Room): { error: JoinError } | null {
  if (room.phase === "COUNTDOWN" || room.phase === "RACING") return { error: "STARTED" };
  if (room.members.length >= MAX_RACERS) return { error: "FULL" };
  return null;
}

/** The seat of a guest's browser (a reload, two join requests at once, the link opened again in another tab). */
export function guestSeat(room: Room, guestKey: string | undefined) {
  if (!guestKey) return null;
  return room.members.find((m) => m.guestKey !== null && sameToken(m.guestKey, guestKey)) ?? null;
}

const GUEST_NAME = "Guest";
const sameName = (a: string, b: string) => a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US");

/**
 * A person joins a lobby; people take the place of bots when the room is full (at most 6 racers). Guests (anyone with the
 * link) get "Guest 1", "Guest 2"… and may choose a name before they are ready (renameGuest).
 */
export function joinLobby(room: Room, member: Member): { member: Member } | { error: JoinError } {
  const check = joinCheck(room);
  if (check) return check;
  // Two browsers on the same phone or Wi-Fi may each have a seat. A network is an IPv4 address or an IPv6 /64
  // (lib/network-key.ts); an unknown address isn't limited.
  if (member.ip !== "unknown") {
    const network = networkKey(member.ip);
    if (room.members.filter((m) => networkKey(m.ip) === network).length >= MAX_GUESTS_PER_IP) return { error: "NETWORK_FULL" };
  }
  let n = 1;
  while (room.members.some((m) => sameName(m.name, `${GUEST_NAME} ${n}`))) n++;
  member.name = `${GUEST_NAME} ${n}`;
  member.avatar = letterAvatar(member.name);
  room.members.push(member);
  room.botLevels = room.botLevels.slice(0, MAX_RACERS - room.members.length);
  touch(room);
  return { member };
}

/** Tells a person's open screens why they are no longer in the room (before their streams close). */
function notifyRemoved(room: Room, key: string, reason: "KICKED" | "OTHER_ROOM") {
  for (const s of [...room.subscribers]) if (s.memberKey === key) s.send({ t: "removed", reason });
}

/**
 * Leaving. During the countdown / race the person stays on the track greyed out ("left") and leaves the room when
 * it goes back to the lobby; in a lobby they leave at once (the longest-present person becomes host; an empty room
 * closes).
 */
export function leaveRoom(room: Room, member: Member) {
  if ((room.phase === "COUNTDOWN" || room.phase === "RACING") && room.race) {
    room.race = leaveRace(room.race, member.key, Math.max(0, Date.now() - room.startAt!));
    member.ready = false;
    if (room.race.ended) return finishRace(room);
    return touch(room);
  }
  removeMember(room, member.key);
}

function removeMember(room: Room, key: string) {
  room.members = room.members.filter((m) => m.key !== key);
  for (const s of [...room.subscribers]) if (s.memberKey === key) s.close();
  if (!room.members.length) return removeRoom(room);
  if (room.hostKey === key) room.hostKey = [...room.members].sort((a, b) => a.joinedAt - b.joinedAt)[0]!.key;
  touch(room);
}

/** One room per browser: joining or starting another one leaves the others (the newest screen wins). */
export function leaveOtherRooms(guestKey: string, exceptRoomId: string | null = null) {
  for (const room of [...reg().rooms.values()]) {
    if (room.id === exceptRoomId) continue;
    const m = room.members.find((x) => x.guestKey !== null && sameToken(x.guestKey, guestKey));
    if (!m) continue;
    notifyRemoved(room, m.key, "OTHER_ROOM");
    if ((room.phase === "COUNTDOWN" || room.phase === "RACING") && room.race?.racers.some((r) => r.id === m.key)) leaveRoom(room, m);
    else removeMember(room, m.key);
  }
}

export function setReady(room: Room, member: Member, ready: boolean) {
  if (room.phase !== "LOBBY") return false;
  member.ready = ready;
  member.seenAt = Date.now();
  touch(room);
  return true;
}

/** Host only: the bot slots (people + bots at most 6). */
export function setBots(room: Room, member: Member, levels: BotLevel[]) {
  if (room.phase !== "LOBBY" || room.hostKey !== member.key) return false;
  room.botLevels = levels.slice(0, MAX_RACERS - room.members.length);
  touch(room);
  return true;
}

/** A guest's own name in the lobby (lib/display-name.ts rules, unique in the room); null when it was taken. */
export function renameGuest(room: Room, member: Member, raw: string): string | null {
  if (room.phase !== "LOBBY" || member.ready) return "You can change your name before you're ready.";
  const name = cleanDisplayName(raw);
  const error = displayNameError(name);
  if (error) return error;
  if (room.members.some((m) => m.key !== member.key && sameName(m.name, name))) return "Someone in the lobby already has this name.";
  member.name = name;
  member.avatar = letterAvatar(name);
  touch(room);
  return null;
}

/** Host only: the question count of the next race. */
export function setQuestionCount(room: Room, member: Member, count: QuestionCount) {
  if (room.phase !== "LOBBY" || room.hostKey !== member.key) return false;
  room.questionCount = count;
  touch(room);
  return true;
}

/** Host only: removes a person from the lobby. */
export function kick(room: Room, host: Member, key: string) {
  if (room.phase !== "LOBBY" || room.hostKey !== host.key || key === host.key) return false;
  if (!room.members.some((m) => m.key === key)) return false;
  notifyRemoved(room, key, "KICKED");
  removeMember(room, key);
  return true;
}

/**
 * Host only: starts when every person present (with the lobby open) is ready; the host alone may start. The race
 * takes the host and the people who are ready; the others watch and join the next one.
 */
export function startLobby(room: Room, host: Member): "OK" | "NOT_HOST" | "NOT_READY" | "PHASE" {
  if (room.hostKey !== host.key) return "NOT_HOST";
  if (room.phase !== "LOBBY") return "PHASE";
  if (room.members.some((m) => m.key !== host.key && m.streams > 0 && !m.ready)) return "NOT_READY";
  host.ready = true;
  startCountdown(room);
  return "OK";
}

/** After a lobby race (results shown) the room goes back to its lobby; people who left the race go. */
function backToLobby(room: Room) {
  if (room.phase !== "FINISHED") return;
  const left = new Set(room.race?.racers.filter((r) => r.left).map((r) => r.id));
  room.phase = "LOBBY";
  room.race = null;
  room.results = null;
  room.raceId = null;
  room.startAt = null;
  room.endedAt = null;
  for (const m of room.members) m.ready = false;
  for (const key of left) {
    if (!room.members.some((m) => m.key === key)) continue;
    removeMember(room, key);
    if (!reg().rooms.has(room.id)) return;
  }
  touch(room);
}

function startCountdown(room: Room) {
  const seed = randomSeed();
  const racing = room.members.filter((m) => m.ready || room.kind === "QUICK").sort((a, b) => a.joinedAt - b.joinedAt);
  room.race = createRace(seed, racing.map((m) => ({ id: m.key, name: m.name, avatar: null })), pickBots(seed, room.botLevels), room.questionCount);
  room.raceId = randomId(9);
  room.startAt = Date.now() + COUNTDOWN_MS + CONNECT_BUFFER_MS;
  room.phase = "COUNTDOWN";
  room.results = null;
  touch(room);
}

function touch(room: Room) {
  room.activeAt = Date.now();
  broadcast(room);
}

// ---- Answers ----------------------------------------------------------------------------------------------------

/** One of a person's next questions as their browser gets it (it checks the typed digits itself). */
const aheadItem = (i: number, q: Question) => ({ i, text: q.text, answer: String(q.answer) });

type AnswerReply =
  | {
      ok: true;
      accepted: boolean;
      wrong: boolean;
      /** A pass went through: `question` is the new one (the same index). */
      skipped: boolean;
      question: ReturnType<typeof aheadItem> | null;
      score: number;
      combo: number;
      answered: number;
    }
  | { ok: false; error: "NOT_RACER" | "NO_RACE" | "TOO_FAST" };

/**
 * One typed answer, or a pass (`pass`: the question is replaced, see skipQuestion). Time is measured here (the
 * previous accepted answer of this person to this one).
 */
export function answer(room: Room, member: Member, input: { raceId: string; index: number; answer: string; pass?: boolean }): AnswerReply {
  const now = Date.now();
  member.hits = member.hits.filter((t) => now - t < 1000);
  if (member.hits.length >= ANSWERS_PER_SECOND) return { ok: false, error: "TOO_FAST" };
  member.hits.push(now);
  member.seenAt = now;
  // The browser shows the first question at the start time; the clock's tick may not have run yet.
  if (room.phase === "COUNTDOWN" && room.startAt !== null && now >= room.startAt) room.phase = "RACING";
  if (room.phase !== "RACING" || !room.race || room.raceId !== input.raceId) return { ok: false, error: "NO_RACE" };

  const t = now - room.startAt!;
  const before = room.race.racers.find((r) => r.id === member.key);
  if (!before) return { ok: false, error: "NOT_RACER" };
  if (input.pass) {
    // The browser locks for SKIP_LOCK_MS after a pass; the server allows for network jitter. The new question also
    // reaches the person's screen through the stream (when this reply is lost).
    const res = skipQuestion(room.race, member.key, input.index, t, { lockMs: SKIP_LOCK_MS - GRACE_MS });
    room.race = res.state;
    const after = room.race.racers.find((r) => r.id === member.key)!;
    if (room.race.ended) finishRace(room);
    else if (res.skipped) broadcastSoon(room);
    const question = res.question ? aheadItem(input.index, res.question) : null;
    return { ok: true, accepted: false, wrong: false, skipped: res.skipped, question, score: after.score, combo: after.combo, answered: after.answered };
  }
  // The browser locks for WRONG_LOCK_MS after a mistake; the server allows for network jitter.
  const res = submitAnswer(room.race, member.key, input.index, input.answer, t, { graceMs: GRACE_MS, lockMs: WRONG_LOCK_MS - GRACE_MS });
  room.race = res.state;
  const after = room.race.racers.find((r) => r.id === member.key)!;
  if (room.race.ended) finishRace(room);
  else if (res.accepted) broadcastSoon(room);
  return { ok: true, accepted: res.accepted, wrong: res.wrong, skipped: false, question: null, score: after.score, combo: after.combo, answered: after.answered };
}

function finishRace(room: Room) {
  if (room.phase === "FINISHED" || !room.race) return;
  const race = room.race;
  room.phase = "FINISHED";
  room.endedAt = Date.now();
  const order = ranking(race);
  // People who watched this race (joined the lobby late, weren't ready) have no result, nor does someone who left
  // before answering anything (nothing to save or show).
  room.results = room.members.filter((m) => race.racers.some((r) => r.id === m.key && !(r.left && r.answered === 0))).map((m) => {
    const res = racerResult(race, m.key);
    return {
      key: m.key,
      placing: order.findIndex((x) => x.id === m.key) + 1,
      racerCount: race.racers.length,
      score: res.score,
      correct: res.correct,
      wrong: res.wrong,
      skips: res.skips,
      bonus: res.bonus,
      finished: res.finished,
      averageMs: res.averageMs,
      fastestMs: res.fastestMs,
      maxCombo: res.maxCombo,
      finishMs: res.finishMs,
    };
  });
  broadcast(room);
  // A lobby then goes back to its lobby screen (the browsers keep showing the results until the person closes them).
  if (room.kind === "LOBBY") backToLobby(room);
}

// ---- Stream -----------------------------------------------------------------------------------------------------

/**
 * A person's screen opens the room's stream. One screen per seat: an older one (another tab of the same browser, the
 * link opened again) gets "taken" and closes; it can take the seat back ("Buraya al" opens a new stream).
 */
export function subscribe(room: Room, member: Member, sub: Subscriber) {
  for (const old of [...room.subscribers])
    if (old.memberKey === member.key) {
      old.send({ t: "taken" });
      old.close();
    }
  room.subscribers.add(sub);
  member.streams++;
  member.seenAt = Date.now();
  // Everyone sees who is connected ("not connected" in the lobby); the new screen gets the full state with it.
  broadcast(room);
  return () => {
    room.subscribers.delete(sub);
    member.streams = Math.max(0, member.streams - 1);
    member.seenAt = Date.now();
    if (reg().rooms.has(room.id) && room.subscribers.size) broadcast(room);
  };
}

const progressKey = (race: RaceState) => race.racers.map((r) => `${r.answered}${r.left ? "x" : ""}`).join(",");

function broadcast(room: Room) {
  room.lastKey = room.race ? progressKey(room.race) : "";
  for (const sub of room.subscribers) {
    const m = room.members.find((x) => x.key === sub.memberKey);
    if (!m) continue;
    try {
      sub.send(compactFor(sub, view(room, m)));
    } catch {
      room.subscribers.delete(sub);
    }
  }
}

/** An answer's fan-out to the streams runs after its reply is on its way (the reply never waits for it). */
function broadcastSoon(room: Room) {
  setImmediate(() => {
    if (reg().rooms.has(room.id)) broadcast(room);
  });
}

/** What a screen already has: the member list, the person's next questions, the racers, the newest score event. */
interface Sent {
  raceId: string | null;
  members: string;
  ahead: string;
  /** The racers' names / avatars / levels, and each racer's progress (score, answered, combo, finished, left). */
  racers: string;
  progress: Map<string, string>;
  seq: number;
}

const racerProgress = (r: RoomView["racers"][number]) => ({ id: r.id, score: r.score, answered: r.answered, combo: r.combo, finished: r.finished, left: r.left });

/**
 * A stream message with only what the screen hasn't got (`d`): the member list and the next questions only when they
 * changed, only the racers whose progress changed (`rp`: just their progress, while the line-up is the same), only
 * the score events newer than the last one sent. The browser keeps the rest (use-race.ts merge); the first message
 * of a stream is the full state.
 */
function compactFor(sub: Subscriber, full: RoomView) {
  const prev = sub.sent;
  const sameRace = !!prev && prev.raceId === full.raceId;
  const next: Sent = {
    raceId: full.raceId,
    members: JSON.stringify(full.members),
    ahead: JSON.stringify(full.ahead),
    racers: JSON.stringify(full.racers.map((r) => [r.id, r.name, r.avatar, r.human, r.level])),
    progress: new Map(full.racers.map((r) => [r.id, JSON.stringify(racerProgress(r))])),
    seq: Math.max(sameRace ? prev.seq : 0, ...full.events.map((e) => e.seq)),
  };
  sub.sent = next;
  if (!prev) return full;
  const sameLineUp = prev.racers === next.racers;
  return {
    ...full,
    d: 1 as const,
    members: prev.members === next.members ? undefined : full.members,
    ahead: prev.ahead === next.ahead ? undefined : full.ahead,
    rp: sameLineUp ? (1 as const) : undefined,
    racers: sameLineUp ? full.racers.filter((r) => prev.progress.get(r.id) !== next.progress.get(r.id)).map(racerProgress) : full.racers,
    events: sameRace ? full.events.filter((e) => e.seq > prev.seq) : full.events,
  };
}

/** What one person sees: the room, everyone's progress, and only their own next questions. */
function view(room: Room, me: Member) {
  const race = room.race;
  const mine = race?.racers.find((r) => r.id === me.key) ?? null;
  const now = Date.now();
  return {
    t: "state" as const,
    serverNow: now,
    roomId: room.id,
    kind: room.kind,
    visibility: room.visibility,
    code: room.code,
    phase: room.phase,
    raceId: room.raceId,
    startAt: room.startAt,
    deadline: race && room.startAt ? room.startAt + raceDeadline(race) : null,
    firstFinishAt: race?.firstFinishAt != null && room.startAt ? room.startAt + race.firstFinishAt : null,
    me: { key: me.key, host: room.hostKey === me.key, racing: !!mine },
    members: room.members.map((m) => ({
      key: m.key,
      name: m.name,
      avatar: m.avatar,
      ready: m.ready,
      host: room.hostKey === m.key,
      here: m.streams > 0,
      guest: true,
      // For the host: a seat that shares a network with another seat (may be one person twice).
      sameNetwork: room.hostKey === me.key && m.ip !== "unknown" && room.members.some((o) => o.key !== m.key && networkKey(o.ip) === networkKey(m.ip)),
      racing: !!race?.racers.some((r) => r.id === m.key),
    })),
    botLevels: room.botLevels,
    /** The running / last race's question count, else the lobby's setting. */
    questionCount: race?.questions.length ?? room.questionCount,
    racers:
      race?.racers.map((r) => ({
        id: r.id,
        name: r.name,
        avatar: null,
        human: r.human,
        level: r.level,
        score: r.score,
        answered: r.answered,
        combo: r.id === me.key ? r.combo : null,
        finished: r.finishedAt !== null,
        left: r.left,
      })) ?? [],
    // Recent points with their race time (the browser shows "+100", or the finishing speed bonus, for a moment).
    events: race?.events.slice(-12).map((e) => ({ seq: e.seq, racerId: e.racerId, points: e.points, at: Math.round(e.at), bonus: e.bonus })) ?? [],
    // The next questions of this person only (the browser checks its own typing against them; the first one is the
    // replacement after a pass). Sent from the countdown on, so the first one shows exactly at the start time;
    // answers before it are refused.
    ahead:
      race && mine && (room.phase === "COUNTDOWN" || room.phase === "RACING") && mine.finishedAt === null
        ? [currentQuestion(race, mine)!, ...race.questions.slice(mine.answered + 1, mine.answered + 3)].map((q, i) => aheadItem(mine.answered + i, q))
        : [],
    results: room.results
      ? {
          order: race ? ranking(race).map((r) => r.id) : [],
          mine: room.results.find((x) => x.key === me.key) ?? null,
        }
      : null,
  };
}

export type RoomView = ReturnType<typeof view>;

// ---- Clock ------------------------------------------------------------------------------------------------------

function ensureTimer() {
  const r = reg();
  if (r.timer) return;
  r.timer = setInterval(tick, TICK_MS);
  // Don't keep a script alive just for the races.
  r.timer.unref?.();
}

function tick() {
  const r = reg();
  const now = Date.now();
  for (const room of [...r.rooms.values()]) {
    if (room.phase === "COUNTDOWN" && room.startAt !== null && now >= room.startAt) {
      room.phase = "RACING";
      broadcast(room);
    }
    if (room.phase === "RACING" && room.race && room.startAt !== null) {
      // People whose stream is gone for a while count as left (the race doesn't wait for them).
      for (const m of room.members) {
        const racer = room.race.racers.find((x) => x.id === m.key);
        if (racer && !racer.left && racer.finishedAt === null && m.streams === 0 && now - m.seenAt > GONE_MS) room.race = leaveRace(room.race, m.key, now - room.startAt);
      }
      room.race = advance(room.race, now - room.startAt);
      if (room.race.ended) finishRace(room);
      else if (progressKey(room.race) !== room.lastKey) broadcast(room);
    }
    // Cleanup
    const idle = now - room.activeAt;
    if (room.phase === "FINISHED" && room.kind === "QUICK" && room.endedAt !== null && now - room.endedAt > FINISHED_ROOM_TTL_MS) removeRoom(room);
    else if ((room.phase === "LOBBY" || room.phase === "FINISHED") && idle > LOBBY_IDLE_MS) removeRoom(room);
  }
  if (!r.rooms.size && r.timer) {
    clearInterval(r.timer);
    r.timer = null;
  }
}
