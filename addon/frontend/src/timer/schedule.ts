/**
 * The workout timer engine: a pure function of elapsed time.
 *
 * Nothing accumulates and there are no ticks to miss — the caller reads a
 * monotonic clock and asks what the workout looks like at that instant. A
 * throttled or backgrounded tab therefore cannot drift; its answer is only
 * stale, and the first frame after returning is correct again. See issue #3.
 */

/**
 * Fixed countdown before turn 1. It sits *outside* the session, so a session's
 * recorded duration is never inflated by standing around before starting.
 */
export const PREP_SECONDS = 10;

/** Prep counts in; work and rest make up a turn; done is the summary. */
export type Phase = "prep" | "work" | "rest" | "done";

/** The timing shape a session runs to, frozen at workout start. */
export interface Prescription {
  /** Slots in one round. */
  readonly slotCount: number;
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
  /** Zero-based position within the round — which slot is being performed. */
  readonly slotIndex: number;
  /** Seconds left in the current phase; zero once done. */
  readonly secondsRemaining: number;
  readonly totalTurns: number;
  readonly turnSeconds: number;
}

/** One turn per slot per round. A routine of 5 slots x 4 rounds is 20 turns. */
export function totalTurns(prescription: Prescription): number {
  return prescription.slotCount * prescription.rounds;
}

/** A turn is work plus rest, whichever mode the builder used to enter it. */
export function turnSeconds(prescription: Prescription): number {
  return prescription.workSeconds + prescription.restSeconds;
}

function assertPerformable(prescription: Prescription): void {
  const { slotCount, rounds, workSeconds, restSeconds } = prescription;
  const positive = (n: number) => Number.isInteger(n) && n > 0;
  if (!positive(slotCount) || !positive(rounds) || !positive(workSeconds)) {
    throw new RangeError(
      "A prescription needs a positive whole slotCount, rounds and workSeconds",
    );
  }
  if (!Number.isInteger(restSeconds) || restSeconds < 0) {
    throw new RangeError("restSeconds must be a whole number of seconds, zero or more");
  }
}

/**
 * Resolve a prescription and an elapsed time into the state of the workout.
 *
 * `elapsedSeconds` is time spent in the workout with pauses already discounted
 * (see `clock.ts`); readings before zero are treated as the start of prep.
 */
export function schedule(prescription: Prescription, elapsedSeconds: number): TimerState {
  assertPerformable(prescription);

  const total = totalTurns(prescription);
  const length = turnSeconds(prescription);
  const elapsed = Math.max(0, elapsedSeconds);

  if (elapsed < PREP_SECONDS) {
    // Prep announces the first slot, so it reports turn 1's position.
    return {
      phase: "prep",
      turn: 0,
      round: 1,
      slotIndex: 0,
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
      round: prescription.rounds,
      slotIndex: prescription.slotCount - 1,
      secondsRemaining: 0,
      totalTurns: total,
      turnSeconds: length,
    };
  }

  const within = sinceStart - turn * length;
  const working = within < prescription.workSeconds;
  return {
    phase: working ? "work" : "rest",
    turn,
    round: Math.floor(turn / prescription.slotCount) + 1,
    slotIndex: turn % prescription.slotCount,
    secondsRemaining: working ? prescription.workSeconds - within : length - within,
    totalTurns: total,
    turnSeconds: length,
  };
}
