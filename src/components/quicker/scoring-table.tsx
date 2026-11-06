import { LEVEL_POINTS, QUESTION_COUNTS, SPEED_POINTS, answerPoints, finishBonus } from "@/lib/engine";

// "Points": what a correct answer and finishing earn (from the engine's constants). The placings follow the score.
export function ScoringTable() {
  const last = LEVEL_POINTS[LEVEL_POINTS.length - 1]!.upTo;
  const rows = [
    ...LEVEL_POINTS.map((l, i) => ({ label: `Questions ${i === 0 ? 1 : LEVEL_POINTS[i - 1]!.upTo + 1}–${l.upTo}`, value: `${l.points} points` })),
    { label: `Questions ${last + 1}–${QUESTION_COUNTS[QUESTION_COUNTS.length - 1]}`, value: `${answerPoints(last + 1)} points` },
    { label: "Finishing every question", value: "speed bonus" },
  ];
  return (
    <div className="space-y-2 max-w-md">
      <table className="text-sm w-full">
        <caption className="text-left font-semibold mb-2">Points</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border">
              <td className="py-1.5 text-muted">{r.label}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-muted">
        A correct answer scores the same however fast it is; speed earns the bonus for finishing: {SPEED_POINTS} per question ÷ your average answer
        time (seconds). Example: finish 10 questions at 1 second each on average for +{finishBonus(10_000, 10).toLocaleString("en-US")}, at 2 seconds
        for +{finishBonus(20_000, 10).toLocaleString("en-US")}. Placings follow the score: whoever finishes faster always scores more, and on equal
        points the one who got there first is ahead. Fast answers in a row unlock effects and sounds, never points.
      </p>
    </div>
  );
}
