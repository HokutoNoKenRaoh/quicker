import { BOT_LEVELS, DEFAULT_QUESTIONS, MAX_RACERS, answeredPoints, finishBonus, isQuestionCount, type BotLevel, type QuestionCount } from "@/lib/engine";

// This browser's own records: the results of this tab (sessionStorage, last 10), the record (score and finishing
// time) per question count, the question count, the bot slots and the screen keypad switch (localStorage). Storage can throw (private mode, blocked site data): every access is
// guarded and the game works without it.

const RESULTS_KEY = "quicker:sonuclar";
const BEST_KEY = "quicker:en-iyi";
const KEYPAD_KEY = "quicker:ekran-tuslari";
const INTRO_KEY = "quicker:nasil-oynanir";
const PASS_HINT_KEY = "quicker:pas-ipucu";
const BOTS_KEY = "quicker:botlar";
const QUESTIONS_KEY = "quicker:sorular";

/** `total`: the race's question count (missing in results saved before it could be chosen: 30). */
export type StoredResult = { rank: number; points: number; correct: number; total?: number; averageMs: number | null; at: number };
/** A record: the best finished race of a question count, its score and finishing time (ms). */
export type BestRun = { score: number; ms: number };
/** Records per question count ("25" → { score: 5 400, ms: 41 200 }). */
export type BestRuns = Record<string, BestRun>;

function read<T>(storage: () => Storage, key: string, fallback: T): T {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // not available: nothing is remembered
  }
}

const session = () => window.sessionStorage;
const local = () => window.localStorage;

export function readResults(): StoredResult[] {
  const list = read<StoredResult[]>(session, RESULTS_KEY, []);
  return Array.isArray(list) ? list.slice(0, 10) : [];
}

export function readBest(): BestRuns {
  const v = read<unknown>(local, BEST_KEY, null);
  // The score always follows from the finishing time by the current rule (its questions' points + the speed bonus),
  // so records kept under an earlier rule compare fairly; earlier versions kept only the time (a single number before
  // the question count could be chosen: 30 questions).
  const entries: [string, unknown][] = typeof v === "number" ? [["30", v]] : v && typeof v === "object" ? Object.entries(v) : [];
  return Object.fromEntries(
    entries.flatMap(([k, x]): [string, BestRun][] => {
      const n = Number(k);
      if (!isQuestionCount(n)) return [];
      const ms = typeof x === "number" ? x : (x as Partial<BestRun> | null)?.ms;
      return typeof ms === "number" && ms > 0 ? [[k, { score: answeredPoints(n) + finishBonus(ms, n), ms }]] : [];
    })
  );
}

/** Records a race; returns true when it is a new record (a faster finish, so a higher score) of its question count here. */
export function saveResult(r: { placing: number; score: number; correct: number; averageMs: number | null; finishMs: number | null }, total: number): boolean {
  write(session, RESULTS_KEY, [{ rank: r.placing, points: r.score, correct: r.correct, total, averageMs: r.averageMs, at: Date.now() }, ...readResults()].slice(0, 10));
  if (r.finishMs === null) return false;
  const best = readBest();
  const key = String(total);
  if (best[key] && best[key].ms <= r.finishMs) return false;
  write(local, BEST_KEY, { ...best, [key]: { score: r.score, ms: r.finishMs } });
  return true;
}

/** The question count of the setup screen (the default until the player changes it). */
export function readQuestions(): QuestionCount {
  const v = read<unknown>(local, QUESTIONS_KEY, null);
  return isQuestionCount(v) ? v : DEFAULT_QUESTIONS;
}

export function writeQuestions(count: QuestionCount) {
  write(local, QUESTIONS_KEY, count);
}

/** "Ekran tuşları" on a touch screen that also has a keyboard / trackpad (off until switched on). */
export function readKeypad(): boolean {
  return read<boolean>(local, KEYPAD_KEY, false) === true;
}

export function writeKeypad(on: boolean) {
  write(local, KEYPAD_KEY, on);
}

/** The first-time "Nasıl oynanır?" card was dismissed (or a race was played) on this device. */
export function readIntroSeen(): boolean {
  return read<boolean>(local, INTRO_KEY, false) === true;
}

export function writeIntroSeen() {
  write(local, INTRO_KEY, true);
}

/** The pass hint on the card was shown for a race's first 3 questions (then the "?" help has it). */
export function readPassHintDone(): boolean {
  return read<boolean>(local, PASS_HINT_KEY, false) === true;
}

export function writePassHintDone() {
  write(local, PASS_HINT_KEY, true);
}

/** The bot slots of the setup screen (levels, 0–5 of them); the default until the player changes it. */
export function readBots(fallback: BotLevel[]): BotLevel[] {
  const v = read<unknown>(local, BOTS_KEY, null);
  return Array.isArray(v) && v.length <= MAX_RACERS - 1 && v.every((x) => typeof x === "string" && x in BOT_LEVELS) ? (v as BotLevel[]) : fallback;
}

export function writeBots(levels: BotLevel[]) {
  write(local, BOTS_KEY, levels);
}

export const seconds = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} sn`);
