"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomView } from "@/lib/server/registry";

// The browser side of a server-run race: the room's event stream (src/app/api/quicker/akis), the
// server clock offset, and the answers sent one at a time (in order, so the server never sees question 5 before 4).
// The browser only sends typed answers; score, time and placing come from the server. After the first stream message
// (the full state) the server leaves out what hasn't changed (`d`: the member list and next questions when they are the
// same, the racers whose progress didn't change, the score events already sent); merge() puts the full state back
// together.

const API = "/api/quicker";
const RECONNECT_MS = 2000;

export type Seat = { roomId: string; token: string; key: string };
/** Removed from a lobby by its host, or moved to a room in another window. */
type RemovedReason = "ATILDI" | "BASKA_ODA";
/** One of the player's next questions (the race's, or the replacement after a pass). */
export type AheadQuestion = RoomView["ahead"][number];
export type AnswerReply =
  | { ok: true; accepted: boolean; wrong: boolean; skipped: boolean; question: AheadQuestion | null; score: number; combo: number; answered: number }
  | { ok: false; error?: string };
type Racer = RoomView["racers"][number];
/** A stream message: the full state, or (`d`) only what changed (`rp`: `racers` holds just the changed racers' progress). */
type StreamState = Omit<RoomView, "members" | "ahead" | "racers"> & {
  members?: RoomView["members"];
  ahead?: RoomView["ahead"];
  racers: (Pick<Racer, "id"> & Partial<Racer>)[];
  d?: 1;
  rp?: 1;
};

export async function post<T>(path: string, body: unknown): Promise<T | { ok: false; message?: string; error?: string }> {
  try {
    const res = await fetch(`${API}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return (await res.json()) as T;
  } catch {
    return { ok: false, message: "Bağlantı kurulamadı." };
  }
}

/** The full state from a stream message and the state before it (null: a compact message without a base, skipped). */
function merge(prev: RoomView | null, msg: StreamState): RoomView | null {
  if (!msg.d) return msg as RoomView;
  if (!prev || prev.roomId !== msg.roomId) return null;
  const changed = new Map(msg.racers.map((r) => [r.id, r]));
  return {
    ...msg,
    members: msg.members ?? prev.members,
    ahead: msg.ahead ?? prev.ahead,
    racers: msg.rp ? prev.racers.map((r) => ({ ...r, ...changed.get(r.id) })) : (msg.racers as Racer[]),
    events: msg.raceId === prev.raceId ? [...prev.events, ...msg.events].slice(-12) : msg.events,
  };
}

/** Leaving without waiting for an answer (also works while the page is closing). */
export function leaveSeat(seat: Seat) {
  const body = JSON.stringify({ oda: seat.roomId, t: seat.token });
  // text/plain: a JSON-typed beacon is refused by some browsers; the route parses the body as JSON either way.
  try {
    if (navigator.sendBeacon?.(`${API}/ayril`, new Blob([body], { type: "text/plain" }))) return;
  } catch {}
  void fetch(`${API}/ayril`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

export function useRace(seat: Seat | null) {
  const [view, setView] = useState<RoomView | null>(null);
  // The room that is gone (server restarted) / that removed this person (and why), so a new seat starts clean.
  const [gone, setGone] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ roomId: string; reason: RemovedReason } | null>(null);
  // The last finished race of the room (a lobby goes back to its lobby right after; the results stay on screen).
  const [finished, setFinished] = useState<RoomView | null>(null);
  // The stream dropped and is reconnecting.
  const [offline, setOffline] = useState(false);
  // The seat was opened in another window (this screen stopped); "Buraya al" opens the stream again.
  const [taken, setTaken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Server time minus local time, from the least delayed message seen (max over samples: never ahead of the server).
  const offset = useRef<number | null>(null);

  useEffect(() => {
    if (!seat) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
      es = null;
    };
    const connect = () => {
      es = new EventSource(`${API}/akis?oda=${encodeURIComponent(seat.roomId)}&t=${encodeURIComponent(seat.token)}`);
      // The last full state of this stream (every new connection starts with a full one).
      let last: RoomView | null = null;
      es.onmessage = (e) => {
        let data: { t: string };
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        setOffline(false);
        if (data.t === "gone") {
          setGone(seat.roomId);
          return stop();
        }
        if (data.t === "taken") {
          setTaken(seat.roomId);
          return stop();
        }
        if (data.t === "removed") {
          setRemoved({ roomId: seat.roomId, reason: (data as { reason?: RemovedReason }).reason ?? "ATILDI" });
          return stop();
        }
        if (data.t === "state") {
          const state = merge(last, data as StreamState);
          if (!state) return;
          last = state;
          const sample = state.serverNow - Date.now();
          offset.current = offset.current === null ? sample : Math.max(offset.current, sample);
          setView(state);
          if (state.phase === "BITTI" && state.results?.mine) setFinished(state);
        }
      };
      // EventSource reconnects by itself after a dropped connection (the server sends the full state again), but
      // gives up for good when a reconnect gets an error page (a restarting server): then reconnect here.
      es.onerror = () => {
        setOffline(true);
        if (es?.readyState !== EventSource.CLOSED || stopped) return;
        es = null;
        retry = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();
    return stop;
  }, [seat, attempt]);

  const serverNow = useCallback(() => Date.now() + (offset.current ?? 0), []);

  // Answers go one after the other.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sendAnswer = useCallback(
    (raceId: string, index: number, answer: string, onReply: (r: AnswerReply) => void) => {
      if (!seat) return;
      queue.current = queue.current.then(async () => onReply((await post<AnswerReply>("cevap", { oda: seat.roomId, t: seat.token, raceId, index, answer })) as AnswerReply));
    },
    [seat]
  );
  /** "Pas" on question `index` (in the same queue, after the answers typed before it). */
  const sendPass = useCallback(
    (raceId: string, index: number, onReply: (r: AnswerReply) => void) => {
      if (!seat) return;
      queue.current = queue.current.then(async () => onReply((await post<AnswerReply>("cevap", { oda: seat.roomId, t: seat.token, raceId, index, pas: true })) as AnswerReply));
    },
    [seat]
  );

  const mine = seat !== null;
  return {
    view: mine && view?.roomId === seat.roomId ? view : null,
    gone: mine && gone === seat.roomId,
    removed: mine && removed?.roomId === seat.roomId ? removed.reason : null,
    finished: mine && finished?.roomId === seat.roomId ? finished : null,
    offline: mine && offline,
    taken: mine && taken === seat.roomId,
    /** Takes the seat back from the other window. */
    reclaim: () => {
      setTaken(null);
      setAttempt((n) => n + 1);
    },
    serverNow,
    sendAnswer,
    sendPass,
  };
}
