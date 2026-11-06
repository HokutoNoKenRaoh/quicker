"use client";

import { useCallback, useRef } from "react";

// Visual feedback that talks to the corner of the eye while the eyes stay on the numbers: a colour pulse from the
// edges of the game window telling the player's place (with the place number flashing in a corner, so colour is
// never the only signal), the leader's heartbeat bump and the MSN-style "nudge" of the whole window, and the
// mistake's sideways head-shake of the question card. Everything is a transform / opacity animation (Web
// Animations API, GPU), identical on iPhone, Android and desktop; nothing ever moves the question relative to its card.
//
// Safety (WCAG 2.3.1): at most 3 pulses in any second, the glow lives at the edges only (the middle of the screen
// stays transparent), peak opacity 0.30, never a full-screen red.

/** The five stops of globals.css (--hy-rank-0 … --hy-rank-4), mixed in OKLCH: p = 0 is 1st, 1 is last. */
export function rankColor(p: number) {
  const x = Math.min(1, Math.max(0, p)) * 4;
  const i = Math.min(3, Math.floor(x));
  const t = Math.round((x - i) * 100);
  return t === 0 ? `var(--hy-rank-${i})` : `color-mix(in oklch, var(--hy-rank-${i + 1}) ${t}%, var(--hy-rank-${i}))`;
}

/** Where the player stands: 0 = 1st … 1 = last (with one racer, the answer's speed decides). */
export const rankPosition = (place: number, racers: number) => (racers > 1 ? (place - 1) / (racers - 1) : 0);

const MAX_PULSES_PER_SECOND = 3;
const PULSE_IN_MS = 80;
const PULSE_HOLD_MS = 60;
const PULSE_MAX_MS = 450;

/** The edge glow and the corner place number; returns the overlay elements' refs and pulse(). */
export function useRankPulse() {
  const glow = useRef<HTMLDivElement>(null);
  const place = useRef<HTMLDivElement>(null);
  const recent = useRef<number[]>([]);

  /**
   * One pulse in `color` for `p` (0 first … 1 last) after an answer `sinceLastMs` after the previous one: total
   * min(450 ms, 0.6 × that), so quick answers give quicker, lighter pulses that never merge into flicker.
   */
  const pulse = useCallback((color: string, p: number, sinceLastMs: number, placeText: string | null, delayMs = 0) => {
    const now = performance.now() + delayMs;
    recent.current = recent.current.filter((t) => now - t < 1000);
    if (recent.current.length >= MAX_PULSES_PER_SECOND) return;
    recent.current.push(now);
    const total = Math.max(PULSE_IN_MS + PULSE_HOLD_MS + 60, Math.min(PULSE_MAX_MS, 0.6 * sinceLastMs));
    // The leader and the last are the strongest; the middle of the field the faintest.
    const peak = 0.18 + 0.12 * Math.abs(p - 0.5) * 2;
    const el = glow.current;
    if (el) {
      el.style.setProperty("--hy-glow", color);
      el.animate(
        [
          { opacity: 0 },
          { opacity: peak, offset: PULSE_IN_MS / total },
          { opacity: peak, offset: (PULSE_IN_MS + PULSE_HOLD_MS) / total },
          { opacity: 0 },
        ],
        { duration: total, delay: delayMs, easing: "ease-out" }
      );
    }
    const num = place.current;
    if (num && placeText) {
      num.textContent = placeText;
      num.style.color = color;
      num.animate([{ opacity: 0, transform: "scale(0.85)" }, { opacity: 0.9, transform: "scale(1)", offset: 0.25 }, { opacity: 0 }], { duration: total + 250, delay: delayMs, easing: "ease-out" });
    }
  }, []);

  return { glow, place, pulse };
}

/** The overlays of useRankPulse, laid over the whole game window (they never take taps). */
export function RankPulseLayer({ glow, place }: { glow: React.RefObject<HTMLDivElement | null>; place: React.RefObject<HTMLDivElement | null> }) {
  return (
    <>
      <div ref={glow} aria-hidden className="hy-edge-glow pointer-events-none absolute inset-0 z-20 opacity-0" />
      {/* The place number flashes in the top right corner, away from the player's own lane (always the first). */}
      <div ref={place} aria-hidden className="pointer-events-none absolute right-4 top-24 md:top-28 z-20 text-5xl md:text-6xl font-black tabular-nums opacity-0" />
    </>
  );
}

let lastNudge = 0;
const NUDGE_GAP_MS = 2000;

/** The leader's heartbeat bump on each correct answer: two quick vertical beats, never sideways. */
export function bump(el: HTMLElement | null) {
  el?.animate(
    [
      { transform: "translateY(0) scale(1)" },
      { transform: "translateY(-3px) scale(1.006)", offset: 0.22 },
      { transform: "translateY(0) scale(1)", offset: 0.45 },
      { transform: "translateY(-2px) scale(1.004)", offset: 0.65 },
      { transform: "translateY(0) scale(1)" },
    ],
    { duration: 260, easing: "ease-out" }
  );
}

/** The MSN-style nudge of a big moment: the whole window jitters diagonally (at most one per 2 s). Returns whether it ran. */
export function nudge(el: HTMLElement | null) {
  const now = performance.now();
  if (!el || now - lastNudge < NUDGE_GAP_MS) return false;
  lastNudge = now;
  const steps = [
    [0, 0],
    [-8, 5],
    [7, -6],
    [-6, -5],
    [6, 6],
    [-4, 3],
    [3, -2],
    [0, 0],
  ];
  el.animate(
    steps.map(([x, y]) => ({ transform: `translate(${x}px, ${y}px)` })),
    { duration: 400, easing: "linear" }
  );
  return true;
}

/** A mistake: the question card shakes its head (3 swings, ±6 px, 250 ms). Only ever used for mistakes. */
export function headShake(el: HTMLElement | null) {
  el?.animate(
    [0, -6, 6, -6, 6, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 250, easing: "ease-in-out" }
  );
}
