/**
 * Pausing, and the lead-in back out of it (issue #34) — pure, like `clock.ts`.
 *
 * A pause freezes the clock, whether the pause button or the screen hiding
 * caused it: a turn nobody can see must not advance. Resuming is never
 * immediate. A 3-second lead-in counts down with the clock still frozen, and
 * the clock restarts at the lead-in's end, so the lead-in, like prep, sits
 * outside the workout.
 */

import type { Clock } from "./clock";
import { elapsedSeconds, pauseClock, resumeClock, startClock } from "./clock";
import type { WorkoutTiming } from "./schedule";
import { schedule } from "./schedule";

/** Time to get back to the bell after tapping Resume. */
export const LEAD_IN_SECONDS = 3;

/** A workout's clock, and the lead-in counting down to restart it, if any. */
export interface Run {
  readonly clock: Clock;
  /** The reading at which Resume was tapped, while a lead-in counts down. */
  readonly leadInFrom: number | null;
}

/** What the screen shows: the workout, the paused screen, or the lead-in. */
export type Hold = "running" | "paused" | "lead-in";

/** Begin timing. `now` is a `performance.now()` reading. */
export function startRun(now: number): Run {
  return { clock: startClock(now), leadInFrom: null };
}

export function holdOf(run: Run): Hold {
  if (run.leadInFrom !== null) return "lead-in";
  return run.clock.pausedAt === null ? "running" : "paused";
}

/** Pause at `at`. A pause during a lead-in cancels it: the workout stays paused. */
export function pauseRun(run: Run, at: number): Run {
  return { clock: pauseClock(run.clock, at), leadInFrom: null };
}

/**
 * The screen hid at `at`. Every hide is a pause, frozen at that instant, with no
 * grace period and no catch-up — except once the workout is over, when there is
 * nothing left to freeze and the summary must stay up.
 */
export function hideRun(run: Run, at: number, timing: WorkoutTiming): Run {
  const settled = settleRun(run, at);
  const finished = schedule(timing, elapsedSeconds(settled.clock, at)).phase === "done";
  return finished ? settled : pauseRun(settled, at);
}

/** Resume tapped at `at`: start the lead-in. Only a paused run, and only once. */
export function beginLeadIn(run: Run, at: number): Run {
  if (holdOf(run) !== "paused") return run;
  return { ...run, leadInFrom: at };
}

/** Seconds left of the lead-in at `now`, or null when there is none. */
export function leadInRemaining(run: Run, now: number): number | null {
  if (run.leadInFrom === null) return null;
  return Math.max(0, LEAD_IN_SECONDS - (now - run.leadInFrom) / 1000);
}

/**
 * End a lead-in that has run out by `now`. The clock restarts at the lead-in's
 * end, not at whichever frame noticed, so a late frame costs the workout nothing.
 */
export function settleRun(run: Run, now: number): Run {
  if (run.leadInFrom === null) return run;
  const end = run.leadInFrom + LEAD_IN_SECONDS * 1000;
  if (now < end) return run;
  return { clock: resumeClock(run.clock, end), leadInFrom: null };
}
