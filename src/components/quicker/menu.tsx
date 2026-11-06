"use client";

import { useState } from "react";
import { QUICKER } from "@/lib/game";
import { DEFAULT_QUESTIONS, QUESTION_COUNTS } from "@/lib/engine";
import { OpenLobbiesPanel, useOpenLobbies } from "./open-lobbies";
import { ScoringTable } from "./scoring-table";
import { ordinal, seconds, type BestRuns, type StoredResult } from "./storage";

// The game page: how to play, the scoring table, the ways in (Quick start / Create lobby / Open lobbies with the list
// of public lobbies waiting for players), this browser's records of every question count and its recent races.

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
      Create lobby
      <span className="block text-xs font-normal text-muted">Invite your friends</span>
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
            See the question, type the answer. No need to press Enter: the right number counts the moment you type it. The first to finish every
            question wins (10 to 30, you choose; {DEFAULT_QUESTIONS} by default); once someone finishes, the others have 20 seconds left. Once a race
            starts it doesn&apos;t stop.
          </p>
          <ScoringTable />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button type="button" onClick={onQuick} className="btn-primary press px-4 py-4 text-lg font-semibold">
              Quick start
              <span className="block text-xs font-normal opacity-90">Race the bots right now</span>
            </button>
            {lobbyButton("px-4 py-4 text-lg font-semibold")}
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              aria-controls="hy-open-lobbies"
              className="btn-secondary press relative px-4 py-4 text-lg font-semibold"
            >
              Open lobbies
              <span className="block text-xs font-normal text-muted">Join a waiting lobby</span>
              {joinable > 0 && (
                <span className="badge-success absolute -top-2 -right-2 min-w-6 px-1.5 py-0.5 text-xs font-bold tabular-nums rounded-full" aria-label={`${joinable} open lobbies`}>
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
          <h2 className="font-semibold">Your records</h2>
          <table className="text-sm w-full mt-1">
            <thead className="text-xs text-muted text-left">
              <tr>
                <th className="font-normal py-1">Questions</th>
                <th className="font-normal py-1 text-right">Points</th>
                <th className="font-normal py-1 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {QUESTION_COUNTS.map((n) => {
                const mine = records.best[String(n)];
                return (
                  <tr key={n} className="border-t border-border tabular-nums">
                    <td className="py-1.5">{n}</td>
                    <td className="py-1.5 text-right">{mine ? <span className="font-bold">{mine.score.toLocaleString("en-US")}</span> : <span className="text-muted">–</span>}</td>
                    <td className="py-1.5 text-right">{mine ? seconds(mine.ms) : <span className="text-muted">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted mt-1">Your highest-scoring race with every question finished (in this browser).</p>
        </div>
        <div>
          <h2 className="font-semibold mb-2">This session&apos;s games</h2>
          {records.results.length === 0 ? (
            <p className="text-sm text-muted">No games yet.</p>
          ) : (
            <table className="text-sm w-full">
              <thead className="text-xs text-muted text-left">
                <tr>
                  <th className="font-normal py-1">Place</th>
                  <th className="font-normal py-1 text-right">Points</th>
                  <th className="font-normal py-1 text-right">Correct</th>
                  <th className="font-normal py-1 text-right">Avg.</th>
                </tr>
              </thead>
              <tbody>
                {records.results.map((r) => (
                  <tr key={r.at} className="border-t border-border tabular-nums">
                    <td className="py-1">{ordinal(r.rank)}</td>
                    <td className="py-1 text-right">{r.points.toLocaleString("en-US")}</td>
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
