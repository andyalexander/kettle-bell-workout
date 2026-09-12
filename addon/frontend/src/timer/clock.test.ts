import { describe, expect, it } from "vitest";

import { elapsedSeconds, pauseClock, resumeClock, startClock } from "./clock";

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
});
