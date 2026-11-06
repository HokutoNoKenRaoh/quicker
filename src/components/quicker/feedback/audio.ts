// quicker sounds, all synthesised with the Web Audio API (no files, no licences). One AudioContext (created on
// the first tap: browsers allow audio only after a user gesture) → master gain (the volume setting) → a gentle
// compressor → the speakers. Soft timbres only (sine / triangle, short attack, quick decay, roughly 300–1 500 Hz),
// a tiny random pitch / level variation per play so repeats don't sound mechanical, at most MAX_VOICES at once, and
// nothing while the tab is hidden. Browsers stop the context after an interruption (iPhone: a call, a notification,
// another app; state "interrupted" or "suspended"): every tap of the game (unlockAudio) and the page becoming visible
// again resume it, and the voice limit counts by end time, so a voice that never reports its end can't block the rest.
//
// The correct-answer note climbs a major pentatonic scale with the streak (C5 D5 E5 G5 A5 C6 …: any order of these
// notes sounds pleasant, like Peggle's peg hits), stops rising after two octaves and grows richer instead (an octave
// layer from combo tier 1, a soft shimmer from tier 2).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.8;
/** End times (context time) of the voices playing now. */
const playing: number[] = [];
const MAX_VOICES = 6;
/** Master level so a full-level voice peaks around −12 dBFS. */
const MASTER_LEVEL = 0.25;

/** Call from a tap (each one: it also wakes a context the browser stopped); audio may start only after a gesture. */
export function unlockAudio() {
  try {
    if (ctx?.state === "closed") ctx = master = null;
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.005;
      comp.release.value = 0.15;
      master = ctx.createGain();
      master.gain.value = MASTER_LEVEL * volume;
      master.connect(comp).connect(ctx.destination);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && ctx && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => {});
      });
    }
    // "suspended" (autoplay, a hidden tab on some phones) and "interrupted" (iPhone) both wait for resume().
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  } catch {
    ctx = master = null; // no Web Audio: the game stays silent
  }
}

/** Room for one more voice ending at `end` (finished ones are dropped by time, not by their "ended" event). */
function claimVoice(end: number) {
  const now = ctx!.currentTime;
  for (let i = playing.length - 1; i >= 0; i--) if (playing[i]! <= now) playing.splice(i, 1);
  if (playing.length >= MAX_VOICES) return false;
  playing.push(end);
  return true;
}

/** 0–1 (the slider in the game's settings). */
export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  if (master && ctx) master.gain.setTargetAtTime(MASTER_LEVEL * volume, ctx.currentTime, 0.02);
}

const ready = () => !!ctx && !!master && ctx.state === "running" && !document.hidden;
const cents = (c: number) => Math.pow(2, c / 1200);
/** ±8 cents, ±1.5 dB. */
const jitter = () => ({ pitch: cents((Math.random() * 2 - 1) * 8), level: Math.pow(10, ((Math.random() * 2 - 1) * 1.5) / 20) });

type Voice = { freq: number; at?: number; dur: number; level: number; type?: OscillatorType; to?: number; attack?: number };

function voice({ freq, at = 0, dur, level, type = "sine", to, attack = 0.008 }: Voice) {
  if (!ready()) return;
  const c = ctx!;
  const start = c.currentTime + at;
  if (!claimVoice(start + dur + 0.03)) return;
  const j = jitter();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq * j.pitch, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to * j.pitch, start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level * j.level, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(master!);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

/** Filtered noise sweeping up (passing someone) or down (being passed). */
function sweep(up: boolean, dur: number, level: number) {
  if (!ready()) return;
  const c = ctx!;
  const start = c.currentTime;
  if (!claimVoice(start + dur + 0.02)) return;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(up ? 400 : 1400, start);
  filter.frequency.exponentialRampToValueAtTime(up ? 1500 : 450, start + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + dur * 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(gain).connect(master!);
  src.onended = () => src.disconnect();
  src.start(start);
  src.stop(start + dur + 0.02);
}

// Major pentatonic from C5, two octaves (10 steps).
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];

/** The note of the `streak`-th correct answer in a row (1 = the first); `tier` = combo tier 0–3. */
export function playCorrect(streak: number, tier: number, fast: boolean) {
  const step = Math.max(0, streak - 1);
  // Past two octaves: alternate between the top two notes, richer instead of higher.
  const freq = step < SCALE.length ? SCALE[step]! : SCALE[SCALE.length - 2 + (step % 2)]!;
  voice({ freq, dur: fast ? 0.17 : 0.2, level: 0.55, type: fast ? "triangle" : "sine" });
  if (tier >= 1) voice({ freq: freq / 2, dur: 0.22, level: 0.18 });
  if (tier >= 2) {
    voice({ freq: freq * 2 * cents(5), dur: 0.16, level: 0.06 });
    voice({ freq: freq * 2 * cents(-5), dur: 0.16, level: 0.06 });
  }
}

/** A practice answer (the countdown): the first note, nothing climbs. */
export const playPractice = () => voice({ freq: SCALE[0]!, dur: 0.16, level: 0.4 });

/** A mistake: a short muffled thunk; a lost combo (tier ≥ 1) also deflates, longer for a higher tier. */
export function playWrong(lostTier: number) {
  voice({ freq: 180, to: 140, dur: 0.12, level: 0.5, type: "triangle", attack: 0.005 });
  if (lostTier >= 1) voice({ freq: 520, to: 230, at: 0.06, dur: 0.18 + 0.06 * lostTier, level: 0.16 });
}

/** A pass: a quick soft flip (two short falling notes), neither a reward nor a mistake. */
export function playSkip() {
  voice({ freq: 659.25, dur: 0.07, level: 0.22 });
  voice({ freq: 493.88, at: 0.06, dur: 0.11, level: 0.2 });
}

/** Entering a combo tier: a short two-note "level up"; the top tier a short rising chord. */
export function playTierUp(tier: number) {
  if (tier >= 3) {
    [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => voice({ freq: f, at: i * 0.05, dur: 0.32, level: 0.22, type: "triangle" }));
    return;
  }
  voice({ freq: 783.99, dur: 0.12, level: 0.25, type: "triangle" });
  voice({ freq: 1046.5, at: 0.08, dur: 0.18, level: 0.25, type: "triangle" });
}

/** A very quiet extra tone after the note when the player's place changed (up a step / down a step). */
export function playPlace(up: boolean) {
  voice({ freq: up ? 1046.5 : 392.0, at: 0.09, dur: 0.12, level: 0.1 });
}

/** Passing someone (higher, longer) / being passed (lower, shorter). */
export const playOvertake = (mine: boolean) => sweep(mine, mine ? 0.2 : 0.14, mine ? 0.16 : 0.1);

/** The last seconds: a soft tick. */
export const playTick = () => voice({ freq: 1200, dur: 0.04, level: 0.08, attack: 0.002 });

/** The "nudge" of a big moment (taking 1st place, the top combo tier, finishing first). */
export function playNudge() {
  voice({ freq: 220, to: 180, dur: 0.08, level: 0.3, type: "triangle", attack: 0.004 });
  voice({ freq: 260, to: 210, at: 0.1, dur: 0.08, level: 0.3, type: "triangle", attack: 0.004 });
}

/** The race starts (end of the countdown): two short rising notes. */
export function playStart() {
  voice({ freq: 523.25, dur: 0.12, level: 0.4, type: "triangle" });
  voice({ freq: 783.99, at: 0.1, dur: 0.22, level: 0.45, type: "triangle" });
}

/** End of the race: rising when the player won, softer and lower otherwise (same palette). */
export function playFinish(won: boolean) {
  const notes = won ? [523.25, 659.25, 783.99, 1046.5] : [392.0, 440.0, 523.25];
  notes.forEach((f, i) => voice({ freq: f, at: i * (won ? 0.09 : 0.13), dur: won ? 0.45 : 0.5, level: 0.35, type: "triangle" }));
}

// The final stretch: a quiet low pulse while any racer is on their last 3 questions.
let tension: { osc: OscillatorNode; lfo: OscillatorNode; offset: ConstantSourceNode; gain: GainNode } | null = null;

export function setTension(on: boolean) {
  if (!on || !ready()) {
    if (tension && ctx) {
      tension.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
      const t = tension;
      setTimeout(() => {
        for (const n of [t.osc, t.lfo, t.offset]) {
          n.stop();
          n.disconnect();
        }
        t.gain.disconnect();
      }, 400);
    }
    tension = null;
    return;
  }
  if (tension) return;
  const c = ctx!;
  const osc = c.createOscillator();
  osc.frequency.value = 82;
  const gain = c.createGain();
  gain.gain.value = 0;
  // Pulse: the LFO moves the level between 0 and ~0.12, twice a second.
  const lfo = c.createOscillator();
  lfo.frequency.value = 2;
  const depth = c.createGain();
  depth.gain.value = 0.06;
  lfo.connect(depth).connect(gain.gain);
  const offset = c.createConstantSource();
  offset.offset.value = 0.06;
  offset.connect(gain.gain);
  offset.start();
  osc.connect(gain).connect(master!);
  osc.start();
  lfo.start();
  tension = { osc, lfo, offset, gain };
}
