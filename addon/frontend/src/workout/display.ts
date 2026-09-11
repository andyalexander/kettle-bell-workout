/**
 * What the live workout screen says and signals at an instant — pure folds over
 * the timer's state and the workout, so every word and cue is under test with
 * no browser and no clock (issue #16). Colour and layout stay in the component.
 */

import type { Activity, Workout } from "../api";
import type { Phase, TimerState } from "../timer/schedule";

/** Above this many activities the pips become slivers, so they give way to text (#4). */
export const MAX_PIPS = 10;

/** How many seconds before a turn change the short beeps count down (#3). */
const COUNTDOWN_BEEPS = 3;

/** The whole second on the display: the clock counts `40 … 1`, never `0` mid-turn. */
const shown = (state: TimerState): number => Math.ceil(state.secondsRemaining);

/** The clock: `40`, or `1:05` from a minute up. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  return minutes > 0 ? `${minutes}:${pad(whole % 60)}` : String(whole);
}

/** A span of time on the summary or the away prompt: always `m:ss`. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${pad(whole % 60)}`;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** The phase named in large type — colour alone is a single point of failure (#3). */
export const PHASE_WORDS: Readonly<Record<Phase, string>> = {
  prep: "Get ready",
  work: "Work",
  rest: "Rest",
  done: "Done",
};

/**
 * `Round 2 of 4 · Exercise 3` — one line, in `CONTEXT.md`'s words (#4). The
 * activity count joins it only when there are too many activities for pips.
 */
export function counterLine(state: TimerState, workout: Workout): string {
  const count = workout.activities.length;
  const ofCount = count > MAX_PIPS ? ` of ${count}` : "";
  return `Round ${state.round} of ${workout.rounds} · Exercise ${state.activityIndex + 1}${ofCount}`;
}

export type Pip = "done" | "now" | "todo";

/** One pip per activity in the round, or null once there are too many to read. */
export function pips(state: TimerState, activityCount: number): Pip[] | null {
  if (activityCount > MAX_PIPS) return null;
  return Array.from({ length: activityCount }, (_, i) => {
    if (i < state.activityIndex) return "done";
    return i === state.activityIndex ? "now" : "todo";
  });
}

/** The activity a turn lands on; workouts cycle through their activities. */
function activityAt(workout: Workout, turn: number): Activity {
  const activity = workout.activities[turn % workout.activities.length];
  if (!activity) throw new RangeError("A workout needs at least one activity");
  return activity;
}

/** The activity of the turn after this one, or null during the last. */
export function nextActivity(state: TimerState, workout: Workout): Activity | null {
  return state.turn + 1 < state.totalTurns ? activityAt(workout, state.turn + 1) : null;
}

/** What the top of the screen announces. */
export interface Headline {
  readonly activity: Activity;
  /** True during rest, when the headline is already the next turn's activity. */
  readonly upcoming: boolean;
}

export function headline(state: TimerState, workout: Workout): Headline {
  const next = nextActivity(state, workout);
  if (state.phase === "rest" && next) return { activity: next, upcoming: true };
  return { activity: activityAt(workout, state.turn), upcoming: false };
}

/** `10 × 16 kg`, or only the weight for a movement with no rep count (ADR-0002). */
export function loadLabel(activity: Activity): string {
  const weight = `${activity.weight} kg`;
  return activity.reps === null ? weight : `${activity.reps} × ${weight}`;
}

// --- cues -------------------------------------------------------------------

export type Flash = "turn" | "finish";
export type Beep = "short" | "long";

/** What the screen and the speaker do as one reading of the timer gives way to the next. */
export interface Cue {
  readonly flash: Flash | null;
  readonly beep: Beep | null;
}

const QUIET: Cue = { flash: null, beep: null };

/**
 * The cue between two consecutive published readings (#3, #4):
 *
 * - a white flash and a long beep on every **turn** boundary, prep → turn 1
 *   included — work → rest already has its colour change, so it gets neither;
 * - the held green **finish** flash, with a long beep, when the last turn ends;
 * - short beeps at 3-2-1 before a turn change.
 *
 * The timer publishes every whole second, so consecutive readings step the
 * display by exactly one. Anything else is the first frame after a hidden
 * stretch, and catching up is silent: no missed flash fires late.
 */
export function cueBetween(prev: TimerState, next: TimerState, restSeconds: number): Cue {
  if (!stepsByOneSecond(prev, next)) return QUIET;
  if (next.phase === "done") return { flash: "finish", beep: "long" };

  const newTurn = prev.phase === "prep" ? next.phase !== "prep" : next.turn !== prev.turn;
  if (newTurn) return { flash: "turn", beep: "long" };

  const countingDown =
    endsOnTurnBoundary(next.phase, restSeconds) && shown(next) <= COUNTDOWN_BEEPS;
  return countingDown ? { flash: null, beep: "short" } : QUIET;
}

/** Within a phase the second ticks down by one; across a seam the last second was 1. */
function stepsByOneSecond(prev: TimerState, next: TimerState): boolean {
  const samePhase = prev.phase === next.phase && prev.turn === next.turn;
  return samePhase ? shown(next) === shown(prev) - 1 : shown(prev) <= 1;
}

/** Whether this phase's last second is followed by a new turn. */
function endsOnTurnBoundary(phase: Phase, restSeconds: number): boolean {
  if (phase === "work") return restSeconds === 0;
  return phase === "prep" || phase === "rest";
}

// --- summary ----------------------------------------------------------------

/** This workout only (#13), so it renders even when recording it has failed. */
export interface WorkoutSummary {
  readonly turns: number;
  /** Turns × work seconds: rest and prep excluded (ADR-0002). */
  readonly underLoadSeconds: number;
  /** Wall time from turn 1 to the last turn's end, pauses included. */
  readonly elapsedSeconds: number;
}

export function summarise(
  workout: Workout,
  startedAt: string,
  endedAt: string,
): WorkoutSummary {
  const turns = workout.activities.length * workout.rounds;
  return {
    turns,
    underLoadSeconds: turns * workout.work_seconds,
    elapsedSeconds: (Date.parse(endedAt) - Date.parse(startedAt)) / 1000,
  };
}
