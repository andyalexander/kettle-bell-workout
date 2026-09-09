import { useCallback, useEffect, useRef, useState } from "react";

import type { Clock } from "./clock";
import { elapsedSeconds, pauseClock, resumeClock, startClock, verdictOnReturn } from "./clock";
import type { Prescription, TimerState } from "./schedule";
import { schedule } from "./schedule";
import type { ScreenLock } from "./wakeLock";
import { keepScreenAwake } from "./wakeLock";

/**
 * Drives the pure engine from `requestAnimationFrame`, holds the pause state,
 * applies the backgrounding threshold rule and keeps the screen awake.
 *
 * There is no abort here: aborting writes nothing at all (issue #3), so it is
 * the caller simply leaving the screen.
 */
export interface WorkoutTimer {
  readonly state: TimerState;
  readonly paused: boolean;
  /**
   * Seconds the tab was hidden for, when that was a whole turn or more. The
   * workout is frozen at the moment it hid and the screen must ask before
   * going on: "Away for 4:12 — Resume here, or Abort."
   */
  readonly awaySeconds: number | null;
  pause(): void;
  /** Resume, discounting the paused or hidden stretch. */
  resume(): void;
}

export function useWorkoutTimer(prescription: Prescription): WorkoutTimer {
  const clockRef = useRef<Clock | null>(null);
  clockRef.current ??= startClock(performance.now());

  const readState = useCallback(
    () => schedule(prescription, elapsedSeconds(clockRef.current as Clock, performance.now())),
    [prescription],
  );

  const [state, setState] = useState<TimerState>(readState);
  const [paused, setPaused] = useState(false);
  const [awaySeconds, setAwaySeconds] = useState<number | null>(null);

  // The engine is recomputed every frame, but only a change the human can see
  // is worth a render: the phase, the turn, or the whole second on the display.
  const publish = useCallback(() => {
    const next = readState();
    setState((current) =>
      current.phase === next.phase &&
      current.turn === next.turn &&
      Math.ceil(current.secondsRemaining) === Math.ceil(next.secondsRemaining)
        ? current
        : next,
    );
  }, [readState]);

  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      publish();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [publish]);

  const pause = useCallback(() => {
    clockRef.current = pauseClock(clockRef.current as Clock, performance.now());
    setPaused(true);
    publish();
  }, [publish]);

  const resume = useCallback(() => {
    clockRef.current = resumeClock(clockRef.current as Clock, performance.now());
    setPaused(false);
    setAwaySeconds(null);
    publish();
  }, [publish]);

  // Backgrounding: freeze at the moment the tab hid, not at the moment it came
  // back, so a long absence cannot be counted as work.
  useEffect(() => {
    let hiddenAt: number | null = null;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = performance.now();
        return;
      }
      if (hiddenAt === null) return;
      const away = (performance.now() - hiddenAt) / 1000;
      const current = readState();
      const verdict = verdictOnReturn(away, current.turnSeconds);
      if (verdict.kind === "freeze" && current.phase !== "done") {
        clockRef.current = pauseClock(clockRef.current as Clock, hiddenAt);
        setPaused(true);
        setAwaySeconds(verdict.awaySeconds);
      }
      hiddenAt = null;
      publish();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [publish, readState]);

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

  return { state, paused, awaySeconds, pause, resume };
}
