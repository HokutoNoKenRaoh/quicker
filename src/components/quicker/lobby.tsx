"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { MAX_RACERS, type BotLevel, type QuestionCount } from "@/lib/engine";
import type { RoomView, Visibility } from "@/lib/server/registry";
import { QUICKER, lobbyPath } from "@/lib/game";
import { BotSettings } from "./bot-settings";
import { VisibilityPicker } from "./open-lobbies";
import { QuestionCountPicker } from "./question-count";
import { RacerAvatar } from "./racer-avatar";

// The lobby: the invite link (copy / share sheet), the player's own name, the people with their "Ready" state, the
// question count, the bot slots and public / invite-only (the host edits them) and the "2/6" count. "I'm ready" / Start
// sit in the question card below it (their tap opens the keyboard).


export function LobbyScreen({
  view,
  onBots,
  onQuestions,
  onKick,
  onRename,
  onVisibility,
  intro,
}: {
  view: RoomView;
  /** The first-time "How to play" card. */
  intro?: React.ReactNode;
  onVisibility: (v: Visibility) => void;
  onBots: (levels: BotLevel[]) => void;
  onQuestions: (count: QuestionCount) => void;
  onKick: (key: string) => void;
  /** The player's name; resolves to the error message, or null when saved. */
  onRename: (name: string) => Promise<string | null>;
}) {
  const [copied, setCopied] = useState(false);
  const code = view.code ?? "";
  const url = typeof window === "undefined" ? lobbyPath(code) : `${window.location.origin}${lobbyPath(code)}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const host = view.me.host;
  const count = view.members.length + view.botLevels.length;
  const meMember = view.members.find((m) => m.key === view.me.key);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const share = () => void navigator.share({ title: QUICKER.title, text: `Join my ${QUICKER.title} lobby and race me!`, url }).catch(() => {});

  return (
    <section className="card p-4 md:p-6 w-full max-w-xl mx-auto overflow-y-auto space-y-5 [--hy-avatar:36px]">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-lg font-bold">
          Lobby <span className="font-mono tracking-widest text-primary">{code}</span>
        </h2>
        <span className="text-sm text-muted tabular-nums" aria-label={`${count} of ${MAX_RACERS} racers`}>
          {count}/{MAX_RACERS}
        </span>
      </div>

      {intro}
      <div className="space-y-2">
        <p className="text-sm text-muted">Send this link to the people you want to race.</p>
        <div className="flex flex-wrap gap-2">
          <input readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className="field flex-1 min-w-0 px-3 py-2 text-sm" />
          <button type="button" onClick={copy} className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5">
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </button>
          {canShare && (
            <button type="button" onClick={share} className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5">
              <Share2 size={16} aria-hidden /> Share
            </button>
          )}
        </div>
      </div>

      {meMember?.guest && !meMember.ready && <GuestName key={meMember.key} current={meMember.name} onRename={onRename} />}

      <div>
        <h3 className="text-sm font-semibold mb-2">Players</h3>
        <ul className="space-y-2">
          {view.members.map((m) => {
            const me = m.key === view.me.key;
            return (
              <li key={m.key} className={`flex items-center gap-3 ${m.here ? "" : "opacity-60"}`}>
                <RacerAvatar view={m.avatar} ring={me} />
                <span className={`truncate ${me ? "font-semibold" : ""}`}>{m.name}</span>
                {me && <span className="badge-info px-2 py-0.5 text-xs">You</span>}
                {m.host && <span className="badge-neutral px-2 py-0.5 text-xs">Host</span>}
                {m.sameNetwork && (
                  <span className="badge-warning px-2 py-0.5 text-xs" title="This player connects from the same network as someone else in the lobby (it may be the same person).">
                    same network
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2 shrink-0">
                  {!m.here && <span className="text-xs text-muted">not connected</span>}
                  {m.host ? null : m.ready ? <span className="badge-success px-2 py-0.5 text-xs">Ready</span> : <span className="badge-warning px-2 py-0.5 text-xs">Waiting</span>}
                  {host && !me && (
                    <button type="button" onClick={() => onKick(m.key)} className="btn-secondary px-2 py-1 text-xs" aria-label={`Remove ${m.name} from the lobby`}>
                      Remove
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <QuestionCountPicker value={view.questionCount} onChange={host ? onQuestions : undefined} />
      <BotSettings value={view.botLevels} onChange={host ? onBots : undefined} max={MAX_RACERS - view.members.length} />
      <VisibilityPicker value={view.visibility} onChange={host ? onVisibility : undefined} />

      <p className="text-xs text-muted">
        {host ? "Press Start the race once everyone is ready; you can also start alone." : "Press I'm ready; the lobby's host starts the race."} Once a race starts it doesn't stop.
      </p>
    </section>
  );
}

/** A player picks the name the others see, before pressing "I'm ready". */
function GuestName({ current, onRename }: { current: string; onRename: (name: string) => Promise<string | null> }) {
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startSaving] = useTransition();
  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        startSaving(async () => {
          const message = await onRename(name);
          setError(message);
          setSaved(!message);
        });
      }}
    >
      <label htmlFor="hy-guest-name" className="text-sm font-semibold block">
        Your name
      </label>
      <div className="flex gap-2">
        <input
          id="hy-guest-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          maxLength={24}
          autoComplete="nickname"
          className="field flex-1 min-w-0 px-3 py-2 text-sm"
        />
        <button type="submit" disabled={pending || !name.trim()} className="btn-secondary px-3 py-2 text-sm disabled:opacity-60">
          Save
        </button>
      </div>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted" role="status">
          {saved ? "Saved. " : ""}This is the name others see in the race. It can't be changed after you press I&apos;m ready.
        </p>
      )}
    </form>
  );
}
