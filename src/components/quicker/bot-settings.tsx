"use client";

import { BOT_LEVELS, BOT_LEVEL_KEYS, MAX_RACERS, type BotLevel } from "@/lib/engine";

// Bot settings of the setup screen and the lobby: how many bots (0–5, fewer when people take the seats) and a level
// per slot, with one-tap presets. Read-only for everyone but the lobby's host.

/** The default ("Mixed"): an above-average player beats these; strong bots only when the player picks them. */
export const DEFAULT_BOTS: BotLevel[] = ["MEDIUM", "MEDIUM", "EASY", "EASY", "EASY"];
const PRESETS: { label: string; levels: BotLevel[] }[] = [
  { label: "All easy", levels: Array(MAX_RACERS - 1).fill("EASY") },
  { label: "Mixed", levels: DEFAULT_BOTS },
  { label: "Tough", levels: ["EXPERT", "HARD", "HARD", "MEDIUM", "MEDIUM"] },
  { label: "All experts", levels: Array(MAX_RACERS - 1).fill("EXPERT") },
];
const NEW_SLOT: BotLevel = "MEDIUM";

const same = (a: BotLevel[], b: BotLevel[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function BotSettings({ value, onChange, max = MAX_RACERS - 1 }: { value: BotLevel[]; onChange?: (levels: BotLevel[]) => void; max?: number }) {
  const bots = value.slice(0, max);
  if (!onChange) {
    return (
      <div>
        <h3 className="text-sm font-semibold mb-2">Bots</h3>
        {bots.length === 0 ? (
          <p className="text-sm text-muted">No bots.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {bots.map((level, i) => (
              <li key={i} className="badge-neutral px-2 py-0.5 text-xs">
                Bot {i + 1}: {BOT_LEVELS[level].label}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const setCount = (n: number) => onChange(n <= bots.length ? bots.slice(0, n) : [...bots, ...Array<BotLevel>(n - bots.length).fill(NEW_SLOT)]);
  const setLevel = (i: number, level: BotLevel) => onChange(bots.map((x, j) => (j === i ? level : x)));
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold mb-2" id="hy-bot-count">
          Bots
        </h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="hy-bot-count">
          {Array.from({ length: max + 1 }, (_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              aria-pressed={bots.length === n}
              className={`${bots.length === n ? "btn-primary" : "btn-secondary"} w-10 h-10 text-sm font-semibold tabular-nums`}
            >
              {n}
            </button>
          ))}
        </div>
        {bots.length === 0 && <p className="text-xs text-muted mt-1.5">No bots: just you against the clock.</p>}
      </div>
      {max > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Presets">
          {PRESETS.map((p) => {
            const levels = p.levels.slice(0, max);
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange(levels)}
                aria-pressed={same(bots, levels)}
                className={`${same(bots, levels) ? "btn-primary" : "btn-secondary"} px-3 py-1.5 text-xs`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
      {bots.length > 0 && (
        <ul className="space-y-2">
          {bots.map((level, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-sm text-muted w-12 shrink-0" id={`hy-bot-${i}`}>
                Bot {i + 1}
              </span>
              <div className="flex flex-wrap gap-1" role="group" aria-labelledby={`hy-bot-${i}`}>
                {BOT_LEVEL_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setLevel(i, k)}
                    aria-pressed={level === k}
                    className={`${level === k ? "btn-primary" : "btn-secondary"} px-2.5 py-1 text-xs`}
                  >
                    {BOT_LEVELS[k].label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
