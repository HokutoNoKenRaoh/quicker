// quicker rules: questions, answer check, scoring, bots and the race itself. Pure TypeScript: no React, no
// DOM, no clock, no server imports, so the same rules run in the browser and on the server (the race registry). Time is the race clock in milliseconds passed in by the caller (0 = the start), and
// randomness comes from a seed carried in the state, so races replay exactly. Functions return a new state and never
// change their input.
//
// The score decides the placings (a slower racer must never end with more points). A racer moves
// one step per correct answer, which earns its level's points (the same for everyone), and answering all of the
// race's questions (QUESTION_COUNTS, chosen per race) earns a speed bonus, SPEED_POINTS per question divided by the
// average answer time in seconds (a few seconds faster shows clearly). So a racer behind in the race (fewer questions, or the same ones later) never has more points than one ahead of them.
// The combo is only the streak of fast answers behind the game's effects and sounds.

// ---- Tuning (the "easier / harder" knobs) -------------------------------------------------------------

/** Questions in a race (the player / lobby host picks one); every racer of a room gets the same sequence. */
export const QUESTION_COUNTS = [10, 15, 20, 25, 30] as const;
export type QuestionCount = (typeof QUESTION_COUNTS)[number];
export const DEFAULT_QUESTIONS: QuestionCount = 25;
export const isQuestionCount = (n: unknown): n is QuestionCount => QUESTION_COUNTS.includes(n as QuestionCount);

/** Points of a correct answer by question number, whatever its speed: 1–10 → 100, 11–20 → 150, 21–30 → 200. */
export const LEVEL_POINTS = [
  { upTo: 10, points: 100 },
  { upTo: 20, points: 150 },
] as const;
const MAX_LEVEL_POINTS = 200;
/** Finishing every question: this many points per question at 1 s per answer (twice that at 0,5 s, half at 2 s). */
export const SPEED_POINTS = 200;
/**
 * The combo (in tenths: ×1,0 → ×2,5) is the streak behind the effects and sounds, never the points: +0.1 after every
 * answer faster than FAST_ANSWER_MS, back to ×1,0 after one of COMBO_RESET_MS or slower, a mistake or a pass.
 */
export const COMBO_START = 10;
const COMBO_STEP = 1;
const COMBO_MAX = 25;
const FAST_ANSWER_MS = 1500;
const COMBO_RESET_MS = 3000;

/**
 * A wrong answer (typed digits that can no longer become the answer: "13" for 12, "8" for 7) clears the box, keeps
 * the question, resets the combo and locks input this long (guessing by mashing digits doesn't pay; answers are only
 * 0–36). The score never goes down.
 */
export const WRONG_LOCK_MS = 350;
/**
 * "Pas" replaces the racer's current question with a new one of the same level (for that racer only: the race still
 * needs every question answered), resets the combo and locks input this long. The next answer's time still runs from
 * the previous accepted answer, so a pass never earns a fast-answer score: it is a way out of a question, not a way
 * to pick easy ones.
 */
export const SKIP_LOCK_MS = 1500;

/** After the first racer crosses the line, the others get this long. */
export const LAST_CALL_MS = 20_000;
/** A race never lasts longer than this (from the start). */
export const MAX_RACE_MS = 4 * 60_000;

/** Operand count by question number (1-based): up to 10 → 2, up to 20 → 3, then 4. */
const OPERAND_STEPS = [
  { upTo: 10, operands: 2 },
  { upTo: 20, operands: 3 },
] as const;
const MAX_OPERANDS = 4;

/**
 * Questions are made answer first: the answer is drawn from a target distribution per operand count, then a question
 * with that answer (so small answers are no longer favoured: drawing the operands directly made "1" the most common
 * answer, 13 % of the 2-number questions). Relative weights by answer; an answer no question can have is skipped.
 * 2 numbers: 4–17 flat, 2–3 lighter, 0–1 rare (2 % together); 3 numbers: 4–20 flat, tapering above 20; 4 numbers:
 * 4–25 flat, tapering above 25.
 */
const ANSWER_WEIGHTS: Record<number, (answer: number) => number> = {
  2: (a) => (a === 0 ? 0.5 : a === 1 ? 1.5 : a <= 3 ? 3 : a <= 17 ? 6.5 : 0),
  3: (a) => (a <= 2 ? 0.4 : a === 3 ? 2.5 : a <= 20 ? 5 : a <= 24 ? 5 * (1 - (a - 20) * 0.18) : 0),
  4: (a) => (a <= 3 ? 0.25 : a <= 25 ? 4 : a <= 30 ? 4 * (1 - (a - 25) * 0.15) : 0),
};
/** Answers 0–3 at most this many times in each block of 10 questions (blocks keep shorter races a prefix of longer). */
const LOW_ANSWER = 3;
const LOW_PER_BLOCK = 1;
/** Probability of a question with a "−" when its answer has one, per operand count (keeps the mix of "+" and "−"). */
const MINUS_SHARE: Record<number, number> = { 2: 0.75, 3: 0.9, 4: 0.88 };
/** The same answer never twice in a row, and at most twice in any 5 questions in a row. */
const ANSWER_WINDOW = 5;
const ANSWER_MAX_IN_WINDOW = 2;

/** Bot difficulty: normal response time per question (ms) before the per-operand delay. Lower mean = harder. */
export const BOT_LEVELS = {
  KOLAY: { label: "Kolay", meanMs: 4500, sdMs: 1200 },
  ORTA: { label: "Orta", meanMs: 3000, sdMs: 800 },
  ZOR: { label: "Zor", meanMs: 2000, sdMs: 500 },
  USTA: { label: "Usta", meanMs: 1300, sdMs: 300 },
} as const;
export type BotLevel = keyof typeof BOT_LEVELS;
export const BOT_LEVEL_KEYS = Object.keys(BOT_LEVELS) as BotLevel[];
/** Longer questions take bots longer (ms by operand count). */
const BOT_EXTRA_MS: Record<number, number> = { 2: 0, 3: 250, 4: 500 };
const BOT_MIN_MS = 600;
/** A bot "fixes a typo" now and then. */
const BOT_TYPO_SHARE = 0.08;
/** A bot's mistake costs this much on top of the lock (it reads, types wrong, waits, types again). */
const BOT_TYPO_MS = [400, 1000] as const;

const BOT_NAMES = [
  "HızlıKedi", "SayıAvcısı", "Matematikçi34", "ToplaÇıkar", "Kafadan", "RakamUstası", "Hesapçı06", "ŞimşekParmak",
  "ZihinKoşucu", "Artıİşareti", "SıfırHata", "KlavyeKurdu", "Sayısalcı", "HızTreni", "BeyinFırtınası", "EksiArtı",
  "Hesap35", "ÇarpıkHesap", "YıldırımKafa", "TekCevap",
] as const;
const BOT_AVATARS = ["robot", "uzayli", "hayalet", "roket", "simsek", "alev", "zar", "mantar", "gezegen", "kupa", "yildiz", "mucevher"] as const;

/** People + bots in one race. */
export const MAX_RACERS = 6;

// ---- Seeded random (mulberry32) -----------------------------------------------------------------------------

/** A tiny generator over a 32-bit state; `seed()` gives the state to store back. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min: number, max: number) {
      return min + Math.floor(this.next() * (max - min + 1));
    },
    seed: () => s,
  };
}
type Rng = ReturnType<typeof makeRng>;

function shuffle<T>(rng: Rng, list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---- Questions ------------------------------------------------------------------------------------------------

type Op = "+" | "-";
export interface Question {
  operands: number[];
  ops: Op[];
  answer: number;
  /** "6 − 3 + 2" (real minus sign). */
  text: string;
}

export function operandCount(questionNumber: number) {
  return OPERAND_STEPS.find((s) => questionNumber <= s.upTo)?.operands ?? MAX_OPERANDS;
}

/** Left to right from the parts (never by parsing a string). */
export function evaluate(operands: number[], ops: Op[]) {
  let total = operands[0]!;
  for (let i = 0; i < ops.length; i++) total = ops[i] === "+" ? total + operands[i + 1]! : total - operands[i + 1]!;
  return total;
}

const questionText = (operands: number[], ops: Op[]) =>
  operands.map((n, i) => (i === 0 ? String(n) : `${ops[i - 1] === "+" ? "+" : "−"} ${n}`)).join(" ");

/**
 * Every valid question of an operand count (operands 1–9, every running total ≥ 0), by answer and by whether it has
 * a "−": built once per count when first needed (2 numbers: 162 before the filter, 3: 2 916, 4: 52 488). A question
 * is packed in one number: 4 bits per operand, then one bit per operator (1 = "−").
 */
type Pool = { plus: number[]; minus: number[] }[];
const pools = new Map<number, Pool>();
function questionPool(count: number): Pool {
  let pool = pools.get(count);
  if (pool) return pool;
  pool = Array.from({ length: 9 * count + 1 }, () => ({ plus: [], minus: [] }));
  const combos = 9 ** count;
  for (let c = 0; c < combos; c++) {
    const operands: number[] = [];
    for (let i = 0, x = c; i < count; i++, x = Math.floor(x / 9)) operands.push((x % 9) + 1);
    for (let mask = 0; mask < 1 << (count - 1); mask++) {
      let total = operands[0]!;
      let ok = true;
      for (let i = 1; i < count && ok; i++) {
        total = mask & (1 << (i - 1)) ? total - operands[i]! : total + operands[i]!;
        ok = total >= 0;
      }
      if (!ok) continue;
      const packed = operands.reduce((p, n, i) => p | (n << (4 * i)), 0) | (mask << (4 * count));
      pool[total]![mask ? "minus" : "plus"].push(packed);
    }
  }
  pools.set(count, pool);
  return pool;
}

function unpack(packed: number, count: number): Question {
  const operands = Array.from({ length: count }, (_, i) => (packed >> (4 * i)) & 15);
  const mask = packed >> (4 * count);
  const ops: Op[] = Array.from({ length: count - 1 }, (_, i) => (mask & (1 << i) ? "-" : "+"));
  return { operands, ops, answer: evaluate(operands, ops), text: questionText(operands, ops) };
}

/** Draws an index by weight (null when every weight is 0). */
function pickWeighted(rng: Rng, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  let r = rng.next() * sum;
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]!) < 0) return i;
  return weights.length - 1;
}

/**
 * One question for the given question number: its answer from ANSWER_WEIGHTS (answers in `avoid` left out while
 * another one is possible), then "+" only or with "−" (MINUS_SHARE), then one of those questions at random.
 */
function buildQuestion(rng: Rng, questionNumber: number, avoid: (answer: number) => boolean = () => false): Question {
  const count = operandCount(questionNumber);
  const pool = questionPool(count);
  const base = pool.map((p, a) => (p.plus.length + p.minus.length ? ANSWER_WEIGHTS[count]!(a) : 0));
  const answer = pickWeighted(rng, base.map((w, a) => (avoid(a) ? 0 : w))) ?? pickWeighted(rng, base) ?? 0;
  const { plus, minus } = pool[answer]!;
  const list = minus.length && (!plus.length || rng.next() < MINUS_SHARE[count]!) ? minus : plus;
  return unpack(list[rng.int(0, list.length - 1)]!, count);
}

/** The room's whole question sequence (question i is the same for every racer of a room). */
export function raceQuestions(seed: number, count: number = DEFAULT_QUESTIONS): Question[] {
  const rng = makeRng(seed ^ 0x51ed270b);
  const out: Question[] = [];
  for (let i = 1; i <= count; i++) {
    const recent = out.slice(-(ANSWER_WINDOW - 1)).map((q) => q.answer);
    const blockLow = out.slice(Math.floor((i - 1) / 10) * 10).filter((q) => q.answer <= LOW_ANSWER).length;
    const avoid = (a: number) =>
      a === recent[recent.length - 1] || recent.filter((x) => x === a).length >= ANSWER_MAX_IN_WINDOW || (a <= LOW_ANSWER && blockLow >= LOW_PER_BLOCK);
    out.push(buildQuestion(rng, i, avoid));
  }
  return out;
}

// ---- Answer check and scoring ---------------------------------------------------------------------------------

/** Correct only when the typed digits are exactly the answer ("07" never matches 7; "0" matches 0). */
const isCorrect = (input: string, q: Question) => input === String(q.answer);

/** Wrong as soon as the digits typed so far can't become the answer (the browser and the server use the same rule). */
export const isWrongInput = (input: string, answer: number | string) => input.length > 0 && !String(answer).startsWith(input);

/** Points of a correct answer to question `questionNumber` (1-based). */
export const answerPoints = (questionNumber: number) => LEVEL_POINTS.find((l) => questionNumber <= l.upTo)?.points ?? MAX_LEVEL_POINTS;

/** Points of the first `answered` questions together (a score without the speed bonus). */
export function answeredPoints(answered: number) {
  let total = 0;
  for (let k = 1; k <= answered; k++) total += answerPoints(k);
  return total;
}

/**
 * The speed bonus of a racer who answered all `count` questions in `ms` (their answer times added up):
 * SPEED_POINTS × count ÷ the average answer time in seconds.
 */
export const finishBonus = (ms: number, count: number) => Math.round((SPEED_POINTS * count * count * 1000) / Math.max(ms, 1));

/** Points of one correct answer and the combo after it (combo in tenths: 17 = ×1,7); `graceMs` widens the combo's limits. */
export function scoreAnswer(responseMs: number, questionNumber: number, comboTenths: number, graceMs = 0) {
  const fast = responseMs < FAST_ANSWER_MS + graceMs;
  const reset = responseMs >= COMBO_RESET_MS + graceMs;
  const combo = fast ? Math.min(COMBO_MAX, comboTenths + COMBO_STEP) : reset ? COMBO_START : comboTenths;
  return { points: answerPoints(questionNumber), combo };
}

// ---- Bots -----------------------------------------------------------------------------------------------------

function normal(rng: Rng) {
  // Box–Muller
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Simulated response time of a bot for its question number, and whether it makes a mistake on the way. */
function botResponse(rng: Rng, level: BotLevel, questionNumber: number) {
  const p = BOT_LEVELS[level];
  let ms = p.meanMs + normal(rng) * p.sdMs + (BOT_EXTRA_MS[operandCount(questionNumber)] ?? 0);
  const typo = rng.next() < BOT_TYPO_SHARE;
  if (typo) ms += WRONG_LOCK_MS + BOT_TYPO_MS[0] + rng.next() * (BOT_TYPO_MS[1] - BOT_TYPO_MS[0]);
  return { ms: Math.max(BOT_MIN_MS, Math.round(ms)), typo };
}

type BotSeat = { id: string; name: string; avatar: string; level: BotLevel };

/** Bots for the given levels with distinct names and avatars. */
export function pickBots(seed: number, levels: BotLevel[]): BotSeat[] {
  const rng = makeRng(seed ^ 0x2b7e1516);
  const names = shuffle(rng, BOT_NAMES);
  const avatars = shuffle(rng, BOT_AVATARS);
  return levels.slice(0, MAX_RACERS).map((level, i) => ({ id: `bot-${i}`, name: names[i]!, avatar: avatars[i]!, level }));
}

// ---- Race -----------------------------------------------------------------------------------------------------

export interface Racer {
  id: string;
  name: string;
  /** People: the avatar decided by the page / server; bots: a preset id from public/avatars. */
  avatar: string | null;
  human: boolean;
  level: BotLevel | null;
  score: number;
  /** Correct answers so far = the index of the next question. */
  answered: number;
  combo: number;
  maxCombo: number;
  /** Race time of the last accepted answer (0 at the start): the next answer's time is measured from it. */
  lastAt: number;
  /** Race time of crossing the line (all questions answered). */
  finishedAt: number | null;
  /** A person who left the race (stays on the track, greyed out). */
  left: boolean;
  /** Response time of every accepted answer (ms). */
  timings: number[];
  /** The speed bonus earned by answering every question (0 until then). */
  bonus: number;
  /** Wrong answers so far, and the race time until which input is locked after the last one (or a pass). */
  wrong: number;
  lockedUntil: number;
  /** Passes so far, and the question that replaces question `index` after a pass. */
  skips: number;
  swap: { index: number; question: Question } | null;
  /** Bots: race time of their next correct answer, its response time and whether a mistake comes first. */
  nextAt: number | null;
  nextMs: number | null;
  nextTypo: boolean;
}

export interface ScoreEvent {
  seq: number;
  racerId: string;
  points: number;
  at: number;
  /** The finishing speed bonus rather than an answer's points. */
  bonus: boolean;
}

export interface RaceState {
  seed: number;
  questions: Question[];
  racers: Racer[];
  /** Race time the first racer crossed the line ("Son 20 saniye" starts). */
  firstFinishAt: number | null;
  ended: boolean;
  endedAt: number | null;
  /** Recent correct answers of everyone, for the floating "+100" (only the last few are kept). */
  events: ScoreEvent[];
  seq: number;
}

const KEEP_EVENTS = 24;

export function createRace(seed: number, humans: { id: string; name: string; avatar: string | null }[], bots: BotSeat[], count: number = DEFAULT_QUESTIONS): RaceState {
  const rng = makeRng(seed);
  const base = { score: 0, answered: 0, combo: COMBO_START, maxCombo: COMBO_START, lastAt: 0, finishedAt: null, left: false, timings: [] as number[], bonus: 0, wrong: 0, lockedUntil: 0, skips: 0, swap: null };
  const racers: Racer[] = [
    ...humans.map((h) => ({ ...base, id: h.id, name: h.name, avatar: h.avatar, human: true, level: null, nextAt: null, nextMs: null, nextTypo: false })),
    ...bots.map((b) => {
      const { ms, typo } = botResponse(rng, b.level, 1);
      return { ...base, id: b.id, name: b.name, avatar: b.avatar, human: false, level: b.level, nextAt: ms, nextMs: ms, nextTypo: typo };
    }),
  ];
  return { seed: rng.seed(), questions: raceQuestions(seed, count), racers, firstFinishAt: null, ended: false, endedAt: null, events: [], seq: 0 };
}

/** When the race ends at the latest (the 20 s after the first finisher, or the 4 minutes). */
export function raceDeadline(state: RaceState) {
  return state.firstFinishAt === null ? MAX_RACE_MS : Math.min(MAX_RACE_MS, state.firstFinishAt + LAST_CALL_MS);
}

function award(state: RaceState, index: number, responseMs: number, at: number, graceMs: number): { state: RaceState; points: number } {
  const r = state.racers[index]!;
  const { points, combo } = scoreAnswer(responseMs, r.answered + 1, r.combo, graceMs);
  const answered = r.answered + 1;
  const finishedAt = answered >= state.questions.length ? at : null;
  const timings = [...r.timings, Math.round(responseMs)];
  const bonus = finishedAt === null ? 0 : finishBonus(timings.reduce((a, b) => a + b, 0), state.questions.length);
  const racer: Racer = { ...r, score: r.score + points + bonus, bonus, answered, combo, maxCombo: Math.max(r.maxCombo, combo), lastAt: at, finishedAt, timings, swap: null };
  const racers = state.racers.map((x, i) => (i === index ? racer : x));
  let seq = state.seq;
  const events: ScoreEvent[] = [...state.events, { seq: ++seq, racerId: r.id, points, at, bonus: false }];
  if (bonus > 0) events.push({ seq: ++seq, racerId: r.id, points: bonus, at, bonus: true });
  const firstFinishAt = state.firstFinishAt ?? finishedAt;
  return { state: { ...state, racers, seq, events: events.slice(-KEEP_EVENTS), firstFinishAt }, points: points + bonus };
}

/** Ends the race once every person has finished or left, or the deadline passed. */
function settle(state: RaceState, now: number): RaceState {
  if (state.ended) return state;
  const humans = state.racers.filter((r) => r.human);
  const allDone = humans.length > 0 && humans.every((r) => r.finishedAt !== null || r.left);
  const deadline = raceDeadline(state);
  if (allDone) {
    const last = Math.max(...humans.map((r) => r.finishedAt ?? r.lastAt));
    return { ...state, ended: true, endedAt: Math.min(Math.max(last, 0), deadline) };
  }
  if (now >= deadline) return { ...state, ended: true, endedAt: deadline };
  return state;
}

/** Bot answers due up to `now`, in time order across bots (none after the deadline), then the end check. */
export function advance(state: RaceState, now: number): RaceState {
  if (state.ended) return state;
  let s = state;
  const rng = makeRng(s.seed);
  for (;;) {
    const deadline = raceDeadline(s);
    let idx = -1;
    for (let i = 0; i < s.racers.length; i++) {
      const r = s.racers[i]!;
      if (r.nextAt !== null && r.nextAt <= now && r.nextAt <= deadline && (idx < 0 || r.nextAt < s.racers[idx]!.nextAt!)) idx = i;
    }
    if (idx < 0) break;
    const bot = s.racers[idx]!;
    const at = bot.nextAt!;
    // A bot's mistake works like a person's: its combo is gone before this answer counts.
    if (bot.nextTypo) s = { ...s, racers: s.racers.map((r, i) => (i === idx ? { ...r, combo: COMBO_START, wrong: r.wrong + 1 } : r)) };
    s = award(s, idx, bot.nextMs!, at, 0).state;
    const after = s.racers[idx]!;
    const next = after.finishedAt === null ? botResponse(rng, bot.level!, after.answered + 1) : null;
    s = { ...s, racers: s.racers.map((r, i) => (i === idx ? { ...r, nextAt: next ? at + next.ms : null, nextMs: next?.ms ?? null, nextTypo: next?.typo ?? false } : r)) };
    // People finished while this bot ran: settle at the time it happened.
    const settled = settle(s, at);
    if (settled.ended) return { ...settled, seed: rng.seed() };
  }
  return settle({ ...s, seed: rng.seed() }, now);
}

/**
 * A person's answer to question `index` at race time `now`. Accepted only when it is that racer's next question and
 * the answer is right; the response time is measured from the racer's previous accepted answer (or the start). A
 * wrong answer (isWrongInput) resets the combo, counts a mistake and locks input for `lockMs`; anything else (out of
 * order, twice, during the lock, after the end, digits still on the way) changes nothing.
 */
export function submitAnswer(state: RaceState, racerId: string, index: number, value: string, now: number, opts: { graceMs?: number; lockMs?: number } = {}) {
  let s = advance(state, now);
  const i = s.racers.findIndex((r) => r.id === racerId && r.human);
  const r = s.racers[i];
  const none = { accepted: false, wrong: false, points: 0, responseMs: 0 };
  if (!r || s.ended || r.left || r.finishedAt !== null || index !== r.answered || now < r.lockedUntil) return { state: s, ...none };
  const q = currentQuestion(s, r)!;
  if (isWrongInput(value, q.answer)) {
    const racer: Racer = { ...r, combo: COMBO_START, wrong: r.wrong + 1, lockedUntil: now + (opts.lockMs ?? WRONG_LOCK_MS) };
    return { state: { ...s, racers: s.racers.map((x, k) => (k === i ? racer : x)) }, ...none, wrong: true };
  }
  if (!isCorrect(value, q)) return { state: s, ...none };
  const responseMs = now - r.lastAt;
  const awarded = award(s, i, responseMs, now, opts.graceMs ?? 0);
  s = settle(awarded.state, now);
  return { state: s, accepted: true, wrong: false, points: awarded.points, responseMs };
}

/** The question a racer has to answer now: the race's next one, or its replacement after a pass. */
export function currentQuestion(state: RaceState, r: Racer): Question | undefined {
  return r.swap && r.swap.index === r.answered ? r.swap.question : state.questions[r.answered];
}

/** FNV-1a of the racer id: two people passing the same question get different replacements. */
const idHash = (id: string) => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);

/**
 * A person's "Pas" on question `index` at race time `now`: a new question of the same level (not the passed one and
 * not its neighbours) replaces it for this racer, the combo resets and input waits `lockMs`. Progress doesn't move.
 * Out of order, during a lock or after the end it changes nothing.
 */
export function skipQuestion(state: RaceState, racerId: string, index: number, now: number, opts: { lockMs?: number } = {}) {
  const s = advance(state, now);
  const i = s.racers.findIndex((r) => r.id === racerId && r.human);
  const r = s.racers[i];
  if (!r || s.ended || r.left || r.finishedAt !== null || index !== r.answered || now < r.lockedUntil) return { state: s, skipped: false, question: null };
  const rng = makeRng(s.seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(r.skips + 1, 0x85ebca6b) ^ idHash(r.id));
  const near = [currentQuestion(s, r), s.questions[index - 1], s.questions[index + 1]].map((q) => q?.answer);
  const question = buildQuestion(rng, index + 1, (a) => near.includes(a) || a <= LOW_ANSWER);
  const racer: Racer = { ...r, swap: { index, question }, skips: r.skips + 1, combo: COMBO_START, lockedUntil: now + (opts.lockMs ?? SKIP_LOCK_MS) };
  return { state: { ...s, racers: s.racers.map((x, k) => (k === i ? racer : x)) }, skipped: true, question };
}

/** A person leaves: greyed out on the track, out of the "everyone finished" check. */
export function leaveRace(state: RaceState, racerId: string, now: number): RaceState {
  const racers = state.racers.map((r) => (r.id === racerId && r.human ? { ...r, left: true } : r));
  return settle({ ...state, racers }, now);
}

/** Final order: the score; equal scores by who got there first (finishers by crossing time, then the last answer). */
export function ranking(state: RaceState): Racer[] {
  return [...state.racers].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
    if (a.finishedAt !== null) return -1;
    if (b.finishedAt !== null) return 1;
    return b.answered - a.answered || a.lastAt - b.lastAt;
  });
}


interface RaceResult {
  placing: number;
  racerCount: number;
  score: number;
  correct: number;
  wrong: number;
  skips: number;
  /** The finishing speed bonus (part of the score). */
  bonus: number;
  finished: boolean;
  averageMs: number | null;
  fastestMs: number | null;
  maxCombo: number;
  /** Start to crossing the line, when the racer finished. */
  finishMs: number | null;
  winnerName: string;
}

export function racerResult(state: RaceState, racerId: string): RaceResult {
  const order = ranking(state);
  const r = state.racers.find((x) => x.id === racerId)!;
  const t = r.timings;
  return {
    placing: order.findIndex((x) => x.id === racerId) + 1,
    racerCount: state.racers.length,
    score: r.score,
    correct: r.answered,
    wrong: r.wrong,
    skips: r.skips,
    bonus: r.bonus,
    finished: r.finishedAt !== null,
    averageMs: t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : null,
    fastestMs: t.length ? Math.min(...t) : null,
    maxCombo: r.maxCombo,
    finishMs: r.finishedAt === null ? null : Math.round(r.finishedAt),
    winnerName: order[0]!.name,
  };
}
