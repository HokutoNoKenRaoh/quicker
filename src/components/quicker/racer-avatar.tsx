import type { AvatarView } from "@/lib/avatar";

/** A racer's letter avatar; `ring` marks the player's own lane. */
export function RacerAvatar({ view, ring = false, className = "" }: { view: AvatarView; ring?: boolean; className?: string }) {
  const base = `rounded-full shrink-0 w-[var(--hy-avatar)] h-[var(--hy-avatar)] ${ring ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : ""} ${className}`;
  return (
    <span aria-hidden className={`${base} font-semibold flex items-center justify-center text-[calc(var(--hy-avatar)*0.45)] bg-card text-foreground border border-border`}>
      {view.char}
    </span>
  );
}
