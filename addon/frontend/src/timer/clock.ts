/**
 * Pause-aware elapsed time for a workout.
 *
 * Every function takes the clock reading explicitly, so the engine is testable
 * with no browser, no clock and no fakes. Readings are milliseconds from a
 * monotonic source — `performance.now()`, never `Date.now()`, so an NTP
 * correction or a DST change mid-workout cannot move a workout (issue #3).
 */

export interface Clock {
  readonly startedAt: number;
  readonly pausedTotalMs: number;
  /** The reading at which the clock was paused, or null while running. */
  readonly pausedAt: number | null;
}

/** Begin timing. `now` is a `performance.now()` reading. */
export function startClock(now: number): Clock {
  return { startedAt: now, pausedTotalMs: 0, pausedAt: null };
}

/** Freeze the clock as of `at`. A pause while already paused changes nothing. */
export function pauseClock(clock: Clock, at: number): Clock {
  if (clock.pausedAt !== null) return clock;
  return { ...clock, pausedAt: at };
}

/** Resume, discounting the paused stretch. A resume while running does nothing. */
export function resumeClock(clock: Clock, at: number): Clock {
  if (clock.pausedAt === null) return clock;
  return {
    startedAt: clock.startedAt,
    pausedTotalMs: clock.pausedTotalMs + (at - clock.pausedAt),
    pausedAt: null,
  };
}

/** Workout time so far: `now - start - total_paused`. */
export function elapsedSeconds(clock: Clock, now: number): number {
  const reading = clock.pausedAt ?? now;
  return (reading - clock.startedAt - clock.pausedTotalMs) / 1000;
}
