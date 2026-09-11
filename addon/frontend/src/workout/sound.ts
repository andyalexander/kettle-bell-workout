/**
 * The optional beeps (issue #3): short at 3-2-1, long on a turn change.
 *
 * Synthesised with Web Audio, so there is nothing to download. iOS keeps an
 * `AudioContext` suspended until a tap resumes it, so call `unlockAudio()` from
 * a tap handler: the workout screen does on every touch, and whatever screen
 * starts a workout should too, or a sound-on profile misses prep's 3-2-1.
 */

import type { Beep } from "./display";

const TONE_HZ = 880;
const LENGTH_SECONDS: Readonly<Record<Beep, number>> = { short: 0.12, long: 0.6 };

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext();
    return context;
  } catch {
    return null;
  }
}

/** Resume audio from inside a tap. Never throws: a workout must not fail over a beep. */
export function unlockAudio(): void {
  void audio()
    ?.resume()
    .catch(() => {});
}

/** Play one beep, or nothing if audio is not yet unlocked. */
export function beep(kind: Beep): void {
  const ctx = audio();
  if (!ctx || ctx.state !== "running") return;

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
