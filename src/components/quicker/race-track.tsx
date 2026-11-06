"use client";

import { Timer } from "lucide-react";
import { letterAvatar, type AvatarView } from "@/lib/avatar";
import type { RoomView } from "@/lib/server/registry";
import { RacerAvatar } from "./racer-avatar";

// Up to six lanes (the viewer always first, then the other people in join order, bots last): a compact strip of names
// and points on top, then the lanes with a thin chequered finish line, avatars that jump one step up their lane per
// correct answer and a "+100" rising over them (the finishing speed bonus with a clock). Avatars stay inside the lanes
// (never over a name). A person who left stays greyed out ("left").

export type TrackRacer = RoomView["racers"][number];
export type Float = { seq: number; racerId: string; points: number; bonus: boolean };

/** Faint "+ − = 1 2 3" pattern in currentColor behind the lanes, readable in every theme and mode. */
function MathPattern() {
  return (
    <svg aria-hidden className="absolute inset-0 w-full h-full text-muted opacity-[0.05] pointer-events-none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="hy-math" width="120" height="120" patternUnits="userSpaceOnUse">
          <g fill="currentColor" fontFamily="inherit" fontWeight="700" fontSize="18">
            <text x="8" y="24">+</text>
            <text x="64" y="34">7</text>
            <text x="30" y="70">−</text>
            <text x="92" y="78">=</text>
            <text x="12" y="108">3</text>
            <text x="70" y="112">9</text>
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hy-math)" />
    </svg>
  );
}

/** A person's avatar from the room's member list, else the first letter of the name. */
export function racerView(r: { id: string; name: string; human: boolean; avatar: string | null }, meId: string, playerView: AvatarView, memberViews: Record<string, AvatarView>): AvatarView {
  if (r.id === meId) return playerView;
  return (r.human && memberViews[r.id]) || letterAvatar(r.name);
}

function laneOrder<T extends { id: string; human: boolean }>(racers: T[], meId: string): T[] {
  return [...racers.filter((r) => r.id === meId), ...racers.filter((r) => r.id !== meId && r.human), ...racers.filter((r) => !r.human)];
}

export function RaceTrack({
  racers,
  total,
  floats,
  meId,
  myAnswered,
  myTier = 0,
  playerView,
  memberViews,
  dimmed = false,
  children,
}: {
  racers: TrackRacer[];
  /** The race's question count (the finish line). */
  total: number;
  floats: Float[];
  meId: string;
  /** The viewer's own progress as the browser knows it (one step ahead of the server while an answer is on its way). */
  myAnswered: number;
  /** The player's combo tier with screen effects on (3: a faint trail behind the avatar). */
  myTier?: number;
  playerView: AvatarView;
  memberViews: Record<string, AvatarView>;
  /** The countdown's warm-up: the lanes wait faded until the start. */
  dimmed?: boolean;
  children?: React.ReactNode;
}) {
  const lanes = laneOrder(racers, meId);
  const columns = { gridTemplateColumns: `repeat(${Math.max(lanes.length, 1)}, minmax(0, 1fr))` };
  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface border border-border overflow-hidden [--hy-avatar:28px] md:[--hy-avatar:44px]">
      {/* Lane headers: one compact strip of names and points above the lanes (never under an avatar). */}
      <div className="shrink-0 grid border-b border-border bg-card" style={columns} aria-hidden>
        {lanes.map((r, i) => {
          const isMe = r.id === meId;
          return (
            <div key={r.id} data-lane-head={r.id} className={`min-w-0 px-1 py-1 text-center ${i > 0 ? "border-l border-dashed border-border" : ""} ${r.left ? "opacity-40" : ""}`}>
              <div className={`truncate text-[11px] md:text-sm leading-tight ${isMe ? "font-bold text-primary" : "font-medium"}`} title={r.name}>
                {isMe ? "You" : r.name}
              </div>
              <div className="text-[11px] md:text-sm leading-tight font-semibold tabular-nums">
                {r.left ? (
                  <span className="text-muted font-normal">left</span>
                ) : (
                  <>
                    {r.score.toLocaleString("en-US")}
                    {r.finished && <span className="text-success-text"> ✓</span>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* The lanes: the finish line across the top, the avatars climbing from the bottom (clipped to the lanes). */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <MathPattern />
        <div aria-hidden className="hy-finish absolute inset-x-0 top-0 h-2" />
        <span aria-hidden className="absolute right-1.5 top-2.5 text-[9px] md:text-[10px] font-semibold tracking-[0.25em] text-muted">
          FINISH
        </span>
        <ol className={`relative grid h-full pt-3 transition-opacity duration-300 ${dimmed ? "opacity-40" : ""}`} style={columns} aria-label="Racers">
          {lanes.map((r, i) => {
            const isMe = r.id === meId;
            const answered = isMe ? Math.max(myAnswered, r.answered) : r.answered;
            const mine = floats.filter((f) => f.racerId === r.id);
            return (
              <li key={r.id} className={`relative min-w-0 ${i > 0 ? "border-l border-dashed border-border" : ""} ${isMe ? "bg-card/60" : ""} ${r.left ? "opacity-40" : ""}`}>
                <div
                  className="absolute left-1/2 -translate-x-1/2 transition-[bottom] duration-300 ease-out motion-reduce:transition-none"
                  style={{ bottom: `calc(${Math.min(answered / total, 1)} * (100% - var(--hy-avatar)))` }}
                >
                  {mine.map((f) => (
                    <span
                      key={f.seq}
                      className={`hy-float absolute left-1/2 bottom-full flex items-center gap-0.5 text-xs md:text-sm font-bold whitespace-nowrap ${f.bonus ? "mb-6" : "mb-1"} ${isMe ? "text-primary" : "text-success-text"}`}
                      aria-hidden
                    >
                      {f.bonus && <Timer size={12} aria-hidden />}+{f.points.toLocaleString("en-US")}
                    </span>
                  ))}
                  {/* The top combo tier: a faint trail behind the player's avatar. */}
                  {isMe && myTier >= 3 && (
                    <span aria-hidden className="absolute left-1/2 top-full -translate-x-1/2 w-1.5 h-16 rounded-full bg-gradient-to-b from-primary/50 to-transparent" />
                  )}
                  {/* Sparks of the combo tiers are added here (feedback/use-feedback.ts). */}
                  <span className="relative block" data-my-avatar={isMe ? "" : undefined}>
                    <RacerAvatar view={racerView(r, meId, playerView, memberViews)} ring={isMe} />
                  </span>
                </div>
                <span className="sr-only">
                  {isMe ? "You" : r.name}: {answered} correct, {r.score} points{r.left ? ", left" : ""}
                </span>
              </li>
            );
          })}
        </ol>
        {/* The countdown / "GO!" overlays sit over the lanes only. */}
        {children}
      </div>
    </div>
  );
}
