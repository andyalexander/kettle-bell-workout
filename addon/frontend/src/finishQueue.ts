/**
 * The pending-finish queue: a finished workout is saved before it is sent, and
 * sent until the server confirms it (ADR-0003).
 *
 * This is the pure core. Storage and the network are handed in, so it runs in
 * a test with no browser, no clock and no fetch; the retry timer and the
 * launch-time flush are thin drivers in `api.ts`.
 */

import type { FinishedWorkout } from "./api";

/** The part of `localStorage` the queue uses. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/** Send one finish; resolves once the server has it, rejects otherwise. */
export type Send = (finish: FinishedWorkout) => Promise<void>;

/**
 * What the summary shows. `saving` is the first attempt, still in flight with
 * nothing failed yet — so a healthy finish never flashes `retrying`.
 */
export type FinishStatus = "saved" | "saving" | "retrying";

export interface FinishQueue {
  /** Save a finish, then try to send it. Never rejects: a failure is a status. */
  enqueue(finish: FinishedWorkout): Promise<void>;
  /** Try to send everything still pending. Joins an attempt already running. */
  flush(): Promise<void>;
  status(): FinishStatus;
  /** Hear each change of status; returns the unsubscribe — `useSyncExternalStore`'s shape. */
  subscribe(listener: () => void): () => void;
}

const STORAGE_KEY = "kettlebell.pendingFinishes";

/** The server's own key for a workout: who, and when they started (ADR-0003). */
const sameWorkout = (a: FinishedWorkout, b: FinishedWorkout): boolean =>
  a.profile_id === b.profile_id && a.started_at === b.started_at;

export function createFinishQueue(storage: KeyValueStore, send: Send): FinishQueue {
  const read = (): FinishedWorkout[] =>
    JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]") as FinishedWorkout[];
  const write = (pending: readonly FinishedWorkout[]) =>
    storage.setItem(STORAGE_KEY, JSON.stringify(pending));

  const listeners = new Set<() => void>();
  /** Whether an attempt has failed since the queue was last empty. */
  let failed = false;
  let running: Promise<void> | null = null;
  let announced = status();

  function status(): FinishStatus {
    if (read().length === 0) return "saved";
    return failed ? "retrying" : "saving";
  }

  function announce(): void {
    const now = status();
    if (now === announced) return;
    announced = now;
    listeners.forEach((listener) => listener());
  }

  function flush(): Promise<void> {
    // The retry timer may fire while a send still waits on the Pi; join it.
    running ??= sendAll().finally(() => {
      running = null;
    });
    return running;
  }

  async function sendAll(): Promise<void> {
    for (const finish of read()) {
      try {
        await send(finish);
      } catch {
        // Still saved, so the next flush tries again; the status says so.
        failed = true;
        announce();
        continue;
      }
      // Re-read: another finish may have been saved while this one was in flight.
      const remaining = read().filter((pending) => !sameWorkout(pending, finish));
      write(remaining);
      if (remaining.length === 0) failed = false;
      announce();
    }
  }

  return {
    enqueue(finish) {
      write([...read(), finish]);
      announce();
      return flush();
    },
    flush,
    status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
