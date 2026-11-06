"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { COMBO_START, scoreAnswer } from "@/lib/engine";
import type { TrackRacer } from "../race-track";
import { playCorrect, playNudge, playOvertake, playPlace, playPractice, playSkip, playTick, playTierUp, playWrong, setTension } from "./audio";
import { bump, headShake, nudge, rankColor, rankPosition, useRankPulse } from "./effects";

// The game's feedback, driven by events: the race code calls correct() / wrong() / skip() / practice() the moment a key
// decides an answer (no waiting for the server), and the hook itself watches the room for overtakes, the last
// seconds and the final stretch. Sounds, the rank pulse, the leader's bump / nudge, the combo tier label and the
// sparks all start here; settings decide what runs.

/** Combo tiers (tenths): ×1.0–1.4 → 0, ×1.5–1.9 → 1 "Streak!", ×2.0–2.4 → 2 "On fire!", ×2.5 → 3 "Unstoppable!". */
export const comboTier = (tenths: number) => (tenths >= 25 ? 3 : tenths >= 20 ? 2 : tenths >= 15 ? 1 : 0);
const TIER_LABELS = ["", "Streak!", "On fire!", "Unstoppable!"];
/** Answers faster than this raise the combo (the engine's fastest tier). */
const FAST_MS = 1500;
const COMBO_RESET_MS = 3000;
const OVERTAKE_GAP_MS = 500;
const DOUBLE_PULSE_MS = 130;

type Settings = { sound: boolean; effects: boolean; shake: boolean };
type Input = {
  settings: Settings;
  raceId: string | null;
  racing: boolean;
  racers: TrackRacer[];
  meKey: string;
  myAnswered: number;
  /** The player's combo as the server last said (tenths). */
  myCombo: number;
  total: number;
  lastCall: number | null;
  /** Milliseconds since the race started (server clock). */
  sinceStart: () => number;
  windowEl: () => HTMLElement | null;
  cardEl: () => HTMLElement | null;
  labelEl: () => HTMLElement | null;
};

/**
 * Places as the race stands (finished first, then correct answers, then points). The player's own count may be ahead
 * of the server's, and `myExtra` adds the points of an answer the server hasn't confirmed yet.
 */
export function standings(racers: TrackRacer[], meKey: string, myAnswered: number, myExtra = 0) {
  const answered = (r: TrackRacer) => (r.id === meKey ? Math.max(myAnswered, r.answered) : r.answered);
  const score = (r: TrackRacer) => (r.id === meKey ? r.score + myExtra : r.score);
  return [...racers].filter((r) => !r.left || r.id === meKey).sort((a, b) => Number(b.finished) - Number(a.finished) || answered(b) - answered(a) || score(b) - score(a));
}

export function useFeedback(input: Input) {
  const { glow, place: placeEl, pulse } = useRankPulse();
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });
  // Per race: the streak, the estimated combo, the time of the last correct answer, the place after it.
  const state = useRef({ raceId: "", streak: 0, combo: COMBO_START, tier: 0, lastAt: 0, place: 0 });
  const raceState = () => {
    const s = state.current;
    if (s.raceId !== (latest.current.raceId ?? "")) Object.assign(s, { raceId: latest.current.raceId ?? "", streak: 0, combo: COMBO_START, tier: 0, lastAt: performance.now() - latest.current.sinceStart(), place: 0 });
    return s;
  };

  const showLabel = (text: string) => {
    const el = latest.current.labelEl();
    if (!el || !latest.current.settings.effects) return;
    el.textContent = text;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { opacity: 0, transform: "translate(-50%, 6px) scale(0.9)" },
        { opacity: 1, transform: "translate(-50%, 0) scale(1)", offset: 0.2 },
        { opacity: 0, transform: "translate(-50%, -14px)" },
      ],
      { duration: 1100, easing: "ease-out" }
    );
  };

  const sparks = (count: number) => {
    const host = document.querySelector<HTMLElement>("[data-my-avatar]");
    if (!host || !latest.current.settings.effects) return;
    for (let i = 0; i < count; i++) {
      const dot = document.createElement("span");
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const dist = 18 + Math.random() * 14;
      dot.className = "hy-spark pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-primary";
      dot.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      dot.style.setProperty("--dy", `${Math.sin(angle) * dist - 8}px`);
      host.appendChild(dot);
      setTimeout(() => dot.remove(), 600);
    }
  };

  /** A correct answer in the race (call at once, before the server replies). */
  const correct = () => {
    const { settings, racers, meKey, myAnswered, windowEl, total: count } = latest.current;
    const s = raceState();
    const now = performance.now();
    const since = now - s.lastAt;
    s.lastAt = now;
    s.streak++;
    const fast = since < FAST_MS;
    // This answer's points as the server will count them (for the place right now, before its reply).
    const points = scoreAnswer(since, myAnswered + 1, s.combo).points;
    s.combo = fast ? Math.min(25, s.combo + 1) : since >= COMBO_RESET_MS ? COMBO_START : s.combo;
    const tier = comboTier(s.combo);
    const tierUp = tier > s.tier;
    s.tier = tier;
    const order = standings(racers, meKey, myAnswered + 1, points);
    const place = Math.max(1, order.findIndex((r) => r.id === meKey) + 1);
    const field = order.length;
    const prevPlace = s.place;
    s.place = place;

    if (settings.sound) {
      playCorrect(s.streak, tier, fast);
      if (prevPlace && place !== prevPlace && field > 1) playPlace(place < prevPlace);
      if (tierUp) playTierUp(tier);
    }
    if (tierUp && tier > 0) showLabel(TIER_LABELS[tier]!);
    if (settings.effects) {
      const p = field > 1 ? rankPosition(place, field) : fast ? 0 : since < COMBO_RESET_MS ? 0.5 : 1;
      const color = rankColor(p);
      pulse(color, p, since, field > 1 ? `${place}.` : null);
      // The leader: a double green glow with the heartbeat bump.
      if (field > 1 && place === 1) pulse(color, p, since, null, DOUBLE_PULSE_MS);
      if (tier >= 2) sparks(tier >= 3 ? 8 : 5);
    }
    if (settings.shake && field > 1 && place === 1) {
      // Taking 1st place from someone, the top tier or crossing the line first: the full nudge; otherwise the bump.
      const big = (prevPlace > 1 || (tierUp && tier === 3) || myAnswered + 1 >= count) && nudge(windowEl());
      if (big && settings.sound) playNudge();
      else if (!big) bump(windowEl());
    } else if (settings.shake && tierUp && tier === 3 && nudge(windowEl()) && settings.sound) playNudge();
  };

  /** A wrong answer in the race. */
  const wrong = () => {
    const { settings, cardEl } = latest.current;
    const s = raceState();
    const lost = comboTier(s.combo);
    Object.assign(s, { streak: 0, combo: COMBO_START, tier: 0 });
    if (settings.sound) playWrong(lost);
    if (settings.shake) headShake(cardEl());
  };

  /** A pass: the streak and the combo are gone (as on the server), a soft flip; no shake, it wasn't a mistake. */
  const skip = (inRace: boolean) => {
    if (inRace) Object.assign(raceState(), { streak: 0, combo: COMBO_START, tier: 0 });
    if (latest.current.settings.sound) playSkip();
  };

  /** A practice answer during the countdown. */
  const practice = (ok: boolean) => {
    const { settings, cardEl } = latest.current;
    if (settings.sound) (ok ? playPractice : () => playWrong(0))();
    if (!ok && settings.shake) headShake(cardEl());
  };

  // Overtakes, from the room's updates: who moved ahead of the player / fell behind.
  const ahead = useRef<{ raceId: string; ids: Set<string> }>({ raceId: "", ids: new Set() });
  const lastOvertake = useRef(0);
  const { racers, meKey, myAnswered, racing, raceId, total, lastCall, settings } = input;
  const orderKey = racing ? standings(racers, meKey, myAnswered).map((r) => r.id).join(",") : "";
  useEffect(() => {
    if (!orderKey || !raceId) return;
    const ids = orderKey.split(",");
    const mine = ids.indexOf(meKey);
    const now = new Set(ids.slice(0, Math.max(0, mine)));
    const before = ahead.current.raceId === raceId ? ahead.current.ids : null;
    ahead.current = { raceId, ids: now };
    if (!before) return;
    const passedMe = [...now].filter((id) => !before.has(id));
    const iPassed = [...before].filter((id) => !now.has(id));
    if (!passedMe.length && !iPassed.length) return;
    const t = performance.now();
    if (t - lastOvertake.current < OVERTAKE_GAP_MS) return;
    lastOvertake.current = t;
    const { settings: st } = latest.current;
    if (st.sound) playOvertake(iPassed.length > 0 && !passedMe.length);
    if (!st.effects) return;
    for (const id of passedMe) document.querySelector(`[data-lane-head="${CSS.escape(id)}"]`)?.animate([{ boxShadow: "inset 0 0 0 2px var(--color-danger)" }, { boxShadow: "inset 0 0 0 2px transparent" }], { duration: 600, easing: "ease-out" });
    for (const id of iPassed) document.querySelector(`[data-lane-head="${CSS.escape(id)}"]`)?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 500, easing: "ease-out" });
  }, [orderKey, raceId, meKey]);

  // The last 10 seconds: a soft tick each second.
  useEffect(() => {
    if (lastCall !== null && lastCall > 0 && lastCall <= 10 && latest.current.settings.sound) playTick();
  }, [lastCall]);

  // The final stretch: a quiet low pulse while any racer is on their last 3 questions.
  const nearEnd = racing && racers.some((r) => !r.finished && (r.id === meKey ? Math.max(myAnswered, r.answered) : r.answered) >= total - 3);
  useEffect(() => {
    setTension(nearEnd && settings.sound);
    return () => setTension(false);
  }, [nearEnd, settings.sound]);

  return { correct, wrong, skip, practice, glow, placeEl };
}
