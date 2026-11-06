"use client";

import { useSyncExternalStore } from "react";
import { Delete } from "lucide-react";

// Answering without a text field. Touch screens get this on-screen keypad: no system keyboard ever opens, so there is
// no iOS AutoFill bar, no keyboard-hide button, no site strip above the keyboard and no layout jump between the
// countdown and the race. Computers (and touch screens with a fine pointer) type on their own keyboard: the game
// listens for the keys (quicker.tsx). Both feed the same answer box. "Pass" has no key here:
// it is a swipe or a double tap on the question card, Tab on a keyboard.

export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "BACKSPACE" | "CLEAR" | "PASS";

const KEYPAD_QUERY = "(pointer: coarse)";
const FINE_QUERY = "(any-pointer: fine)";

function subscribe(onChange: () => void) {
  const queries = [window.matchMedia(KEYPAD_QUERY), window.matchMedia(FINE_QUERY)];
  for (const q of queries) q.addEventListener("change", onChange);
  return () => {
    for (const q of queries) q.removeEventListener("change", onChange);
  };
}
const keypadWanted = () => window.matchMedia(KEYPAD_QUERY).matches && !window.matchMedia(FINE_QUERY).matches;

/** True on touch-only devices (phones, tablets without a mouse or trackpad). */
export function useTouchKeypad() {
  return useSyncExternalStore(subscribe, keypadWanted, () => false);
}

const COARSE_ANY_QUERY = "(any-pointer: coarse)";
const touchScreen = () => navigator.maxTouchPoints > 0 || window.matchMedia(COARSE_ANY_QUERY).matches;
const subscribeAny = (onChange: () => void) => {
  const q = window.matchMedia(COARSE_ANY_QUERY);
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
};

/** True on every device with a touch screen (also a tablet with a keyboard cover or a touch laptop). */
export function useTouchScreen() {
  return useSyncExternalStore(subscribeAny, touchScreen, () => false);
}

/** Up to an iPad Pro in landscape: a touch screen this wide plays full screen, like a phone. */
const TABLET_QUERY = "(max-width: 1366px)";
const subscribeTablet = (onChange: () => void) => {
  const q = window.matchMedia(TABLET_QUERY);
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
};
export function useTabletWidth() {
  return useSyncExternalStore(subscribeTablet, () => window.matchMedia(TABLET_QUERY).matches, () => false);
}

/** The typed digits, in place of a text field (screen readers hear each change): a filled answer area with a caret. */
export function AnswerBox({ value, placeholder, state, compact = false }: { value: string; placeholder: string; state?: "wrong" | null; compact?: boolean }) {
  return (
    <div
      aria-live="polite"
      aria-label="Your answer"
      className={`relative w-full ${compact ? "h-10 text-2xl" : "h-14 text-3xl"} flex items-center justify-center rounded-xl bg-surface border border-border font-bold tabular-nums ${state === "wrong" ? "hy-wrong-box" : ""}`}
    >
      {value}
      <span aria-hidden className={`hy-caret ml-0.5 ${compact ? "h-6" : "h-8"} w-0.5 bg-primary`} />
      {!value && <span className="absolute right-3 text-xs font-normal text-muted">{placeholder}</span>}
    </div>
  );
}

// No "C": the answer is one or two digits, ⌫ clears it as fast. The 0 is twice as wide (under 7 and 8).
const ROWS: PadKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["0", "BACKSPACE"],
];

/**
 * The on-screen keypad, phone layout. Keys act on pointerdown (no 300 ms click delay, each finger counts once, two
 * thumbs can alternate fast); synthetic events are ignored like typed ones. The pressed look is set on the element
 * directly so it shows at once without a re-render.
 */
export function Keypad({ onKey, disabled = false, compact = false }: { onKey: (key: PadKey, at: number) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <div className={`hy-keypad grid grid-cols-3 grid-rows-4 ${compact ? "gap-1.5" : "gap-2"} h-full`} role="group" aria-label="Number keys" onContextMenu={(e) => e.preventDefault()}>
      {ROWS.flat().map((k) => (
        <button
          key={k}
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={k === "BACKSPACE" ? "Delete the last digit" : k}
          onPointerDown={(e) => {
            if (!e.isTrusted || disabled) return;
            e.preventDefault();
            e.currentTarget.dataset.down = "";
            onKey(k, e.timeStamp);
          }}
          onPointerUp={(e) => delete e.currentTarget.dataset.down}
          onPointerCancel={(e) => delete e.currentTarget.dataset.down}
          onPointerLeave={(e) => delete e.currentTarget.dataset.down}
          className={`hy-key ${k === "0" ? "col-span-2" : ""} ${compact ? "min-h-[40px]" : "min-h-[52px]"} rounded-xl flex items-center justify-center bg-surface border border-border text-foreground text-3xl font-semibold tabular-nums disabled:opacity-40`}
        >
          {k === "BACKSPACE" ? <Delete size={30} aria-hidden /> : k}
        </button>
      ))}
    </div>
  );
}
