import { describe, expect, it } from "vitest";

import type { FinishedWorkout } from "./api";
import type { FinishStatus, KeyValueStore } from "./finishQueue";
import { createFinishQueue } from "./finishQueue";

/** Stands in for `localStorage`, which a relaunch keeps and a test can share. */
function memoryStorage(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

/** A send that never answers — the Pi is unreachable, or the tab is killed. */
const neverAnswers = () => new Promise<void>(() => {});

const finish: FinishedWorkout = {
  profile_id: 1,
  started_at: "2026-09-09T07:00:00.000Z",
  ended_at: "2026-09-09T07:08:10.250Z",
  routine_id: 1,
  routine_name: "Monday",
  rounds: 4,
  work_seconds: 60,
  rest_seconds: 0,
  activities: [
    { position: 0, exercise_id: 1, exercise_name: "Two-hand swing", reps: 10, weight: 24 },
  ],
};

describe("a pending finish", () => {
  it("survives a relaunch until the server confirms it", async () => {
    const storage = memoryStorage();
    void createFinishQueue(storage, neverAnswers).enqueue(finish);

    const sent: FinishedWorkout[] = [];
    const relaunched = createFinishQueue(storage, async (pending) => {
      sent.push(pending);
    });
    await relaunched.flush();

    expect(sent).toEqual([finish]);
  });

  it("is sent once, and never again after the server confirms it", async () => {
    const storage = memoryStorage();
    const sent: FinishedWorkout[] = [];
    const record = async (pending: FinishedWorkout) => {
      sent.push(pending);
    };

    const queue = createFinishQueue(storage, record);
    await queue.enqueue(finish);
    await queue.flush();
    await createFinishQueue(storage, record).flush();

    expect(sent).toEqual([finish]);
  });
});

describe("the status the summary shows", () => {
  it("reads retrying while the server is unreachable, and saved once it answers", async () => {
    let reachable = false;
    const queue = createFinishQueue(memoryStorage(), async () => {
      if (!reachable) throw new Error("the Pi is unreachable");
    });

    await queue.enqueue(finish);
    expect(queue.status()).toBe("retrying");

    reachable = true;
    await queue.flush();
    expect(queue.status()).toBe("saved");
  });

  it("reads saving while the first attempt is in flight, before anything has failed", () => {
    const queue = createFinishQueue(memoryStorage(), neverAnswers);

    void queue.enqueue(finish);

    expect(queue.status()).toBe("saving");
  });

  it("tells subscribers each time it changes", async () => {
    let reachable = false;
    const queue = createFinishQueue(memoryStorage(), async () => {
      if (!reachable) throw new Error("the Pi is unreachable");
    });
    const seen: FinishStatus[] = [];
    queue.subscribe(() => seen.push(queue.status()));

    await queue.enqueue(finish);
    reachable = true;
    await queue.flush();

    expect(seen).toEqual(["saving", "retrying", "saved"]);
  });
});

describe("retrying", () => {
  it("does not send a finish twice when flushed again while it is in flight", async () => {
    const sent: FinishedWorkout[] = [];
    const answers: Array<() => void> = [];
    const queue = createFinishQueue(memoryStorage(), (pending) => {
      sent.push(pending);
      return new Promise<void>((resolve) => answers.push(resolve));
    });

    const first = queue.enqueue(finish);
    // The retry timer fires while the first attempt is still waiting on the Pi.
    const second = queue.flush();
    answers.forEach((answer) => answer());
    await Promise.all([first, second]);

    expect(sent).toEqual([finish]);
  });
});
