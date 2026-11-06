"use client";

import { useState } from "react";
import { QUICKER } from "@/lib/game";
import { DEFAULT_QUESTIONS, QUESTION_COUNTS } from "@/lib/engine";
import { OpenLobbiesPanel, useOpenLobbies } from "./open-lobbies";
import { ScoringTable } from "./scoring-table";
import { seconds, type BestRuns, type StoredResult } from "./storage";

// The game page: how to play, the scoring table, the ways in (Hızlı başla / Lobi kur / Açık lobiler with the list of
// public lobbies waiting for players), this browser's records of every question count and its recent races.

export type Records = { results: StoredResult[]; best: BestRuns };

export function Menu({
  onQuick,
  onLobby,
  records,
  paused = false,
}: {
  onQuick: () => void;
  onLobby: () => void;
  records: Records;
  /** Under an open game window: the lobby list doesn't poll. */
  paused?: boolean;
}) {
  const [listOpen, setListOpen] = useState(false);
  const lobbies = useOpenLobbies(listOpen, paused);
  const joinable = lobbies?.filter((l) => !l.racing && !l.full).length ?? 0;
  const lobbyButton = (className: string) => (
    <button type="button" onClick={onLobby} className={`btn-secondary press ${className}`}>
      Lobi kur
      <span className="block text-xs font-normal text-muted">Arkadaşlarını davet et</span>
    </button>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-6 items-start">
      <div className="space-y-6 min-w-0">
        <section className="card p-6 space-y-5">
          <div>
            <h1 lang={QUICKER.lang} className="text-2xl font-bold normal-case">{QUICKER.title}</h1>
            <p className="text-muted mt-1">{QUICKER.description}</p>
          </div>
          <p>
            Soruyu gör, cevabı yaz. Enter&apos;a basmana gerek yok: doğru sayıyı yazdığın an kabul edilir. Soruların hepsini ilk bitiren kazanır
            (10 ile 30 arası, sen seçersin; varsayılan {DEFAULT_QUESTIONS}); biri bitirince diğerlerinin 20 saniyesi kalır. Yarış başladıktan sonra durmaz.
          </p>
          <ScoringTable />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button type="button" onClick={onQuick} className="btn-primary press px-4 py-4 text-lg font-semibold">
              Hızlı başla
              <span className="block text-xs font-normal opacity-90">Botlara karşı hemen yarış</span>
            </button>
            {lobbyButton("px-4 py-4 text-lg font-semibold")}
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              aria-controls="hy-open-lobbies"
              className="btn-secondary press relative px-4 py-4 text-lg font-semibold"
            >
              Açık lobiler
              <span className="block text-xs font-normal text-muted">Bekleyen bir lobiye katıl</span>
              {joinable > 0 && (
                <span className="badge-success absolute -top-2 -right-2 min-w-6 px-1.5 py-0.5 text-xs font-bold tabular-nums rounded-full" aria-label={`${joinable} açık lobi`}>
                  {joinable}
                </span>
              )}
            </button>
          </div>
          {listOpen && <OpenLobbiesPanel lobbies={lobbies} create={lobbyButton("px-4 py-3 font-semibold inline-block")} />}
        </section>
      </div>
      <aside className="card p-5 space-y-4 h-fit">
        <div>
          <h2 className="font-semibold">Rekorların</h2>
          <table className="text-sm w-full mt-1">
            <thead className="text-xs text-muted text-left">
              <tr>
                <th className="font-normal py-1">Soru</th>
                <th className="font-normal py-1 text-right">Puan</th>
                <th className="font-normal py-1 text-right">Süre</th>
              </tr>
            </thead>
            <tbody>
              {QUESTION_COUNTS.map((n) => {
                const mine = records.best[String(n)];
                return (
                  <tr key={n} className="border-t border-border tabular-nums">
                    <td className="py-1.5">{n}</td>
                    <td className="py-1.5 text-right">{mine ? <span className="font-bold">{mine.score.toLocaleString("tr-TR")}</span> : <span className="text-muted">–</span>}</td>
                    <td className="py-1.5 text-right">{mine ? seconds(mine.ms) : <span className="text-muted">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted mt-1">Bütün soruları bitirdiğin en yüksek puanlı yarış (bu tarayıcıda).</p>
        </div>
        <div>
          <h2 className="font-semibold mb-2">Bu oturumdaki oyunların</h2>
          {records.results.length === 0 ? (
            <p className="text-sm text-muted">Henüz oyun yok.</p>
          ) : (
            <table className="text-sm w-full">
              <thead className="text-xs text-muted text-left">
                <tr>
                  <th className="font-normal py-1">Sıra</th>
                  <th className="font-normal py-1 text-right">Puan</th>
                  <th className="font-normal py-1 text-right">Doğru</th>
                  <th className="font-normal py-1 text-right">Ort.</th>
                </tr>
              </thead>
              <tbody>
                {records.results.map((r) => (
                  <tr key={r.at} className="border-t border-border tabular-nums">
                    <td className="py-1">{r.rank}.</td>
                    <td className="py-1 text-right">{r.points.toLocaleString("tr-TR")}</td>
                    <td className="py-1 text-right">
                      {r.correct}/{r.total ?? 30}
                    </td>
                    <td className="py-1 text-right">{seconds(r.averageMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>
  );
}
