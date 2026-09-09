import { describe, expect, it } from "vitest";

import { elapsedSeconds, pauseClock, resumeClock, startClock, verdictOnReturn } from "./clock";

describe("elapsed", () => {
  it("measures from the start reading", () => {
    const clock = startClock(1_000);
    expect(elapsedSeconds(clock, 1_000)).toBe(0);
    expect(elapsedSeconds(clock, 8_500)).toBe(7.5);
  });

  it("does not care what the reading's origin is, only that it is monotonic", () => {
    expect(elapsedSeconds(startClock(0), 5_000)).toBe(5);
    expect(elapsedSeconds(startClock(1e9), 1e9 + 5_000)).toBe(5);
  });
});

describe("pause and resume", () => {
  it("freezes elapsed while paused", () => {
    const paused = pauseClock(startClock(0), 30_000);
    expect(elapsedSeconds(paused, 30_000)).toBe(30);
    expect(elapsedSeconds(paused, 90_000)).toBe(30);
  });

  it("discounts the paused time once resumed", () => {
    const clock = resumeClock(pauseClock(startClock(0), 30_000), 90_000);
    expect(elapsedSeconds(clock, 90_000)).toBe(30);
    expect(elapsedSeconds(clock, 100_000)).toBe(40);
  });

  it("accumulates across several pauses", () => {
    let clock = resumeClock(pauseClock(startClock(0), 10_000), 20_000);
    clock = resumeClock(pauseClock(clock, 25_000), 45_000);
    expect(elapsedSeconds(clock, 45_000)).toBe(15);
  });

  it("ignores a redundant pause or resume rather than corrupting the total", () => {
    const paused = pauseClock(startClock(0), 10_000);
    expect(pauseClock(paused, 20_000)).toEqual(paused);
    const running = startClock(0);
    expect(resumeClock(running, 20_000)).toEqual(running);
  });

  it("can be paused retroactively, which is how backgrounding is handled", () => {
    // The tab hid at 30s and came back at 90s; the workout froze when it hid.
    const clock = resumeClock(pauseClock(startClock(0), 30_000), 90_000);
    expect(elapsedSeconds(clock, 90_000)).toBe(30);
  });
});

describe("returning from a hidden tab", () => {
  it("catches up silently when away for less than one turn", () => {
    expect(verdictOnReturn(0.5, 60)).toEqual({ kind: "catch-up" });
    expect(verdictOnReturn(59.9, 60)).toEqual({ kind: "catch-up" });
  });

  it("freezes and asks when away for a whole turn or more", () => {
    expect(verdictOnReturn(60, 60)).toEqual({ kind: "freeze", awaySeconds: 60 });
    expect(verdictOnReturn(252, 60)).toEqual({ kind: "freeze", awaySeconds: 252 });
  });
});
