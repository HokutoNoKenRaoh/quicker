"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { unlockAudio } from "./audio";
import type { FeedbackSettings } from "./settings";

/** The top bar's "Ayarlar": sound on / off and its level, screen effects, screen shakes (remembered in this browser). */
export function SettingsMenu({
  settings,
  update,
  reducedMotion,
  hints = { effects: "Place glow, sparks", shake: "Heartbeat in the lead, nudges, mistake shake" },
  large = false,
  closeOnEscape = false,
}: {
  settings: FeedbackSettings;
  update: (patch: Partial<FeedbackSettings>) => void;
  reducedMotion: boolean;
  /** What the two switches do in this game; a game without shakes leaves `shake` out and the switch isn't shown. */
  hints?: { effects: string; shake?: string };
  /** A 44 px frameless button. */
  large?: boolean;
  /** Esc closes the open card first (and goes no further). */
  closeOnEscape?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      // A focus inside the card goes back to its button (the card goes away).
      if (box.current?.contains(document.activeElement)) button.current?.focus();
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    if (closeOnEscape) window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, closeOnEscape]);

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => {
          unlockAudio();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-label="Sound and effect settings"
        title="Settings"
        className={large ? "min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg hover:bg-surface" : "btn-secondary p-2"}
      >
        <SlidersHorizontal size={18} aria-hidden />
      </button>
      {open && (
        <div className="card absolute right-0 top-full mt-2 z-30 w-64 p-4 space-y-3 shadow-xl text-sm" role="group" aria-label="Settings">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="font-semibold">Sound</span>
            <input type="checkbox" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} className="w-4 h-4" />
          </label>
          <label className="block">
            <span className="sr-only">Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.volume * 100)}
              disabled={!settings.sound}
              onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
              aria-label="Volume"
              className="w-full accent-current disabled:opacity-50"
            />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span>
              <span className="font-semibold block">Screen effects</span>
              <span className="text-xs text-muted">{hints.effects}</span>
            </span>
            <input type="checkbox" checked={settings.effects} onChange={(e) => update({ effects: e.target.checked })} className="w-4 h-4 shrink-0" />
          </label>
          {hints.shake !== undefined && (
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span>
                <span className="font-semibold block">Screen shake</span>
                <span className="text-xs text-muted">{hints.shake}</span>
              </span>
              <input type="checkbox" checked={settings.shake} onChange={(e) => update({ shake: e.target.checked })} className="w-4 h-4 shrink-0" />
            </label>
          )}
          {reducedMotion && (
            <p className="text-xs text-muted">Your device has &quot;reduce motion&quot; on: {hints.shake !== undefined ? "effects and shakes stay" : "effects stay"} off.</p>
          )}
        </div>
      )}
    </div>
  );
}
