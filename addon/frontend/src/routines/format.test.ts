import { describe, expect, it } from "vitest";

import type { RoutineSummary } from "../api";
import { formatMinutes, routineLine } from "./format";

const starter: RoutineSummary = {
  id: 1,
  name: "Starter circuit",
  rounds: 3,
  work_seconds: 40,
  rest_seconds: 20,
  total_seconds: 900,
  exercise_names: ["Thruster", "Single-arm row", "Farmer's carry", "Halo", "Two-hand swing"],
};

describe("routineLine", () => {
  it("reads as the sketch in #19", () => {
    expect(routineLine(starter)).toBe("3 rounds × 5 · 40/20 · 15 min");
  });

  it("says round, not rounds, for one", () => {
    expect(routineLine({ ...starter, rounds: 1, total_seconds: 300 })).toBe(
      "1 round × 5 · 40/20 · 5 min",
    );
  });

  it("keeps a rest-less EMOM's zero, so every routine reads the same way", () => {
    expect(
      routineLine({ ...starter, work_seconds: 60, rest_seconds: 0, total_seconds: 900 }),
    ).toBe("3 rounds × 5 · 60/0 · 15 min");
  });
});

describe("formatMinutes", () => {
  it("drops the seconds on a whole minute", () => {
    expect(formatMinutes(900)).toBe("15 min");
  });

  it("keeps the seconds rather than round a length away", () => {
    expect(formatMinutes(450)).toBe("7 min 30 s");
  });

  it("gives seconds alone under a minute", () => {
    expect(formatMinutes(45)).toBe("45 s");
  });
});
