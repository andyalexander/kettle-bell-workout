/**
 * The optional beeps (issue #3): short at 3-2-1, long on a turn change.
 *
 * Synthesised with Web Audio, so there is nothing to download. iOS starts an
 * `AudioContext` suspended and only a tap may resume it, so call `unlockAudio()`
 * from a click: the Start tap does, and so does every tap on the workout screen.
 *
 * A hide breaks the context for good on iOS (issue #33): it goes on saying
 * `running` while its clock stands still, and `resume()` can't help. So every
 * hide marks it stale, and the next tap replaces it — Resume at the latest,
 * since every hide ends on the Paused screen.
 */

import type { Beep } from "./display";

const TONE_HZ = 880;
const LENGTH_SECONDS: Readonly<Record<Beep, number>> = { short: 0.12, long: 0.6 };

/** What the stale rule needs of an `AudioContext`, so a fake can stand in for one. */
export interface Context {
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface Audio<C extends Context> {
  /** From inside a tap: replace a stale or non-running context, and resume it. */
  unlock(): void;
  /** The screen hid, so the context's clock can't be trusted, whatever it says. */
  hide(): void;
  /** The context a beep can be heard on, or null. */
  playable(): C | null;
}

/** The stale rule, over whatever `make` builds. Never throws. */
export function createAudio<C extends Context>(make: () => C): Audio<C> {
  let context: C | null = null;
  let stale = false;

  const playable = () => (context && !stale && context.state === "running" ? context : null);

  return {
    unlock() {
      if (playable()) return;
      retire(context);
      context = attempt(make);
      stale = false;
      void context?.resume().catch(() => {});
    },
    hide() {
      stale = true;
    },
    playable,
  };
}

function retire(context: Context | null): void {
  try {
    void context?.close().catch(() => {});
  } catch {
    // Already closed, or never worked: either way it's gone.
  }
}

function attempt<C>(make: () => C): C | null {
  try {
    return make();
  } catch {
    return null;
  }
}

const audio = createAudio(() => new AudioContext());

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) audio.hide();
  });
}

/** Make audio playable, from inside a tap. Never throws: a workout must not fail over a beep. */
export function unlockAudio(): void {
  audio.unlock();
}

/** Play one beep, or nothing if it couldn't be heard. */
export function beep(kind: Beep): void {
  const ctx = audio.playable();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime;
  const end = start + LENGTH_SECONDS[kind];

  oscillator.frequency.value = TONE_HZ;
  gain.gain.setValueAtTime(0.4, start);
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(end);
}
