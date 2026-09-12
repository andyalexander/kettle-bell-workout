import { useCallback, useEffect, useRef, useState } from "react";

import { elapsedSeconds } from "./clock";
import type { Hold, Run } from "./pause";
import {
  beginLeadIn,
  hideRun,
  holdOf,
  leadInRemaining,
  pauseRun,
  settleRun,
  startRun,
} from "./pause";
import type { TimerState, WorkoutTiming } from "./schedule";
import { schedule } from "./schedule";
import type { ScreenLock } from "./wakeLock";
import { keepScreenAwake } from "./wakeLock";

/**
 * Drives the pure engine from `requestAnimationFrame`, holds the pause and
 * lead-in, pauses whenever the screen hides and keeps the screen awake.
 *
 * There is no abort here: aborting writes nothing at all (issue #3), so it is
 * the caller simply leaving the screen.
 */
export interface WorkoutTimer {
  readonly state: TimerState;
  readonly hold: Hold;
  /** The lead-in's whole second on display, 3 → 2 → 1, or null outside one. */
  readonly leadIn: number | null;
  /** Freeze the workout; during a lead-in, go back to paused. */
  pause(): void;
  /** Start the lead-in; the workout carries on from the frozen instant as it ends. */
  resume(): void;
}

export function useWorkoutTimer(timing: WorkoutTiming): WorkoutTimer {
  const [initial] = useState(() => startRun(performance.now()));
  const runRef = useRef(initial);

  const readState = useCallback(
    (run: Run, now: number) => schedule(timing, elapsedSeconds(run.clock, now)),
    [timing],
  );

  const [state, setState] = useState<TimerState>(() => readState(initial, performance.now()));
  const [hold, setHold] = useState<Hold>("running");
  const [leadIn, setLeadIn] = useState<number | null>(null);

  // The engine is recomputed every frame, but only a change the human can see
  // is worth a render: the phase, the turn, or the whole second on the display.
  // Each frame also ends a lead-in that has run out.
  const publish = useCallback(() => {
    const now = performance.now();
    const run = settleRun(runRef.current, now);
    runRef.current = run;
    const next = readState(run, now);
    setState((current) =>
      current.phase === next.phase &&
      current.turn === next.turn &&
      Math.ceil(current.secondsRemaining) === Math.ceil(next.secondsRemaining)
        ? current
        : next,
    );
    setHold(holdOf(run));
    const remaining = leadInRemaining(run, now);
    setLeadIn(remaining === null ? null : Math.ceil(remaining));
  }, [readState]);

  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      publish();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [publish]);

  const change = useCallback(
    (step: (run: Run, now: number) => Run) => {
      runRef.current = step(runRef.current, performance.now());
      publish();
    },
    [publish],
  );

  const pause = useCallback(() => change(pauseRun), [change]);
  const resume = useCallback(() => change(beginLeadIn), [change]);

  // Every hide is a pause, frozen at the instant the screen hid (issue #34).
  // Coming back changes nothing: the workout waits on the paused screen.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) change((run, now) => hideRun(run, now, timing));
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [change, timing]);

  // Hold the screen awake for as long as the workout is on screen, and take the
  // lock again after a hide: the native API drops it when the tab is hidden.
  useEffect(() => {
    let lock: ScreenLock | null = null;
    let released = false;

    const acquire = () => {
      void keepScreenAwake().then((held) => {
        if (released) {
          held.release();
          return;
        }
        lock?.release();
        lock = held;
      });
    };

    const reacquire = () => {
      if (!document.hidden) acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", reacquire);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", reacquire);
      lock?.release();
    };
  }, []);

  return { state, hold, leadIn, pause, resume };
}
