/**
 * The workout timer engine: a pure function of elapsed time.
 *
 * Nothing accumulates and there are no ticks to miss — the caller reads a
 * monotonic clock and asks what the workout looks like at that instant. A
 * throttled or backgrounded tab therefore cannot drift; its answer is only
 * stale, and the first frame after returning is correct again. See issue #3.
 */

/**
 * Fixed countdown before turn 1. It sits *outside* the workout, so a workout's
 * recorded duration is never inflated by standing around before starting.
 */
export const PREP_SECONDS = 10;

/** Prep counts in; work and rest make up a turn; done is the summary. */
export type Phase = "prep" | "work" | "rest" | "done";

/** The timing shape a workout runs to, fixed when it starts. */
export interface WorkoutTiming {
  /** Activities in one round. */
  readonly activityCount: number;
  readonly rounds: number;
  /** Seconds of work in a turn. */
  readonly workSeconds: number;
  /** Seconds of rest in a turn. Zero is a classic EMOM — one code path. */
  readonly restSeconds: number;
}

/** Where a workout is at one instant. Everything here is derived, never stored. */
export interface TimerState {
  readonly phase: Phase;
  /** Zero-based index over every turn of the workout; `totalTurns` when done. */
  readonly turn: number;
  /** 1-based round, in CONTEXT.md's vocabulary. */
  readonly round: number;
  /** Zero-based position within the round — which activity is being performed. */
  readonly activityIndex: number;
  /** Seconds left in the current phase; zero once done. */
  readonly secondsRemaining: number;
  readonly totalTurns: number;
  readonly turnSeconds: number;
}

/** One turn per activity per round. 5 activities x 4 rounds is 20 turns. */
export function totalTurns(timing: WorkoutTiming): number {
  return timing.activityCount * timing.rounds;
}

/** A turn is work plus rest, whichever mode the builder used to enter it. */
export function turnSeconds(timing: WorkoutTiming): number {
  return timing.workSeconds + timing.restSeconds;
}

function assertPerformable(timing: WorkoutTiming): void {
  const { activityCount, rounds, workSeconds, restSeconds } = timing;
  const positive = (n: number) => Number.isInteger(n) && n > 0;
  if (!positive(activityCount) || !positive(rounds) || !positive(workSeconds)) {
    throw new RangeError(
      "A workout needs a positive whole activityCount, rounds and workSeconds",
    );
  }
  if (!Number.isInteger(restSeconds) || restSeconds < 0) {
    throw new RangeError("restSeconds must be a whole number of seconds, zero or more");
  }
}

/**
 * Resolve a workout's timing and an elapsed time into the state of the workout.
 *
 * `elapsedSeconds` is time spent in the workout with pauses already discounted
 * (see `clock.ts`); readings before zero are treated as the start of prep.
 */
export function schedule(timing: WorkoutTiming, elapsedSeconds: number): TimerState {
  assertPerformable(timing);

  const total = totalTurns(timing);
  const length = turnSeconds(timing);
  const elapsed = Math.max(0, elapsedSeconds);

  if (elapsed < PREP_SECONDS) {
    // Prep announces the first activity, so it reports turn 1's position.
    return {
      phase: "prep",
      turn: 0,
      round: 1,
      activityIndex: 0,
      secondsRemaining: PREP_SECONDS - elapsed,
      totalTurns: total,
      turnSeconds: length,
    };
  }

  const sinceStart = elapsed - PREP_SECONDS;
  const turn = Math.floor(sinceStart / length);

  if (turn >= total) {
    return {
      phase: "done",
      turn: total,
      round: timing.rounds,
      activityIndex: timing.activityCount - 1,
      secondsRemaining: 0,
      totalTurns: total,
      turnSeconds: length,
    };
  }

  const within = sinceStart - turn * length;
  const working = within < timing.workSeconds;
  return {
    phase: working ? "work" : "rest",
    turn,
    round: Math.floor(turn / timing.activityCount) + 1,
    activityIndex: turn % timing.activityCount,
    secondsRemaining: working ? timing.workSeconds - within : length - within,
    totalTurns: total,
    turnSeconds: length,
  };
}
