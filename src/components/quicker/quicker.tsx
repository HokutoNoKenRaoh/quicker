"use client";

import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleHelp, Grid3x3, X } from "lucide-react";
import type { AvatarView } from "@/lib/avatar";
import { QUICKER } from "@/lib/game";
import { COMBO_START, DEFAULT_QUESTIONS, SKIP_LOCK_MS, WRONG_LOCK_MS, isWrongInput, type BotLevel, type QuestionCount } from "@/lib/engine";
import type { RoomView, Visibility } from "@/lib/server/registry";
import { GameLayer, keepLayerEntry } from "../game-layer";
import { AnswerBox, Keypad, useTabletWidth, useTouchKeypad, useTouchScreen, type PadKey } from "./answer-pad";
import { DEFAULT_BOTS } from "./bot-settings";
import { ConfirmExit } from "./confirm-exit";
import { HowToPlayCard, HowToPlayDialog } from "./how-to-play";
import { LobbyScreen } from "./lobby";
import { useLobbySetting } from "./lobby-setting";
import { Menu, type Records } from "./menu";
import { RaceTrack, type Float, type TrackRacer } from "./race-track";
import { ResultsDialog } from "./results-dialog";
import { Setup } from "./setup";
import {
  readBest,
  readBots,
  readIntroSeen,
  readPassHintDone,
  readKeypad,
  readQuestions,
  readResults,
  saveResult,
  writeBots,
  writeIntroSeen,
  writePassHintDone,
  writeKeypad,
  writeQuestions,
} from "./storage";
import { playFinish, playStart, unlockAudio } from "./feedback/audio";
import { RankPulseLayer, rankColor, rankPosition } from "./feedback/effects";
import { useFeedbackSettings } from "./feedback/settings";
import { SettingsMenu } from "./feedback/settings-menu";
import { comboTier, standings, useFeedback } from "./feedback/use-feedback";
import { leaveSeat, post, useRace, type AheadQuestion, type AnswerReply, type Seat } from "./use-race";

// quicker. The race runs on the server (lib/server/registry.ts): it picks the questions
// and the bots, starts the clock, times every answer and decides the placings. This component shows the room it
// streams (./use-race.ts) and sends what the player types; the next question shows at once (the browser checks the
// typed digits against it), the points come back from the server.
//
//   MENU → SETUP (bots) → Start: GAME (countdown → race → results → Play again)
//                                → Create lobby: GAME (lobby ⇄ countdown → race → results);   anywhere → MENU
//   Lobby link (/lobby/<code>): straight into the lobby.
//
// Everything after the menu runs in the game window (../game-layer.tsx). There is no text field: touch screens answer
// on the game's own keypad (./answer-pad.tsx, no system keyboard), computers on their keyboard (a key listener on the
// window); both go through pressKey(). "Pass" (a new question in place of one the player is stuck on) is a sideways
// swipe or a double tap on the question card, Tab on a keyboard. From the countdown on the screen is laid out exactly
// as in the race; the question card holds a practice question ("Practice"), never the real first one. The warm-up looks
// different (a "WARM-UP · No points" banner, the big countdown over the faded lanes, a dashed card with a PRACTICE
// badge and its own feedback) and the start is a moment ("GO!" over the track); a first-time card on the setup /
// lobby screen and the "?" of the top bar explain it.

type Stage = "MENU" | "SETUP" | "GAME";
type Mode = "QUICK" | "LOBBY";
type ActionKind = "START" | "CREATE_LOBBY" | "LAUNCH" | "READY" | "UNREADY";
type Phase = "CONNECTING" | "ERROR" | "LOBBY" | "COUNTDOWN" | "RACING" | "WATCHING" | "FINISHED" | "GONE" | "REMOVED" | "TAKEN";

const COUNTDOWN_FROM = 5;
/** How long a "+100" stays over an avatar (the hy-float animation). */
const FLOAT_MS = 1000;
/** Keys pressed this close to the start are dropped (they were meant for the practice question). */
const START_GUARD_MS = 150;
/** "Pass" by touch on the question card: a sideways swipe this long and fast, or two taps this close together. */
const SWIPE_PX = 40;
const SWIPE_MS = 600;
const TAP_MS = 250;
const TAP_SLOP_PX = 12;
const DOUBLE_TAP_MS = 320;

type SeatReply = { ok: true; roomId: string; token: string; key: string; code?: string };

type Practice = { seq: number; text: string; answer: string };
/**
 * A pass in the race: the question it replaced (index), the new one once the server sent it, when input opens again
 * (server clock, for the bar in the answer box) and the side the new question comes from (1 = right).
 */
type Pass = { raceId: string; i: number; seq: number; question: AheadQuestion | null; lockEnd: number; from: number };
/** A practice sum for the countdown (made in the browser, never sent or scored). */
function practiceAfter(prev: Practice): Practice {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const minus = Math.random() < 0.4 && a > b;
  const text = `${a} ${minus ? "−" : "+"} ${b}`;
  return text === prev.text ? practiceAfter(prev) : { seq: prev.seq + 1, text, answer: String(minus ? a - b : a + b) };
}
const FIRST_PRACTICE: Practice = { seq: 0, text: "2 + 3", answer: "5" };

// One join request per lobby at a time in this tab: React's development double mount (and a quick second render)
// would otherwise send two at once, and a guest's first two requests carry no cookie yet, i.e. two seats.
const joining = new Map<string, Promise<SeatReply | { ok: false; message?: string }>>();
function joinOnce(code: string) {
  let request = joining.get(code);
  if (!request) {
    request = post<SeatReply>("join", { code });
    joining.set(code, request);
    void request.finally(() => joining.delete(code));
  }
  return request;
}

/** The question's width in em (bold digits and signs about 0.62 em, spaces 0.3, the wide tracking, 5 % spare). */
const questionEm = (text: string) => ([...text].reduce((w, c) => w + (c === " " ? 0.3 : 0.62) + 0.025, 0) * 1.05).toFixed(2);

/** Every player is a guest; the server names them "Guest N" in a lobby. */
const PLAYER: { name: string; avatar: AvatarView } = { name: "Guest", avatar: { kind: "letter", char: "G", color: null } };

export function Quicker({
  lobbyCode,
}: {
  /** Opened from an invite link: join this lobby at once. */
  lobbyCode?: string;
}) {
  const player = PLAYER;
  const [stage, setStage] = useState<Stage>(lobbyCode ? "GAME" : "MENU");
  // The player tapped into a race (see showKeypad).
  const [armed, setArmed] = useState(false);
  const [mode, setMode] = useState<Mode>(lobbyCode ? "LOBBY" : "QUICK");
  const [seat, setSeat] = useState<Seat | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A lobby action that failed (e.g. Start while someone isn't ready).
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  // The race whose results the player closed.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const race = useRace(seat);
  const { serverNow, sendAnswer, sendPass } = race;
  const v = race.view;

  // Server time, sampled ten times a second while a game is open (countdown, "Son N saniye", the floats).
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (stage !== "GAME") return;
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [stage, serverNow]);

  // The player's own progress as the browser knows it (one step ahead of the server while an answer travels) and
  // the last reply (the score before the next broadcast).
  const [local, setLocal] = useState({ raceId: "", answered: 0 });
  const [reply, setReply] = useState<{ raceId: string; answered: number; score: number; combo: number } | null>(null);
  // What the player typed, tied to the question it was typed for (a new question shows an empty box by itself).
  const [typed, setTyped] = useState({ key: "", value: "" });
  const [practice, setPractice] = useState<Practice>(FIRST_PRACTICE);
  // The last practice answer of this race's warm-up ("Correct! (practice)" / "Wrong, try again (practice)").
  const [practiceFb, setPracticeFb] = useState<{ raceId: string; ok: boolean; n: number } | null>(null);
  // The first-time "How to play" card (true until read: no flash before hydration) and the "?" dialog.
  const [introSeen, setIntroSeen] = useState(true);
  const [howOpen, setHowOpen] = useState(false);
  const [pass, setPass] = useState<Pass | null>(null);
  const passSeq = useRef(0);
  const [flash, setFlash] = useState(0);
  // A wrong answer: the box flashes (a new key replays it) and input waits WRONG_LOCK_MS.
  const [wrongSeq, setWrongSeq] = useState(0);
  const lockUntil = useRef(0);
  // The game's own keypad: always on touch-only screens; on a touch screen with a keyboard / trackpad (a tablet with a
  // keyboard cover) when the player switches "Screen keys" on (remembered on the device). The keyboard works too.
  const keypadAuto = useTouchKeypad();
  const touchScreen = useTouchScreen();
  const [keypadChoice, setKeypadChoice] = useState(false);
  const keypad = keypadAuto || (touchScreen && keypadChoice);
  const toggleKeypad = () => {
    setKeypadChoice(!keypadChoice);
    writeKeypad(!keypadChoice);
  };
  // A tap on the question card while the keypad is hidden: a hint for 3 s (the keypad never opens by itself).
  const [tapHint, setTapHint] = useState(false);
  const tapHintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Full screen on every touch device up to an iPad Pro in landscape, and whenever the keypad is shown; the popup
  // is for mouse-and-keyboard computers.
  const tabletWidth = useTabletWidth();
  const fill = keypadAuto || keypad || (touchScreen && tabletWidth);
  // The play area's size (landscape with the keypad: two columns).
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  // The pass hint shows on the card only for a first race's first 3 questions (then the "?" help has it).
  const [passHintDone, setPassHintDone] = useState(true);
  const showTapHint = () => {
    setTapHint(true);
    clearTimeout(tapHintTimer.current);
    tapHintTimer.current = setTimeout(() => setTapHint(false), 3000);
  };
  const busy = useRef(false);

  // Remembered in this browser: the results, the bot slots and sound (read after hydration).
  const [localRecords, setLocalRecords] = useState<Records>({ results: [], best: {} });
  const [bots, setBots] = useState<BotLevel[]>(DEFAULT_BOTS);
  const [questions, setQuestions] = useState<QuestionCount>(DEFAULT_QUESTIONS);
  // Create lobby: listed under "Open lobbies" or the link only.
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const feedback = useFeedbackSettings();
  const soundOn = feedback.settings.sound;
  const windowRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
    setLocalRecords({ results: readResults(), best: readBest() });
    setBots(readBots(DEFAULT_BOTS));
    setQuestions(readQuestions());
    setKeypadChoice(readKeypad());
    setIntroSeen(readIntroSeen());
    setPassHintDone(readPassHintDone());
  }, []);

  // ---- What the room says --------------------------------------------------------------------------------------

  const startAt = v?.startAt ?? null;
  const phase: Phase = race.gone
    ? "GONE"
    : race.taken
      ? "TAKEN"
      : race.removed
      ? "REMOVED"
      : !seat && error && stage === "GAME"
        ? "ERROR"
        : !v
          ? "CONNECTING"
          : v.phase === "LOBBY"
            ? "LOBBY"
            : v.phase === "FINISHED"
              ? "FINISHED"
              : !v.me.racing
                ? "WATCHING"
                : startAt === null || now < startAt
                  ? "COUNTDOWN"
                  : "RACING";
  const inLobby = (v?.kind ?? (mode === "LOBBY" ? "LOBBY" : "QUICK")) === "LOBBY";
  const meKey = v?.me.key ?? seat?.key ?? "";
  const meOnServer = v?.racers.find((r) => r.id === meKey) ?? null;
  const sameRace = <T extends { raceId: string }>(x: T | null) => (x && v && x.raceId === v.raceId ? x : null);
  const myAnswered = Math.max(meOnServer?.answered ?? 0, sameRace(reply)?.answered ?? 0, sameRace(local)?.answered ?? 0);
  // The race's question count (the lobby's setting before a race).
  const total = v?.questionCount ?? questions;
  const myFinished = !!meOnServer?.finished || myAnswered >= total;
  // After a pass the question on screen is the server's replacement (null while it is on the way).
  const passNow = pass && v && pass.raceId === v.raceId && pass.i === myAnswered ? pass : null;
  const question = phase === "RACING" && !myFinished ? (passNow ? passNow.question : (v?.ahead.find((q) => q.i === myAnswered) ?? null)) : null;
  const racers: TrackRacer[] =
    v?.racers.map((r) =>
      r.id === meKey && reply && reply.raceId === v.raceId && reply.answered >= r.answered ? { ...r, score: Math.max(r.score, reply.score), combo: reply.combo } : r
    ) ?? [];
  const floats: Float[] =
    v && startAt !== null ? v.events.filter((e) => now - (startAt + e.at) < FLOAT_MS).map((e) => ({ seq: e.seq, racerId: e.racerId, points: e.points, bonus: e.bonus })) : [];
  const live = phase === "RACING" || phase === "WATCHING";
  const lastCall = live && v?.firstFinishAt != null && v.deadline !== null ? Math.max(0, Math.ceil((v.deadline - now) / 1000)) : null;
  const count = startAt !== null ? Math.min(COUNTDOWN_FROM, Math.max(1, Math.ceil((startAt - now) / 1000))) : COUNTDOWN_FROM;
  const racing = stage === "GAME" && (phase === "COUNTDOWN" || phase === "RACING");
  // Where the player stands (the chip in the top bar, the gap line under the question) and their combo tier.
  const order = phase === "RACING" || phase === "FINISHED" ? standings(racers, meKey, myAnswered) : [];
  const myPlace = order.findIndex((r) => r.id === meKey) + 1;
  const myCombo = racers.find((r) => r.id === meKey)?.combo ?? 10;
  const myTier = comboTier(myCombo);
  const answeredOf = (r: TrackRacer) => (r.id === meKey ? Math.max(myAnswered, r.answered) : r.answered);
  // The gap to the next place, one short line beside the place chip in the top bar.
  const gap =
    order.length > 1 && myPlace > 0
      ? myPlace === 1
        ? answeredOf(order[0]!) - answeredOf(order[1]!) > 0
          ? `${answeredOf(order[0]!) - answeredOf(order[1]!)} ahead of 2nd`
          : "level with 2nd"
        : answeredOf(order[0]!) - myAnswered > 0
          ? `${answeredOf(order[0]!) - myAnswered} behind 1st`
          : "level with 1st"
      : null;
  // The keypad's place stays from the player's own tap into a race (Start, Play again, I'm ready, Start the race) to their tap
  // after it (the results, Not ready, leaving): it never appears or disappears without input, so the card above it
  // never jumps when the server starts the countdown or ends the race. Its keys work
  // only in the countdown and the race.
  const showKeypad = keypad && stage === "GAME" && (phase === "COUNTDOWN" || phase === "RACING" || (armed && (phase === "CONNECTING" || phase === "LOBBY" || phase === "FINISHED")));
  const keysLive = phase === "COUNTDOWN" || (phase === "RACING" && !myFinished);
  const twoCol = showKeypad && area.w > area.h && area.w >= 700;
  // A short play area (most phones between their browser bars, a phone in landscape): the card's question and answer
  // on one row, tighter keys, so the lanes keep their room.
  const compact = area.h > 0 && area.h < 640;
  // The card's question and answer side by side: a short portrait area, or a landscape one too short to stack them
  // over the keypad (a phone on its side); a tablet's right column has room for the stacked card.
  const cardRow = compact && (!twoCol || area.h < 440);
  const showPassHint = !passHintDone && myAnswered < 3;
  const views = (room: RoomView | null): Record<string, AvatarView> => Object.fromEntries((room?.members ?? []).map((m) => [m.key, m.avatar]));
  const finished = race.finished && race.finished.raceId !== dismissed ? race.finished : null;

  /** The tap that leads into a race: browsers let the sounds play only after a user gesture. */
  const tapIntoRace = useCallback(() => unlockAudio(), []);

  // ---- Starting --------------------------------------------------------------------------------------------------

  const resetRaceState = () => {
    setError(null);
    setLobbyError(null);
    setTyped({ key: "", value: "" });
    setReply(null);
  };

  /** Quick start / Create lobby: asks the server for a seat. */
  const takeSeat = useCallback(
    async (path: "quick" | "lobby", body: unknown) => {
      if (busy.current) return;
      busy.current = true;
      setSeat(null);
      setStage("GAME");
      const res = await post<SeatReply>(path, body);
      busy.current = false;
      if (!res.ok) {
        setError(res.message ?? "Couldn't connect. Try again in a little while.");
        setStage("SETUP");
        return;
      }
      setSeat({ roomId: res.roomId, token: res.token, key: res.key });
    },
    []
  );

  const startQuick = useCallback(() => {
    if (seat) leaveSeat(seat);
    void takeSeat("quick", { bots, questions });
  }, [seat, takeSeat, bots, questions]);

  // An invite link: join at once (again with "Try again").
  const [joinAttempt, setJoinAttempt] = useState(0);
  useEffect(() => {
    if (!lobbyCode) return;
    let off = false;
    // React's development double mount sends this twice: the server gives the same browser the same seat (by its
    // cookie, which also brings it back after a reload or from a new tab).
    void joinOnce(lobbyCode).then((res) => {
      if (off) return;
      if (res.ok) setSeat({ roomId: res.roomId, token: res.token, key: res.key });
      else setError(res.message ?? "Couldn't join the lobby.");
    });
    return () => {
      off = true;
    };
  }, [lobbyCode, joinAttempt]);

  /** Start / Play again / New race (a tap: the keyboard opens). */
  const quickAgain = () => {
    setArmed(true);
    tapIntoRace();
    resetRaceState();
    startQuick();
  };

  const retryJoin = () => {
    setError(null);
    setJoinAttempt((n) => n + 1);
  };

  const openSetup = (m: Mode) => {
    // The click is the user gesture that lets the sounds play later (iOS: inside the gesture, so not deferred).
    unlockAudio();
    // Opening the window (mounting the layer and the setup) is a transition: the button's press shows first.
    startTransition(() => {
      resetRaceState();
      setMode(m);
      setStage("SETUP");
    });
  };

  const changeBots = (levels: BotLevel[]) => {
    setBots(levels);
    writeBots(levels);
  };

  const changeQuestions = (count: QuestionCount) => {
    setQuestions(count);
    writeQuestions(count);
  };

  // ---- Lobby actions ---------------------------------------------------------------------------------------------

  /** A lobby action; its error shows under the button (or is returned to the caller that shows it itself). */
  const lobbyAction = async (body: Record<string, unknown>, quiet = false): Promise<string | null> => {
    if (!seat) return null;
    if (!quiet) setLobbyError(null);
    const res = await post<{ ok: boolean; message?: string }>("action", { room: seat.roomId, token: seat.token, ...body });
    if (res.ok) return null;
    const message = res.message ?? "That didn't work.";
    if (!quiet) setLobbyError(message);
    return message;
  };

  // The host's bots and question count: shown at once, sent coalesced (lobby-setting.ts).
  const lobbyBots = useLobbySetting(v?.botLevels, (levels) => lobbyAction({ action: "bots", bots: levels }));
  const lobbyQuestions = useLobbySetting(v?.questionCount, (count) => lobbyAction({ action: "questions", questions: count }));

  const me = v?.members.find((m) => m.key === meKey) ?? null;
  const waitingFor = v ? v.members.filter((m) => !m.host && m.here && !m.ready).length : 0;

  // ---- The end -----------------------------------------------------------------------------------------------------

  const finishedRace = race.finished?.raceId ?? null;
  const soundRef = useRef(soundOn);
  const resultRef = useRef(race.finished?.results?.mine ?? null);
  const resultTotalRef = useRef(race.finished?.questionCount ?? DEFAULT_QUESTIONS);
  useLayoutEffect(() => {
    soundRef.current = soundOn;
    resultRef.current = race.finished?.results?.mine ?? null;
    resultTotalRef.current = race.finished?.questionCount ?? DEFAULT_QUESTIONS;
  });
  // A new record of this browser (known once the result is saved there).
  const [localRecord, setLocalRecord] = useState<string | null>(null);
  useEffect(() => {
    if (!finishedRace) return;
    const r = resultRef.current;
    if (r && soundRef.current) playFinish(r.placing === 1);
    if (r && saveResult(r, resultTotalRef.current)) setLocalRecord(finishedRace);
  }, [finishedRace]);

  // ---- Leaving -----------------------------------------------------------------------------------------------------

  const exit = useCallback(() => {
    if (seat) leaveSeat(seat);
    setSeat(null);
    setArmed(false);
    setTyped({ key: "", value: "" });
    setConfirmExit(false);
    setError(null);
    // From an invite link: the game page.
    if (lobbyCode) return window.location.replace("/");
    setStage("MENU");
    setLocalRecords({ results: readResults(), best: readBest() });
  }, [seat, lobbyCode]);

  // Leaving the page (in the app) gives the seat back; a closed tab is counted as left by the server after a while.
  const seatRef = useRef(seat);
  useLayoutEffect(() => {
    seatRef.current = seat;
  });
  useEffect(
    () => () => {
      if (seatRef.current) leaveSeat(seatRef.current);
    },
    []
  );

  const askExit = useCallback(() => setConfirmExit(true), []);

  /** "Devam et": the race kept running. */
  const keepPlaying = useCallback(() => setConfirmExit(false), []);

  // Back button / swipe: while racing it asks first; elsewhere it closes the game.
  const racingRef = useRef(racing);
  const confirmRef = useRef(confirmExit);
  useLayoutEffect(() => {
    racingRef.current = racing;
    confirmRef.current = confirmExit;
  });
  const onBack = useCallback(() => {
    if (racingRef.current) {
      keepLayerEntry();
      if (!confirmRef.current) askExit();
    } else exit();
  }, [askExit, exit]);

  // Escape (desktop): while racing it asks before leaving; on the setup screen and the end notices it closes the
  // window like any popup (not in a lobby, where it would also leave the lobby, nor over an open dialog).
  const closableRef = useRef(false);
  useLayoutEffect(() => {
    closableRef.current = stage === "SETUP" || phase === "GONE" || phase === "REMOVED" || phase === "ERROR";
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirmRef.current || document.querySelector("dialog[open]")) return;
      if (racingRef.current) {
        e.preventDefault();
        askExit();
      } else if (closableRef.current) {
        e.preventDefault();
        exit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askExit, exit]);

  // ---- Typing ------------------------------------------------------------------------------------------------------

  const onReply = (raceId: string) => (r: AnswerReply) => {
    if (r.ok && (r.accepted || r.wrong)) return setReply({ raceId, answered: r.answered, score: r.score, combo: r.combo });
    // Not counted (too many answers a second, no connection, the race ended, out of step): the browser's own count
    // drops and the question the server waits for shows again.
    setLocal({ raceId, answered: 0 });
  };

  const fx = useFeedback({
    settings: { sound: soundOn, effects: feedback.effects, shake: feedback.shake },
    raceId: v?.raceId ?? null,
    racing: phase === "RACING",
    racers,
    meKey,
    myAnswered,
    myCombo,
    total,
    lastCall,
    sinceStart: () => (startAt !== null ? Math.max(0, serverNow() - startAt) : 0),
    windowEl: () => windowRef.current,
    cardEl: () => cardRef.current,
    labelEl: () => labelRef.current,
  });

  // The answer box belongs to one question: the race's current one (a pass changes its text), or the countdown's
  // practice question.
  const answerKey = v?.raceId ? (phase === "RACING" && question ? `${v.raceId}:${question.i}:${question.text}` : phase === "COUNTDOWN" ? `${v.raceId}:practice:${practice.seq}` : "") : "";
  const shown = typed.key === answerKey ? typed.value : "";

  /**
   * "Pass": a new question in place of this one. The practice gets one at once; in the race the server sends it (the
   * same level, for this player only) and input waits SKIP_LOCK_MS, the combo resets and the next answer's time still
   * runs from the last correct one, so passing never pays unless the player is stuck. `from`: 1 = slide in from the
   * right, -1 = from the left.
   */
  const passQuestion = (raceId: string, i: number | null, at: number, from: number) => {
    setTyped({ key: "", value: "" });
    fx.skip(i !== null);
    if (i === null) return setPractice((p) => practiceAfter(p));
    lockUntil.current = at + SKIP_LOCK_MS;
    const seq = ++passSeq.current;
    setPass({ raceId, i, seq, question: null, lockEnd: serverNow() + SKIP_LOCK_MS, from });
    const mine = racers.find((r) => r.id === meKey);
    setReply({ raceId, answered: myAnswered, score: mine?.score ?? 0, combo: COMBO_START });
    sendPass(raceId, i, (r) => {
      if (r.ok && r.skipped && r.question) {
        const next = r.question;
        setReply({ raceId, answered: r.answered, score: r.score, combo: r.combo });
        return setPass((p) => (p?.seq === seq ? { ...p, question: next } : p));
      }
      // Not done (the race ended, out of step, no connection): the question the server waits for shows again.
      if (lockUntil.current === at + SKIP_LOCK_MS) lockUntil.current = 0;
      setPass((p) => (p?.seq === seq ? null : p));
    });
  };

  /** One key from the keypad or the keyboard (`at`: the event's time, for the input locks). */
  const pressKey = (k: PadKey, at: number, from = 1) => {
    // Every tap may wake the sound: phones stop it after a call, a notification or another app.
    if (soundOn) unlockAudio();
    if (!answerKey || !v?.raceId || at < lockUntil.current) return;
    const inRace = phase === "RACING" && !!question;
    // The last moment of the countdown: the key was meant for the practice question.
    if (!inRace && startAt !== null && startAt - serverNow() < START_GUARD_MS) return;
    if (k === "PASS") return passQuestion(v.raceId, inRace ? question!.i : null, at, from);
    const value = k === "BACKSPACE" ? shown.slice(0, -1) : k === "CLEAR" ? "" : shown.length < 2 ? shown + k : shown;
    const target = inRace ? question!.answer : practice.answer;
    // Wrong: the digits can't become the answer any more. Same question, empty box, combo gone, a short lock; the
    // server hears about it (it keeps the combo and counts the mistake).
    if (isWrongInput(value, target)) {
      lockUntil.current = at + WRONG_LOCK_MS;
      setTyped({ key: "", value: "" });
      setWrongSeq((n) => n + 1);
      if (!inRace) {
        setPracticeFb((f) => ({ raceId: v.raceId!, ok: false, n: (f?.n ?? 0) + 1 }));
        return fx.practice(false);
      }
      fx.wrong();
      const mine = racers.find((r) => r.id === meKey);
      setReply({ raceId: v.raceId, answered: myAnswered, score: mine?.score ?? 0, combo: COMBO_START });
      sendAnswer(v.raceId, question!.i, value, onReply(v.raceId));
      return;
    }
    if (value !== target) return setTyped({ key: answerKey, value });
    setTyped({ key: "", value: "" });
    setFlash((f) => f + 1);
    if (!inRace) {
      fx.practice(true);
      setPracticeFb((f) => ({ raceId: v.raceId!, ok: true, n: (f?.n ?? 0) + 1 }));
      return setPractice((p) => practiceAfter(p));
    }
    fx.correct();
    setLocal({ raceId: v.raceId, answered: question!.i + 1 });
    // A first race past its 3rd question: the pass hint on the card has done its job on this device.
    if (!passHintDone && question!.i + 1 >= 3) {
      writePassHintDone();
      setPassHintDone(true);
    }
    sendAnswer(v.raceId, question!.i, value, onReply(v.raceId));
  };

  // A computer's keyboard: digits, Backspace (one digit), Delete (all), Tab ("Pass", only while there is a question to
  // pass: elsewhere Tab moves the focus as usual). Not while a dialog or another field (a guest's name) has the keys,
  // and only real key presses.
  const pressKeyRef = useRef(pressKey);
  const canPassRef = useRef(false);
  useLayoutEffect(() => {
    pressKeyRef.current = pressKey;
    canPassRef.current = answerKey !== "";
  });
  useEffect(() => {
    if (stage !== "GAME") return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted || e.repeat || e.ctrlKey || e.metaKey || e.altKey || confirmRef.current || document.querySelector("dialog[open]")) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      const key: PadKey | null = /^[0-9]$/.test(e.key)
        ? (e.key as PadKey)
        : e.key === "Backspace"
          ? "BACKSPACE"
          : e.key === "Delete"
            ? "CLEAR"
            : e.key === "Tab" && !e.shiftKey && canPassRef.current
              ? "PASS"
              : null;
      if (!key) return;
      e.preventDefault();
      pressKeyRef.current(key, e.timeStamp);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage]);

  // "Pass" by touch on the question card (the keypad keeps its keys): a sideways swipe, or a double tap. Touch and pen
  // only, so a mouse's clicks never pass a question.
  const swipe = useRef<{ id: number; x: number; y: number; t: number; done: boolean } | null>(null);
  const lastTap = useRef({ t: -Infinity, x: 0, y: 0 });
  const onPassPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isTrusted || e.pointerType === "mouse" || !answerKey) return;
    if (e.pointerType === "touch" && !keypad) showTapHint();
    const tap = lastTap.current;
    if (e.timeStamp - tap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < TAP_SLOP_PX * 3) {
      lastTap.current = { t: -Infinity, x: 0, y: 0 };
      swipe.current = null;
      return pressKey("PASS", e.timeStamp);
    }
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, done: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPassPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId || s.done) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5 && e.timeStamp - s.t < SWIPE_MS) {
      s.done = true;
      pressKey("PASS", e.timeStamp, dx < 0 ? 1 : -1);
    }
  };
  const onPassPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    swipe.current = null;
    // A short tap in place may be the first half of a double tap.
    if (!s.done && e.timeStamp - s.t < TAP_MS && Math.hypot(e.clientX - s.x, e.clientY - s.y) < TAP_SLOP_PX) lastTap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  };
  const onPassPointerCancel = () => {
    swipe.current = null;
  };

  // The play area's size, for the landscape layout.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry!.contentRect.width);
      const h = Math.round(entry!.contentRect.height);
      setArea((a) => (a.w === w && a.h === h ? a : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage]);

  // "GO!" at the end of the countdown.
  const raceStarted = phase === "RACING" ? (v?.raceId ?? null) : null;
  useEffect(() => {
    if (!raceStarted) return;
    if (soundRef.current) playStart();
    // The first race on this device: the "How to play" card has done its job.
    writeIntroSeen();
  }, [raceStarted]);

  // ---- Screens -------------------------------------------------------------------------------------------------

  // The menu stays in the page under the game window (hidden, inert), so opening and closing the window never changes
  // the page's layout (a close by the back gesture has no input, and the jump counted as layout shift). An invite
  // link leaves the page on exit: no menu there.
  const menu = lobbyCode ? null : (
    <div className={stage === "MENU" ? undefined : "invisible"} inert={stage !== "MENU"}>
      <Menu
        onQuick={() => openSetup("QUICK")}
        onLobby={() => openSetup("LOBBY")}
        records={localRecords}
        paused={stage !== "MENU"}
      />
    </div>
  );
  if (stage === "MENU") return menu;

  const prompt = question
    ? question.text
    : phase === "RACING" && passNow && !myFinished
      ? "New question…"
      : phase === "RACING" && myFinished
      ? "Finished!"
      : phase === "FINISHED"
        ? "Over"
        : phase === "WATCHING"
          ? "Watching"
          : phase === "COUNTDOWN"
            ? "Get ready…"
            : "–";

  // The button above the answer field (its tap opens the keyboard where a race follows).
  let action: { kind: ActionKind; label: string; disabled?: boolean; secondary?: boolean; note?: string } | null = null;
  if (stage === "SETUP") action = mode === "QUICK" ? { kind: "START", label: "Start" } : { kind: "CREATE_LOBBY", label: "Create lobby" };
  else if (phase === "LOBBY" && v && me) {
    if (v.me.host) action = { kind: "LAUNCH", label: "Start the race", disabled: waitingFor > 0, note: waitingFor > 0 ? `Waiting for ${waitingFor} ${waitingFor === 1 ? "person" : "people"} to get ready.` : undefined };
    else if (me.ready) action = { kind: "UNREADY", label: "Not ready", secondary: true, note: "You're ready. The lobby's host will start the race." };
    else action = { kind: "READY", label: "I'm ready" };
  }
  const runAction = (kind: ActionKind) => {
    if (kind === "START") return quickAgain();
    if (kind === "CREATE_LOBBY") return void takeSeat("lobby", { bots, questions, visibility });
    if (kind === "UNREADY") {
      setArmed(false);
      return void lobbyAction({ action: "ready", ready: false });
    }
    setArmed(true);
    tapIntoRace();
    resetRaceState();
    void lobbyAction(kind === "LAUNCH" ? { action: "start" } : { action: "ready", ready: true });
  };
  const beforeRace = stage === "SETUP" || phase === "LOBBY";
  // How to pass a question, on the card from the setup screen to the end of the race.
  const passHint = keypad ? "Pass: swipe the question card or double-tap it." : "Pass: Tab.";
  const passHow = keypad ? "swipe the question card sideways or double-tap it" : "press Tab";
  const intro =
    !introSeen && phase !== "RACING" && phase !== "COUNTDOWN" ? (
      <HowToPlayCard
        passHow={passHow}
        onDone={() => {
          setIntroSeen(true);
          writeIntroSeen();
        }}
      />
    ) : null;
  // The warm-up (countdown) and the start's "GO!" (about 600 ms, from the clock the screen samples anyway).
  const warmUp = phase === "COUNTDOWN" || (phase === "WATCHING" && startAt !== null && now < startAt);
  const go = (phase === "RACING" || phase === "WATCHING") && startAt !== null && now >= startAt && now - startAt < 650;
  const fb = practiceFb && practiceFb.raceId === v?.raceId ? practiceFb : null;
  const passLocked = !!passNow && now < passNow.lockEnd;

  const notice = (title: string, text: string, again?: { label: string; kind: "NEW" | "JOIN" | "RECLAIM" }) => (
    <section className="card p-6 w-full max-w-md m-auto space-y-4 text-center" role="alert">
      <p className="font-semibold">{title}</p>
      {text && <p className="text-sm text-muted">{text}</p>}
      <div className="flex gap-3">
        {again && (
          <button type="button" onClick={() => (again.kind === "NEW" ? quickAgain() : again.kind === "RECLAIM" ? race.reclaim() : retryJoin())} className="btn-primary press flex-1 py-2.5 font-semibold">
            {again.label}
          </button>
        )}
        <button type="button" onClick={exit} className="btn-secondary flex-1 py-2.5 text-sm">
          Back to menu
        </button>
      </div>
    </section>
  );

  let body: React.ReactNode;
  if (stage === "SETUP") {
    body = (
      <Setup
        lobby={mode === "LOBBY"}
        player={player}
        bots={bots}
        onBots={changeBots}
        questions={questions}
        onQuestions={changeQuestions}
        intro={intro}
        visibility={visibility}
        onVisibility={setVisibility}
        error={error}
      />
    );
  } else if (phase === "GONE") {
    body = notice("The server restarted and the race was cancelled.", "This race wasn't saved.", inLobby ? undefined : { label: "New race", kind: "NEW" });
  } else if (phase === "TAKEN") {
    body = notice("This game was opened in another window.", "Take it here to continue; the other window stops.", { label: "Take it here", kind: "RECLAIM" });
  } else if (phase === "REMOVED") {
    body = notice(race.removed === "OTHER_ROOM" ? "You moved to a new game in another window." : "You were removed from the lobby.", "");
  } else if (phase === "ERROR") {
    body = notice(error ?? "Couldn't join the lobby.", "", lobbyCode ? { label: "Try again", kind: "JOIN" } : undefined);
  } else if (phase === "CONNECTING" || !v) {
    body = (
      <div className="card p-6 w-full max-w-md m-auto text-center text-muted" role="status">
        {mode === "LOBBY" ? "Connecting to the lobby…" : "Getting the race ready…"}
      </div>
    );
  } else if (phase === "LOBBY") {
    body = (
      <LobbyScreen
        view={{ ...v, botLevels: lobbyBots.value ?? v.botLevels, questionCount: lobbyQuestions.value ?? v.questionCount }}
        onBots={(levels) => {
          writeBots(levels);
          lobbyBots.change(levels);
        }}
        onQuestions={(count) => {
          changeQuestions(count);
          lobbyQuestions.change(count);
        }}
        onKick={(key) => void lobbyAction({ action: "kick", key })}
        onRename={(name) => lobbyAction({ action: "name", name }, true)}
        onVisibility={(v) => void lobbyAction({ action: "visibility", visibility: v })}
        intro={intro}
      />
    );
  } else {
    body = (
      <>
        {phase === "WATCHING" && <p className="notice-info px-3 py-2 mb-2 text-sm text-center">You're watching this race; when it ends everyone goes back to the lobby and you can join the next one.</p>}
        <RaceTrack
          racers={racers}
          total={total}
          floats={floats}
          meId={meKey}
          myAnswered={myAnswered}
          myTier={feedback.effects ? myTier : 0}
          playerView={views(v)[meKey] ?? player.avatar}
          memberViews={views(v)}
          dimmed={warmUp}
        >
          {/* The warm-up: a banner over the finish strip and the big countdown over the faded lanes. */}
          {warmUp && (
            <>
              <div className="notice-warning absolute inset-x-0 top-0 z-10 px-3 py-1.5 text-center text-xs md:text-sm font-bold tracking-wide" role="status">
                WARM-UP · No points <span className="font-normal">· The race starts in {count} s</span>
              </div>
              <div aria-hidden className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                <span key={count} className="hy-count text-7xl md:text-9xl font-black text-primary tabular-nums">
                  {count}
                </span>
              </div>
            </>
          )}
          {/* The start: "GO!" for a moment. */}
          {go && (
            <div aria-hidden className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <span className="hy-go text-6xl md:text-8xl font-black text-primary">GO!</span>
            </div>
          )}
        </RaceTrack>
      </>
    );
  }

  return (
    <>
    {menu}
    <GameLayer onBack={onBack} label={QUICKER.title} fill={fill} windowRef={windowRef}>
      <div className="relative flex flex-col h-full w-full bg-background">
        {/* The rank pulse from the edges and the place number in a corner (feedback/effects.tsx). */}
        <RankPulseLayer glow={fx.glow} place={fx.placeEl} />
        {/* Slim top bar */}
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            {/* The title gives way to the place on narrow screens during a race. */}
            <h1 lang={QUICKER.lang} className={`text-base md:text-lg font-bold truncate normal-case ${phase === "RACING" ? "hidden sm:block" : ""}`}>{QUICKER.title}</h1>
            {/* The place, always readable (the colour is never the only signal), and the gap to the next place. */}
            {phase === "RACING" && order.length > 1 && myPlace > 0 && (
              <>
                <span
                  className="shrink-0 flex items-baseline gap-1 rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums border-2"
                  style={{ borderColor: rankColor(rankPosition(myPlace, order.length)) }}
                  aria-label={`You are ${myPlace} of ${order.length}`}
                >
                  <span className="text-[10px] font-semibold text-muted">PLACE</span>
                  {myPlace}/{order.length}
                </span>
                {gap && <span className="min-w-0 truncate text-xs text-muted">{gap}</span>}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {race.offline && phase !== "GONE" && phase !== "FINISHED" && (
              <span className="badge-neutral px-2 py-1 text-xs" role="status">
                Connecting…
              </span>
            )}
            {lastCall !== null && (
              <span className="badge-warning px-2 py-1 text-xs font-bold tabular-nums" aria-live="polite">
                Last {lastCall} s
              </span>
            )}
            <button type="button" onClick={() => setHowOpen(true)} aria-label="How to play" title="How to play" className="btn-secondary p-2">
              <CircleHelp size={18} aria-hidden />
            </button>
            {/* "Screen keys": a labelled on / off switch (a calculator icon alone wasn't found). */}
            {touchScreen && !keypadAuto && (
              <button
                type="button"
                role="switch"
                onClick={toggleKeypad}
                aria-checked={keypadChoice}
                title={keypadChoice ? "Screen keys on (tap to turn off)" : "Screen keys off (tap to turn on)"}
                className="btn-secondary flex items-center gap-2 pl-2 pr-2.5 py-1.5 text-sm font-semibold"
              >
                <Grid3x3 size={18} aria-hidden />
                <span>Screen keys</span>
                <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${keypadChoice ? "bg-primary" : "bg-border"}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-[left] ${keypadChoice ? "left-[1.125rem]" : "left-0.5"}`} />
                </span>
              </button>
            )}
            <SettingsMenu settings={feedback.settings} update={feedback.update} reducedMotion={feedback.reduced} />
            {/* Closes the game window (during a race it asks first; in a lobby it also leaves the lobby). */}
            <button
              type="button"
              onClick={racing ? askExit : exit}
              aria-label={inLobby && stage === "GAME" ? "Leave the lobby and close" : "Close the game"}
              title={inLobby && stage === "GAME" ? "Leave the lobby and close" : "Close"}
              className="btn-secondary p-2"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>

        {/* The play area: portrait (and computers) stack the lanes (or the setup / lobby), the card and the keypad; a
            landscape screen with the keypad shown puts the lanes left at full height and the card + keypad in a
            column on the right. Everything fits the visible height: the lanes keep at least 120 px, the keypad takes
            up to 42 % (at most 340 px, at least its four rows of keys), a short area gets the compact card and keys. */}
        <div
          ref={areaRef}
          className={twoCol ? "flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_clamp(340px,34vw,420px)] grid-rows-[minmax(0,1fr)] gap-3 p-2" : "flex-1 min-h-0 flex flex-col"}
        >
          <div className={twoCol ? "min-h-0 flex flex-col" : `flex flex-col p-2 ${showKeypad ? "flex-[1_1_0%] min-h-[120px]" : "flex-1 min-h-0"}`}>{body}</div>
          <div className={twoCol ? `min-h-0 flex flex-col ${cardRow ? "gap-2 pt-1" : compact ? "gap-2 pt-6" : "gap-3 pt-6"}` : "contents"}>
            {/* The question card (the keypad, on touch screens, under it). */}
            <div className={`relative shrink-0 flex justify-center ${twoCol ? "" : "px-3 pb-3"}`}>
              {/* A touch on the card with the keypad hidden: how to play by touch (with the switch itself). */}
              {tapHint && !keypad && (
                <div role="status" className="card absolute left-1/2 -translate-x-1/2 -top-14 z-20 w-[calc(100%-1.5rem)] max-w-md shadow-lg px-3 py-2 text-sm flex items-center justify-between gap-3">
                  <span>Turn on Screen keys to play by touch</span>
                  <button
                    type="button"
                    onClick={() => {
                      toggleKeypad();
                      setTapHint(false);
                    }}
                    className="btn-primary px-3 py-1.5 text-xs font-semibold shrink-0"
                  >
                    Turn on
                  </button>
                </div>
              )}
              {/* A combo tier's name, shown once when it is reached ("Streak!", "On fire!", "Unstoppable!"). */}
              <div ref={labelRef} aria-hidden className="pointer-events-none absolute left-1/2 -top-6 z-10 text-sm font-black text-primary whitespace-nowrap opacity-0" />
              <div
                ref={cardRef}
                onPointerDown={onPassPointerDown}
                onPointerMove={onPassPointerMove}
                onPointerUp={onPassPointerUp}
                onPointerCancel={onPassPointerCancel}
                className={`card relative overflow-hidden w-full ${showKeypad ? "max-w-[420px]" : "max-w-md"} rounded-2xl shadow-xl px-3 ${cardRow && racing ? "py-1.5" : "py-2.5"} ${racing ? "hy-pass-zone" : ""} ${phase === "COUNTDOWN" ? "outline-2 outline-dashed outline-primary -outline-offset-2" : ""} ${feedback.effects && phase === "RACING" && myTier > 0 ? `hy-tier-${myTier}` : ""}`}
              >
                {phase === "COUNTDOWN" && (
                  <span className={`badge-warning absolute left-2 z-10 px-1.5 py-0.5 text-[10px] font-bold tracking-widest ${cardRow ? "top-1/2 -translate-y-1/2" : "top-1.5"}`} aria-hidden>
                    PRACTICE
                  </span>
                )}
                {/* The question number, small in the corner. */}
                {phase === "RACING" && !myFinished && (
                  <span className={`absolute z-10 text-[11px] text-muted tabular-nums ${cardRow ? "left-2.5 top-1/2 -translate-y-1/2" : "right-3 top-1"}`}>
                    {cardRow ? "" : "Question "}
                    {Math.min(myAnswered + 1, total)}/{total}
                  </span>
                )}
                {/* The combo meter on the card's top edge (×1.0 → ×2.5); empties at once on a mistake. */}
                {phase === "RACING" && <span aria-hidden className="hy-combo-meter absolute left-0 top-0 h-1 bg-primary" style={{ width: `${((myCombo - 10) / 15) * 100}%` }} />}
                {/* Correct answer: a short success tint. */}
                {flash > 0 && <span key={flash} aria-hidden className="hy-flash absolute inset-0 pointer-events-none" />}
                {action && (
                  <>
                    <button
                      type="button"
                      onClick={() => runAction(action.kind)}
                      disabled={action.disabled}
                      className={`relative ${action.secondary ? "btn-secondary" : "btn-primary"} press w-full py-3 mb-2 text-lg font-semibold disabled:opacity-60`}
                    >
                      {action.label}
                    </button>
                    {(action.note || lobbyError) && (
                      <p className={`relative text-xs text-center mb-2 ${lobbyError ? "text-danger" : "text-muted"}`} role="status">
                        {lobbyError ?? action.note}
                      </p>
                    )}
                  </>
                )}
                {/* The question big in the middle, the answer area under it (one row on a short screen). */}
                {!beforeRace && (
                  <div className={cardRow ? `relative flex items-center gap-3 ${phase === "COUNTDOWN" ? "pl-16" : "pl-10"}` : "contents"}>
                    {/* hy-question (globals.css): the text shrinks to fit its width (a 3-number question in a narrow card). */}
                    <p
                      className={`hy-question relative text-center font-bold tabular-nums tracking-wide whitespace-nowrap ${cardRow ? "flex-1 min-w-0" : "mt-3"}`}
                      style={{ "--hy-q-em": questionEm(phase === "COUNTDOWN" ? practice.text : prompt) } as React.CSSProperties}
                      aria-live="polite"
                    >
                      {phase === "COUNTDOWN" ? (
                        <span aria-label={`Practice question: ${practice.text}`}>
                          {practice.text}
                        </span>
                      ) : (
                        <span
                          key={passNow?.question ? `pass-${passNow.seq}` : "question"}
                          className={passNow?.question ? "hy-pass-in" : undefined}
                          style={passNow?.question ? ({ "--hy-pass-from": `${24 * passNow.from}px` } as React.CSSProperties) : undefined}
                        >
                          {prompt}
                        </span>
                      )}
                    </p>
                    <div className={`relative ${cardRow ? "w-24 shrink-0" : "mt-2"}`}>
                      <AnswerBox key={wrongSeq} value={shown} placeholder={passLocked ? "Wait" : keypad ? "Answer" : "Type"} state={wrongSeq ? "wrong" : null} compact={cardRow} />
                      {/* After a pass: empties while input waits. */}
                      {passLocked && (
                        <span key={passNow!.seq} aria-hidden className="hy-pass-lock absolute left-3 right-3 bottom-1.5 h-1 rounded-full bg-primary" style={{ animationDuration: `${SKIP_LOCK_MS}ms` }} />
                      )}
                    </div>
                  </div>
                )}
                {beforeRace && (
                  <p className="relative text-xs text-center text-muted">
                    {keypad ? "In the race you type the answers on the screen keys." : "In the race you type the answers on your keyboard."} {passHint}
                  </p>
                )}
                {/* One quiet line: the warm-up's own feedback, the pass hint on a first race's first questions (only the
                    hint on the compact card). */}
                {/* Kept (empty) outside the race on the stacked card, so the card's height doesn't change when it starts. */}
                {stage === "GAME" && (racing ? !cardRow || showPassHint : !cardRow) && (
                  <p className={`relative mt-1.5 min-h-4 text-center text-xs text-muted ${cardRow ? "truncate" : ""}`}>
                    {!racing ? null : cardRow ? (
                      !myFinished && passHint
                    ) : phase === "COUNTDOWN" ? (
                      <>
                        {fb ? (
                          <span key={fb.n} className={`font-semibold ${fb.ok ? "text-success-text" : "text-danger"}`} role="status">
                            {fb.ok ? "Correct! (practice)" : "Wrong, try again (practice)"}
                          </span>
                        ) : (
                          "Practice question, no points"
                        )}
                        {showPassHint && <> · {passHint}</>}
                      </>
                    ) : (
                      showPassHint && !myFinished && passHint
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* Touch screens: the game's own keypad, from the countdown to the end (the same layout all the way). */}
            {showKeypad && (
              <div
                className={
                  twoCol
                    ? `flex-1 ${compact ? "min-h-[178px]" : "min-h-[232px]"} max-h-[520px] flex justify-center`
                    : `flex-[0_1_42%] ${compact ? "min-h-[190px]" : "min-h-[244px]"} max-h-[340px] px-3 pb-3 flex justify-center`
                }
              >
                <div className="w-full max-w-[420px] h-full">
                  <Keypad onKey={pressKey} disabled={!keysLive} compact={compact} />
                </div>
              </div>
            )}
          </div>
        </div>

        {stage === "GAME" && finished?.results?.mine && (
          <ResultsDialog
            key={finished.raceId}
            order={finished.results.order.map((id) => finished.racers.find((r) => r.id === id)).filter((r): r is TrackRacer => !!r)}
            mine={finished.results.mine}
            total={finished.questionCount}
            meId={meKey}
            playerView={views(finished)[meKey] ?? player.avatar}
            memberViews={views(finished)}
            celebrate={feedback.effects && finished.results.mine.placing === 1 && finished.results.mine.racerCount > 1}
            record={localRecord === finished.raceId}
            againLabel={finished.kind === "LOBBY" ? "Back to the lobby" : "Play again"}
            menuLabel={finished.kind === "LOBBY" ? "Leave the lobby" : "Back to menu"}
            onAgain={() => {
              setDismissed(finished.raceId);
              if (finished.kind !== "LOBBY") quickAgain();
              else setArmed(false);
            }}
            onMenu={exit}
          />
        )}

        {confirmExit && <ConfirmExit lobby={inLobby} onYes={exit} onNo={keepPlaying} />}
        {howOpen && <HowToPlayDialog passHow={passHow} onClose={() => setHowOpen(false)} />}
      </div>
    </GameLayer>
    </>
  );
}
