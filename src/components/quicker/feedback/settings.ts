"use client";

import { useEffect, useState } from "react";
import { setVolume } from "./audio";

// The game's feedback settings (the top bar's "Ayarlar" menu), remembered in this browser: sound on / off and its
// level, screen effects (rank pulse, particles, tier glow) and screen shakes (the leader's heartbeat bump, the nudge,
// the mistake head-shake). `prefers-reduced-motion` turns effects and shakes off whatever is stored.

export type FeedbackSettings = { sound: boolean; volume: number; effects: boolean; shake: boolean };

const KEY = "quicker:feedback";
/** The sound switch used to live on its own. */
const OLD_SOUND_KEY = "quicker:sound";
const DEFAULTS: FeedbackSettings = { sound: true, volume: 0.8, effects: true, shake: true };

function read(key: string): FeedbackSettings {
  try {
    const raw = window.localStorage.getItem(key);
    const stored = raw ? (JSON.parse(raw) as Partial<FeedbackSettings>) : {};
    const oldSound = key === KEY ? window.localStorage.getItem(OLD_SOUND_KEY) : null;
    const s = { ...DEFAULTS, ...(oldSound === "false" ? { sound: false } : {}), ...stored };
    return { sound: s.sound !== false, volume: typeof s.volume === "number" ? Math.min(1, Math.max(0, s.volume)) : DEFAULTS.volume, effects: s.effects !== false, shake: s.shake !== false };
  } catch {
    return DEFAULTS;
  }
}

function write(key: string, s: FeedbackSettings) {
  try {
    window.localStorage.setItem(key, JSON.stringify(s));
  } catch {
    // not available: nothing is remembered
  }
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The settings, and what may actually run (reduced motion wins over the switches); `key` = the game's own storage key. */
export function useFeedbackSettings(key = KEY) {
  const [settings, setSettings] = useState<FeedbackSettings>(DEFAULTS);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const s = read(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
    setSettings(s);
    setVolume(s.volume);
    setReduced(reducedMotion());
  }, [key]);
  const update = (patch: Partial<FeedbackSettings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      write(key, next);
      if (patch.volume !== undefined) setVolume(next.volume);
      return next;
    });
  return { settings, update, reduced, effects: settings.effects && !reduced, shake: settings.shake && !reduced };
}
