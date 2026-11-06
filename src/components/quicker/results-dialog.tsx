"use client";

import { useEffect, useRef } from "react";
import type { AvatarView } from "@/lib/avatar";
import type { MemberResult } from "@/lib/server/registry";
import { RacerAvatar } from "./racer-avatar";
import { racerView, type TrackRacer } from "./race-track";
import { seconds } from "./storage";

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
  againLabel = "Tekrar oyna",
  menuLabel = "Menüye dön",
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
        {won ? (mine.racerCount > 1 ? "Kazandın!" : mine.finished ? "Bitirdin!" : "Süre doldu") : `${winner?.name ?? "Rakibin"} kazandı`}
      </h2>
      <p className="text-center text-3xl font-bold tabular-nums mt-2">{mine.score.toLocaleString("tr-TR")} puan</p>
      <p className="text-center text-sm text-muted mt-1">
        {mine.racerCount > 1 ? `${mine.racerCount} kişi içinde ${mine.placing}.` : "Tek başına"}
        {mine.finished ? "" : ` · ${total} sorudan ${mine.correct}`}
      </p>
      {record && (
        <p className="badge-success block w-fit mx-auto mt-2 px-3 py-1 text-sm font-semibold text-center" role="status">
          {`Yeni rekorun! ${total} soruluk en iyi yarışın (bu tarayıcıda).`}
        </p>
      )}

      <table className="w-full text-sm mt-4">
        <thead className="text-xs text-muted text-left">
          <tr>
            <th className="font-normal py-1 w-10">Sıra</th>
            <th className="font-normal py-1">Yarışçı</th>
            <th className="font-normal py-1 text-right">Doğru</th>
            <th className="font-normal py-1 text-right">Puan</th>
          </tr>
        </thead>
        <tbody>
          {order.map((r, i) => (
            <tr key={r.id} className={`border-t border-border ${r.id === meId ? "font-semibold bg-surface" : ""} ${r.left ? "opacity-50" : ""}`}>
              <td className="py-1.5 tabular-nums">{i + 1}.</td>
              <td className="py-1.5">
                <span className="flex items-center gap-2 min-w-0">
                  <RacerAvatar view={racerView(r, meId, playerView, memberViews)} />
                  <span className="truncate">{r.id === meId ? `${r.name} (sen)` : r.left ? `${r.name} (ayrıldı)` : r.name}</span>
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums">{r.finished ? "✓" : `${r.answered}/${total}`}</td>
              <td className="py-1.5 text-right tabular-nums">{r.score.toLocaleString("tr-TR")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-muted mt-2">Sıra puana göre: her doğru cevap 100–200 puan; bitirene hız bonusu (soru başına 200 ÷ ortalama cevap süresi).</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-4">
        <div>
          <dt className="text-muted text-xs">Doğru cevap</dt>
          <dd className="font-semibold tabular-nums">{mine.correct}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Ortalama süre</dt>
          <dd className="font-semibold tabular-nums">{seconds(mine.averageMs)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Hata</dt>
          <dd className="font-semibold tabular-nums">{mine.wrong}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">En hızlı cevap</dt>
          <dd className="font-semibold tabular-nums">{seconds(mine.fastestMs)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Hız bonusu</dt>
          <dd className="font-semibold tabular-nums">{mine.finished ? `+${mine.bonus.toLocaleString("tr-TR")}` : "–"}</dd>
        </div>
        {mine.finishMs !== null && (
          <div>
            <dt className="text-muted text-xs">Bitiş süresi</dt>
            <dd className="font-semibold tabular-nums">{seconds(mine.finishMs)}</dd>
          </div>
        )}
        {mine.skips > 0 && (
          <div>
            <dt className="text-muted text-xs">Pas</dt>
            <dd className="font-semibold tabular-nums">{mine.skips}</dd>
          </div>
        )}
      </dl>

      <div className="flex gap-3 mt-5">
        <button
          ref={again}
          type="button"
          onClick={() => {
            // Close first: "Tekrar oyna" focuses the answer field in this tap (the keyboard), which a modal blocks.
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
