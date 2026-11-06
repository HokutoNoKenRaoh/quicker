import { LEVEL_POINTS, QUESTION_COUNTS, SPEED_POINTS, answerPoints, finishBonus } from "@/lib/engine";

// "Puanlar": what a correct answer and finishing earn (from the engine's constants). The placings follow the score.
export function ScoringTable() {
  const last = LEVEL_POINTS[LEVEL_POINTS.length - 1]!.upTo;
  const rows = [
    ...LEVEL_POINTS.map((l, i) => ({ label: `${i === 0 ? 1 : LEVEL_POINTS[i - 1]!.upTo + 1}–${l.upTo}. soru`, value: `${l.points} puan` })),
    { label: `${last + 1}–${QUESTION_COUNTS[QUESTION_COUNTS.length - 1]}. soru`, value: `${answerPoints(last + 1)} puan` },
    { label: "Bütün soruları bitirmek", value: "hız bonusu" },
  ];
  return (
    <div className="space-y-2 max-w-md">
      <table className="text-sm w-full">
        <caption className="text-left font-semibold mb-2">Puanlar</caption>
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
        Doğru cevabın puanı hıza göre değişmez; hız, bitirince alınan hız bonusuyla ödüllenir: soru başına {SPEED_POINTS} ÷ ortalama cevap süren (saniye).
        Örnek: 10 soruyu ortalama 1 saniyede bitirirsen +{finishBonus(10_000, 10).toLocaleString("tr-TR")}, 2 saniyede +
        {finishBonus(20_000, 10).toLocaleString("tr-TR")}. Sıralama puana göredir: daha hızlı bitiren her zaman daha çok puan alır, eşit puanda önce ulaşan
        öndedir. Art arda hızlı cevaplar efekt ve ses açar, puanı değiştirmez.
      </p>
    </div>
  );
}
