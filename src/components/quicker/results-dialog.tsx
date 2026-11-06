"use client";

import { useEffect, useRef } from "react";
import type { AvatarView } from "@/lib/avatar";
import type { MemberResult } from "@/lib/server/registry";
import { RacerAvatar } from "./racer-avatar";
import { racerView, type TrackRacer } from "./race-track";
import { ordinal, seconds } from "./storage";

// The results card over the frozen track (native modal dialog: focus moves in and stays there; Escape does nothing so
// the result isn't dismissed by accident). Everything here comes from the server.
export function ResultsDialog({
  order,
  mine,
  total,
  meId,
  playerView,
  memberViews,
  celebrate = false,
  record = false,
  againLabel = "Play again",
  menuLabel = "Back to menu",
  onAgain,
  onMenu,
}: {
  order: TrackRacer[];
  mine: MemberResult;
  /** The race's question count. */
  total: number;
  meId: string;
  playerView: AvatarView;
  memberViews: Record<string, AvatarView>;
  /** 1st place (with screen effects on): a short burst of sparks over the card. */
  celebrate?: boolean;
  /** A new record of this browser. */
  record?: boolean;
  againLabel?: string;
  menuLabel?: string;
  onAgain: () => void;
  onMenu: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    again.current?.focus();
  }, []);
  const won = mine.placing === 1;
  const winner = order[0];

  return (
    <dialog
      ref={dialog}
      aria-labelledby="hy-result-title"
      onCancel={(e) => e.preventDefault()}
      // color-guard-allow: the dimming backdrop is dark in every theme and mode
      className="card m-auto w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-y-auto p-5 rounded-2xl backdrop:bg-black/50 [--hy-avatar:28px]"
    >
      {celebrate && (
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-12">
          {Array.from({ length: 14 }, (_, i) => {
            const a = (Math.PI * 2 * i) / 14;
            return (
              <span
                key={i}
                className="hy-spark absolute h-2 w-2 rounded-full bg-primary"
                style={{ "--dx": `${Math.cos(a) * 90}px`, "--dy": `${Math.sin(a) * 50}px`, animationDuration: "0.9s" } as React.CSSProperties}
              />
            );
          })}
        </span>
      )}
      <h2 id="hy-result-title" className={`text-2xl font-bold text-center ${won ? "text-primary" : ""}`}>
        {won ? (mine.racerCount > 1 ? "You won!" : mine.finished ? "Finished!" : "Time's up") : `${winner?.name ?? "Your rival"} won`}
      </h2>
      <p className="text-center text-3xl font-bold tabular-nums mt-2">{mine.score.toLocaleString("en-US")} points</p>
      <p className="text-center text-sm text-muted mt-1">
        {mine.racerCount > 1 ? `${ordinal(mine.placing)} of ${mine.racerCount}` : "Solo"}
        {mine.finished ? "" : ` · ${mine.correct} of ${total} questions`}
      </p>
      {record && (
        <p className="badge-success block w-fit mx-auto mt-2 px-3 py-1 text-sm font-semibold text-center" role="status">
          {`New record! Your best ${total}-question race (in this browser).`}
        </p>
      )}

      <table className="w-full text-sm mt-4">
        <thead className="text-xs text-muted text-left">
          <tr>
            <th className="font-normal py-1 w-10">Place</th>
            <th className="font-normal py-1">Racer</th>
            <th className="font-normal py-1 text-right">Correct</th>
            <th className="font-normal py-1 text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {order.map((r, i) => (
            <tr key={r.id} className={`border-t border-border ${r.id === meId ? "font-semibold bg-surface" : ""} ${r.left ? "opacity-50" : ""}`}>
              <td className="py-1.5 tabular-nums">{i + 1}.</td>
              <td className="py-1.5">
                <span className="flex items-center gap-2 min-w-0">
                  <RacerAvatar view={racerView(r, meId, playerView, memberViews)} />
                  <span className="truncate">{r.id === meId ? `${r.name} (you)` : r.left ? `${r.name} (left)` : r.name}</span>
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums">{r.finished ? "✓" : `${r.answered}/${total}`}</td>
              <td className="py-1.5 text-right tabular-nums">{r.score.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-muted mt-2">Placed by points: each correct answer scores 100–200; finishing adds a speed bonus (200 per question ÷ average answer time).</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-4">
        <div>
          <dt className="text-muted text-xs">Correct answers</dt>
          <dd className="font-semibold tabular-nums">{mine.correct}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Average time</dt>
          <dd className="font-semibold tabular-nums">{seconds(mine.averageMs)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Mistakes</dt>
          <dd className="font-semibold tabular-nums">{mine.wrong}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Fastest answer</dt>
          <dd className="font-semibold tabular-nums">{seconds(mine.fastestMs)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Speed bonus</dt>
          <dd className="font-semibold tabular-nums">{mine.finished ? `+${mine.bonus.toLocaleString("en-US")}` : "–"}</dd>
        </div>
        {mine.finishMs !== null && (
          <div>
            <dt className="text-muted text-xs">Finish time</dt>
            <dd className="font-semibold tabular-nums">{seconds(mine.finishMs)}</dd>
          </div>
        )}
        {mine.skips > 0 && (
          <div>
            <dt className="text-muted text-xs">Passes</dt>
            <dd className="font-semibold tabular-nums">{mine.skips}</dd>
          </div>
        )}
      </dl>

      <div className="flex gap-3 mt-5">
        <button
          ref={again}
          type="button"
          onClick={() => {
            // Close first: "Play again" focuses the answer field in this tap (the keyboard), which a modal blocks.
            dialog.current?.close();
            onAgain();
          }}
          className="btn-primary press flex-1 py-2.5 font-semibold"
        >
          {againLabel}
        </button>
        <button type="button" onClick={onMenu} className="btn-secondary flex-1 py-2.5 text-sm">
          {menuLabel}
        </button>
      </div>
    </dialog>
  );
}
