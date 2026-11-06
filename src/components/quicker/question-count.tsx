"use client";

import { QUESTION_COUNTS, type QuestionCount } from "@/lib/engine";

// "Soru sayısı" (10–30): the setup screen, the lobby (host only; others see it) and the leaderboards' filter.
export function QuestionCountPicker({ value, onChange, label = "Soru sayısı", id = "hy-questions" }: { value: number; onChange?: (count: QuestionCount) => void; label?: string; id?: string }) {
  if (!onChange) {
    return (
      <p className="text-sm">
        <span className="font-semibold">{label}:</span> {value}
      </p>
    );
  }
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2" id={id}>
        {label}
      </h3>
      <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={id}>
        {QUESTION_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className={`${value === n ? "btn-primary" : "btn-secondary"} w-12 h-10 text-sm font-semibold tabular-nums`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
