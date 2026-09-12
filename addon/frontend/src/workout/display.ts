/**
 * What the live workout screen says and signals at an instant — pure folds over
 * the timer's state and the workout, so every word and cue is under test with
 * no browser and no clock (issue #16). Colour and layout stay in the component.
 */

import type { Activity, Workout } from "../api";
import type { Phase, TimerState } from "../timer/schedule";

/** Above this many activities the pips become slivers, so they give way to text (#4). */
export const MAX_PIPS = 10;

/** The whole second on the display: the clock counts `40 … 1`, never `0` mid-turn. */
const shown = (state: TimerState): number => Math.ceil(state.secondsRemaining);

/** The clock: `40`, or `1:05` from a minute up. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  return minutes > 0 ? `${minutes}:${pad(whole % 60)}` : String(whole);
}

/** A span of time on the summary: always `m:ss`. */
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

/**
 * The flash between two consecutive published readings (#3, #4). The app is
 * silent, so this is every signal the workout gives beyond its colour:
 *
 * - a white flash on every **turn** boundary, prep → turn 1 included — work →
 *   rest already has its colour change, so it gets none;
 * - the held green **finish** flash when the last turn ends.
 *
 * The timer publishes every whole second, so consecutive readings step the
 * display by exactly one. Since every hide is a pause (#34), a workout no
 * longer jumps; if a reading ever does, it stays dark rather than flash late.
 */
export function flashBetween(prev: TimerState, next: TimerState): Flash | null {
  if (!stepsByOneSecond(prev, next)) return null;
  if (next.phase === "done") return "finish";

  const newTurn = prev.phase === "prep" ? next.phase !== "prep" : next.turn !== prev.turn;
  return newTurn ? "turn" : null;
}

/** Within a phase the second ticks down by one; across a seam the last second was 1. */
function stepsByOneSecond(prev: TimerState, next: TimerState): boolean {
  const samePhase = prev.phase === next.phase && prev.turn === next.turn;
  return samePhase ? shown(next) === shown(prev) - 1 : shown(prev) <= 1;
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
