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

// The lobby: the invite link (copy / share sheet), a guest's own name, the people with their "Hazır" state, the
// question count, the bot slots and Herkese açık / Sadece davetle (the host edits them) and the "2/6" count. Hazırım / Başlat sit in the question card below it (their tap opens the keyboard).


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
  /** The first-time "Nasıl oynanır?" card. */
  intro?: React.ReactNode;
  onVisibility: (v: Visibility) => void;
  onBots: (levels: BotLevel[]) => void;
  onQuestions: (count: QuestionCount) => void;
  onKick: (key: string) => void;
  /** A guest's name; resolves to the error message, or null when saved. */
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
  const share = () => void navigator.share({ title: QUICKER.title, text: `${QUICKER.title} lobime gel, yarışalım!`, url }).catch(() => {});

  return (
    <section className="card p-4 md:p-6 w-full max-w-xl mx-auto overflow-y-auto space-y-5 [--hy-avatar:36px]">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-lg font-bold">
          Lobi <span className="font-mono tracking-widest text-primary">{code}</span>
        </h2>
        <span className="text-sm text-muted tabular-nums" aria-label={`${count} / ${MAX_RACERS} yarışçı`}>
          {count}/{MAX_RACERS}
        </span>
      </div>

      {intro}
      <div className="space-y-2">
        <p className="text-sm text-muted">Bu bağlantıyı yarışmak istediğin kişilere gönder.</p>
        <div className="flex flex-wrap gap-2">
          <input readOnly value={url} aria-label="Davet bağlantısı" onFocus={(e) => e.currentTarget.select()} className="field flex-1 min-w-0 px-3 py-2 text-sm" />
          <button type="button" onClick={copy} className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5">
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? "Kopyalandı" : "Bağlantıyı kopyala"}
          </button>
          {canShare && (
            <button type="button" onClick={share} className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5">
              <Share2 size={16} aria-hidden /> Paylaş
            </button>
          )}
        </div>
      </div>

      {meMember?.guest && !meMember.ready && <GuestName key={meMember.key} current={meMember.name} onRename={onRename} />}

      <div>
        <h3 className="text-sm font-semibold mb-2">Oyuncular</h3>
        <ul className="space-y-2">
          {view.members.map((m) => {
            const me = m.key === view.me.key;
            return (
              <li key={m.key} className={`flex items-center gap-3 ${m.here ? "" : "opacity-60"}`}>
                <RacerAvatar view={m.avatar} ring={me} />
                <span className={`truncate ${me ? "font-semibold" : ""}`}>{m.name}</span>
                {me && <span className="badge-info px-2 py-0.5 text-xs">Sen</span>}
                {m.host && <span className="badge-neutral px-2 py-0.5 text-xs">Kurucu</span>}
                {m.sameNetwork && (
                  <span className="badge-warning px-2 py-0.5 text-xs" title="Bu misafir lobideki başka biriyle aynı ağdan bağlanıyor (aynı kişi olabilir).">
                    aynı ağ
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2 shrink-0">
                  {!m.here && <span className="text-xs text-muted">bağlı değil</span>}
                  {m.host ? null : m.ready ? <span className="badge-success px-2 py-0.5 text-xs">Hazır</span> : <span className="badge-warning px-2 py-0.5 text-xs">Bekleniyor</span>}
                  {host && !me && (
                    <button type="button" onClick={() => onKick(m.key)} className="btn-secondary px-2 py-1 text-xs" aria-label={`${m.name} lobiden çıkar`}>
                      Çıkar
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
        {host ? "Herkes hazır olunca Başlat'a bas; tek başına da başlatabilirsin." : "Hazırım'a bas; yarışı lobiyi kuran başlatır."} Yarış başladıktan sonra durmaz.
      </p>
    </section>
  );
}

/** A player picks the name the others see, before pressing Hazırım. */
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
        Adın
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
          Kaydet
        </button>
      </div>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted" role="status">
          {saved ? "Kaydedildi. " : ""}Yarışta bu adla görünürsün. Hazırım&apos;a bastıktan sonra değiştirilemez.
        </p>
      )}
    </form>
  );
}
