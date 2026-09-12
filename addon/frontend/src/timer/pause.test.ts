import { describe, expect, it } from "vitest";

import { elapsedSeconds } from "./clock";
import {
  LEAD_IN_SECONDS,
  beginLeadIn,
  hideRun,
  holdOf,
  leadInRemaining,
  pauseRun,
  settleRun,
  startRun,
} from "./pause";
import type { WorkoutTiming } from "./schedule";

const LEAD_IN_MS = LEAD_IN_SECONDS * 1000;

/** 10s prep, then two 40/20 turns: done at 130s. */
const TIMING: WorkoutTiming = { activityCount: 2, rounds: 1, workSeconds: 40, restSeconds: 20 };

describe("hiding the screen", () => {
  it("pauses at the instant it hid, however briefly", () => {
    const run = hideRun(startRun(0), 30_000, TIMING);
    expect(holdOf(run)).toBe("paused");
    expect(elapsedSeconds(run.clock, 30_500)).toBe(30);
    expect(elapsedSeconds(run.clock, 600_000)).toBe(30);
  });

  it("pauses during prep too", () => {
    expect(holdOf(hideRun(startRun(0), 4_000, TIMING))).toBe("paused");
  });

  it("leaves a finished workout alone, so the summary stays up", () => {
    const run = startRun(0);
    expect(hideRun(run, 130_000, TIMING)).toEqual(run);
  });

  it("cancels a lead-in, back to plain paused at the original instant", () => {
    const leading = beginLeadIn(pauseRun(startRun(0), 30_000), 60_000);
    const run = hideRun(leading, 61_000, TIMING);
    expect(holdOf(run)).toBe("paused");
    expect(leadInRemaining(run, 61_000)).toBeNull();
    expect(elapsedSeconds(run.clock, 61_000)).toBe(30);
  });

  it("pauses a workout whose lead-in ran out before any frame noticed", () => {
    const leading = beginLeadIn(pauseRun(startRun(0), 30_000), 60_000);
    const run = hideRun(leading, 60_000 + LEAD_IN_MS + 500, TIMING);
    expect(holdOf(run)).toBe("paused");
    expect(elapsedSeconds(run.clock, 999_000)).toBe(30.5);
  });
});

describe("the pause button", () => {
  it("is the same pause as a hide", () => {
    expect(pauseRun(startRun(0), 30_000)).toEqual(hideRun(startRun(0), 30_000, TIMING));
  });

  it("during a lead-in goes back to paused", () => {
    const leading = beginLeadIn(pauseRun(startRun(0), 30_000), 60_000);
    expect(holdOf(pauseRun(leading, 61_000))).toBe("paused");
  });
});

describe("the lead-in", () => {
  const paused = pauseRun(startRun(0), 30_000);

  it("starts when Resume is tapped, with the clock still frozen", () => {
    const run = beginLeadIn(paused, 60_000);
    expect(holdOf(run)).toBe("lead-in");
    expect(leadInRemaining(run, 60_000)).toBe(LEAD_IN_SECONDS);
    expect(leadInRemaining(run, 61_500)).toBe(1.5);
    expect(elapsedSeconds(run.clock, 62_000)).toBe(30);
  });

  it("does nothing while running, or restarted mid-count", () => {
    const running = startRun(0);
    expect(beginLeadIn(running, 10_000)).toEqual(running);
    const leading = beginLeadIn(paused, 60_000);
    expect(beginLeadIn(leading, 61_000)).toEqual(leading);
  });

  it("keeps the clock frozen until it runs out", () => {
    const leading = beginLeadIn(paused, 60_000);
    expect(settleRun(leading, 60_000 + LEAD_IN_MS - 1)).toEqual(leading);
  });

  it("restarts the clock at the frozen second when it runs out", () => {
    const run = settleRun(beginLeadIn(paused, 60_000), 60_000 + LEAD_IN_MS);
    expect(holdOf(run)).toBe("running");
    expect(leadInRemaining(run, 60_000 + LEAD_IN_MS)).toBeNull();
    expect(elapsedSeconds(run.clock, 60_000 + LEAD_IN_MS)).toBe(30);
  });

  it("restarts at its own end, not at whichever frame noticed", () => {
    // The first frame after the lead-in lands 0.2s late: the workout has been
    // running for that 0.2s, not starting now.
    const late = 60_000 + LEAD_IN_MS + 200;
    const run = settleRun(beginLeadIn(paused, 60_000), late);
    expect(elapsedSeconds(run.clock, late)).toBeCloseTo(30.2);
  });

  it("leaves a run with no lead-in alone", () => {
    expect(settleRun(paused, 99_000)).toEqual(paused);
    expect(settleRun(startRun(0), 99_000)).toEqual(startRun(0));
  });
});
