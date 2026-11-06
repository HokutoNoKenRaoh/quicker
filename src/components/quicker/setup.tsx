"use client";

import type { AvatarView } from "@/lib/avatar";
import type { BotLevel, QuestionCount } from "@/lib/engine";
import type { Visibility } from "@/lib/server/registry";
import { BotSettings } from "./bot-settings";
import { VisibilityPicker } from "./open-lobbies";
import { QuestionCountPicker } from "./question-count";
import { RacerAvatar } from "./racer-avatar";

// Before Quick start / Create lobby: the question count, the bot slots and (a lobby) who sees it. The button that leads on
// sits in the question card under it.
export function Setup({
  lobby,
  player,
  bots,
  onBots,
  questions,
  onQuestions,
  visibility,
  onVisibility,
  intro,
  error,
}: {
  lobby: boolean;
  player: { name: string; avatar: AvatarView };
  bots: BotLevel[];
  onBots: (levels: BotLevel[]) => void;
  questions: QuestionCount;
  onQuestions: (count: QuestionCount) => void;
  visibility: Visibility;
  onVisibility: (v: Visibility) => void;
  /** The first-time "How to play" card. */
  intro?: React.ReactNode;
  error: string | null;
}) {
  return (
    <section className="card p-4 md:p-6 w-full max-w-xl mx-auto overflow-y-auto space-y-5 [--hy-avatar:36px]">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-lg font-bold">{lobby ? "Create lobby" : "Quick start"}</h2>
        <span className="flex items-center gap-2 min-w-0">
          <RacerAvatar view={player.avatar} ring />
          <span className="text-sm font-semibold truncate">{player.name}</span>
        </span>
      </div>
      {intro}
      {error && (
        <p className="notice-danger p-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <QuestionCountPicker value={questions} onChange={onQuestions} />
      <BotSettings value={bots} onChange={onBots} />
      {lobby && <VisibilityPicker value={visibility} onChange={onVisibility} />}
      <p className="text-xs text-muted">
        {lobby
          ? "Creating the lobby gives you an invite link; up to 6 racers fit in a lobby (people who join take the bots' places)."
          : "Press Start and a 5-second countdown begins."}{" "}
        Once a race starts it doesn't stop.
      </p>
    </section>
  );
}
