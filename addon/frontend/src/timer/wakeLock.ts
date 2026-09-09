/**
 * Keeping the iPad awake mid-workout.
 *
 * `navigator.wakeLock` is `[SecureContext]` and the add-on serves plain HTTP on
 * a LAN IP, so on the iPad the API is *absent* rather than flaky (issue #3).
 * We feature-detect it anyway — it lights up for free the day TLS is enabled
 * (#12) — and otherwise fall back to a muted, looping, inline video, the
 * NoSleep.js mechanism. That fallback is undocumented behaviour and may be
 * withdrawn, which is why the one-time Auto-Lock hint below also exists.
 */

// 2x2, one second, silent. Small enough that Vite inlines it as a data URI.
import keepAwakeVideo from "./keep-awake.mp4";

/** Release the screen lock. Safe to call more than once. */
export interface ScreenLock {
  release(): void;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

function nativeWakeLock(): WakeLockLike | null {
  const candidate = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return candidate ?? null;
}

/** True when the platform gives us the real API, i.e. we are a secure context. */
export const hasNativeWakeLock = (): boolean => nativeWakeLock() !== null;

const NOOP_LOCK: ScreenLock = { release: () => {} };

async function requestNativeLock(api: WakeLockLike): Promise<ScreenLock> {
  const sentinel = await api.request("screen");
  return { release: () => void sentinel.release().catch(() => {}) };
}

function playSilentVideo(): ScreenLock {
  const video = document.createElement("video");
  video.src = keepAwakeVideo;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute("aria-hidden", "true");
  // Present enough to play, invisible enough not to disturb the workout screen.
  video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(video);
  void video.play().catch(() => {});
  return {
    release: () => {
      video.pause();
      video.remove();
    },
  };
}

/**
 * Hold the screen awake by whatever means this platform allows. Never rejects:
 * a workout must not fail because the screen might dim.
 */
export async function keepScreenAwake(): Promise<ScreenLock> {
  const api = nativeWakeLock();
  if (api) {
    try {
      return await requestNativeLock(api);
    } catch {
      // Denied or dropped — fall through to the video.
    }
  }
  try {
    return playSilentVideo();
  } catch {
    return NOOP_LOCK;
  }
}

/**
 * Whether the "set Auto-Lock to Never" hint has been dismissed. This is a
 * device fact, not a person fact, so it lives in `localStorage` and not in the
 * schema. Storage throws in some Safari configurations; a hint we cannot
 * remember dismissing is better shown than crashed on.
 */
const AUTO_LOCK_HINT_KEY = "kettlebell.autoLockHintDismissed";

export function shouldShowAutoLockHint(): boolean {
  if (hasNativeWakeLock()) return false;
  try {
    return window.localStorage.getItem(AUTO_LOCK_HINT_KEY) !== "true";
  } catch {
    return true;
  }
}

export function dismissAutoLockHint(): void {
  try {
    window.localStorage.setItem(AUTO_LOCK_HINT_KEY, "true");
  } catch {
    // Nothing to do — the hint simply appears again next time.
  }
}
