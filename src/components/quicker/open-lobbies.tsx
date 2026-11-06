"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BOT_LEVELS, MAX_RACERS, type BotLevel } from "@/lib/engine";
import type { OpenLobby, Visibility } from "@/lib/server/registry";
import { lobbyPath } from "@/lib/game";
import { RacerAvatar } from "./racer-avatar";

// "Açık lobiler" on the game page: the public lobbies waiting for players (GET ../lobiler), refreshed every 4 s while
// the list is open and the tab is visible, the button's count every 15 s. Katıl opens the lobby's own link, so joining
// works exactly as with an invite (seat rules, a guest's cookie). Also the Herkese açık / Sadece davetle switch of
// Lobi kur and the lobby.

const API = "/api/quicker/lobiler";
const OPEN_MS = 4000;
const CLOSED_MS = 15_000;


/** The public lobbies (null until the first answer); polls faster while the list is open, not at all while `paused`
 *  (the menu under an open game window). */
export function useOpenLobbies(open: boolean, paused = false) {
  const [lobbies, setLobbies] = useState<OpenLobby[] | null>(null);
  useEffect(() => {
    if (paused) return;
    let off = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(API, { cache: "no-store" });
          const data = (await res.json()) as { ok: boolean; lobbies?: OpenLobby[] };
          if (!off && data.ok && data.lobbies) setLobbies(data.lobbies);
        } catch {
          // offline for a moment: the next round tries again
        }
      }
      if (!off) timer = setTimeout(load, open ? OPEN_MS : CLOSED_MS);
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, paused]);
  return lobbies;
}

/** "+3 bot (Orta, Zor…)" */
function botsText(bots: BotLevel[]) {
  if (!bots.length) return "bot yok";
  const labels = [...new Set(bots)].map((l) => BOT_LEVELS[l].label);
  return `+${bots.length} bot (${labels.slice(0, 2).join(", ")}${labels.length > 2 ? "…" : ""})`;
}

const openText = (ms: number) => (ms < 60_000 ? "yeni" : `${Math.round(ms / 60_000)} dk`);

export function OpenLobbiesPanel({ lobbies, create }: { lobbies: OpenLobby[] | null; create: React.ReactNode }) {
  return (
    <section id="hy-open-lobbies" aria-labelledby="hy-open-lobbies-title" className="space-y-3 [--hy-avatar:32px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="hy-open-lobbies-title" className="font-semibold">
          Açık lobiler
        </h2>
        <span className="text-xs text-muted">Kendiliğinden yenilenir</span>
      </div>
      {lobbies === null ? (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      ) : lobbies.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Şu anda açık lobi yok. Sen bir tane kur, başkaları burada görsün.</p>
          {create}
        </div>
      ) : (
        // No live region on the rows (the poll re-renders them every 4 s): the count is announced instead. The box keeps
        // about four rows' height and scrolls beyond them, so rows coming and going don't move the page below.
        <>
        <p className="sr-only" role="status">{`${lobbies.filter((l) => !l.racing && !l.full).length} açık lobi`}</p>
        <ul className="divide-y divide-border border border-border rounded-md min-h-[8.5rem] max-h-[17rem] overflow-y-auto">
          {lobbies.map((l) => (
            <li key={l.code} className={`flex items-center gap-3 p-3 ${l.racing || l.full ? "opacity-60" : ""}`}>
              <RacerAvatar view={l.host.avatar} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate">{l.host.name}</p>
                <p className="text-xs text-muted tabular-nums">
                  {l.people}/{MAX_RACERS} kişi · {botsText(l.bots)} · {l.questionCount} soru · {openText(l.openMs)}
                </p>
              </div>
              {l.racing ? (
                <span className="badge-neutral px-2 py-1 text-xs shrink-0">Yarış sürüyor</span>
              ) : l.full ? (
                <span className="badge-neutral px-2 py-1 text-xs shrink-0">Dolu</span>
              ) : (
                <Link href={lobbyPath(l.code)} className="btn-primary press px-4 py-2 text-sm font-semibold shrink-0">
                  Katıl
                </Link>
              )}
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}

const VISIBILITY = [
  { key: "ACIK", label: "Herkese açık", note: "Açık lobiler listesinde görünür; bağlantısı olmayan da katılabilir." },
  { key: "DAVET", label: "Sadece davetle", note: "Listede görünmez; yalnızca davet bağlantısıyla girilir." },
] as const;

/** Herkese açık / Sadece davetle (read-only for everyone but the host). */
export function VisibilityPicker({ value, onChange }: { value: Visibility; onChange?: (v: Visibility) => void }) {
  const current = VISIBILITY.find((v) => v.key === value)!;
  if (!onChange) return <p className="text-sm text-muted">{current.label} lobi.</p>;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold mb-2">Lobiyi kimler görsün?</legend>
      <div className="grid grid-cols-2 gap-2">
        {VISIBILITY.map((v) => (
          <button
            key={v.key}
            type="button"
            aria-pressed={value === v.key}
            onClick={() => onChange(v.key)}
            className={`${value === v.key ? "btn-primary" : "btn-secondary"} px-3 py-2 text-sm font-semibold`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{current.note}</p>
    </fieldset>
  );
}
