import { describe, expect, it } from "vitest";

import type { Activity, Workout } from "../api";
import { toTiming } from "../api";
import { PREP_SECONDS, schedule, turnSeconds } from "../timer/schedule";
import type { TimerState } from "../timer/schedule";
import {
  MAX_PIPS,
  counterLine,
  flashBetween,
  formatClock,
  formatDuration,
  headline,
  loadLabel,
  nextActivity,
  pips,
  summarise,
} from "./display";

const activity = (position: number, name: string, reps: number | null = 10): Activity => ({
  position,
  exercise_id: position + 1,
  exercise_name: name,
  reps,
  weight: 16,
});

/** Three activities × 2 rounds of 40/20: six turns of 60s. */
const intervals: Workout = {
  routine_id: 1,
  routine_name: "Starter circuit",
  rounds: 2,
  work_seconds: 40,
  rest_seconds: 20,
  activities: [activity(0, "Thruster"), activity(1, "Halo"), activity(2, "Farmer's carry", null)],
};

/** The hard case: a rest-less EMOM, every turn one work phase. */
const emom: Workout = { ...intervals, work_seconds: 60, rest_seconds: 0 };

/** The workout at `elapsed` seconds, prep included. */
const at = (workout: Workout, elapsed: number): TimerState =>
  schedule(toTiming(workout), elapsed);

/** Elapsed seconds at the start of turn `n` (zero-based), prep included. */
const turnStart = (workout: Workout, n: number) =>
  PREP_SECONDS + n * turnSeconds(toTiming(workout));

describe("clock and durations", () => {
  it("shows whole seconds counting down, never zero mid-turn", () => {
    expect(formatClock(40)).toBe("40");
    expect(formatClock(39.2)).toBe("40");
    expect(formatClock(0.01)).toBe("1");
    expect(formatClock(0)).toBe("0");
  });

  it("switches to minutes from a minute up", () => {
    expect(formatClock(60)).toBe("1:00");
    expect(formatClock(64.5)).toBe("1:05");
  });

  it("writes spans of time as m:ss", () => {
    expect(formatDuration(600)).toBe("10:00");
    expect(formatDuration(252)).toBe("4:12");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(-3)).toBe("0:00");
  });
});

describe("what the screen says", () => {
  it("counts rounds and exercises in one line", () => {
    const state = at(intervals, turnStart(intervals, 4));
    expect(counterLine(state, intervals)).toBe("Round 2 of 2 · Exercise 2");
  });

  it("adds the exercise count once pips give way to text", () => {
    const many: Workout = {
      ...intervals,
      activities: Array.from({ length: MAX_PIPS + 2 }, (_, i) => activity(i, `Move ${i}`)),
    };
    const state = at(many, turnStart(many, 7));
    expect(counterLine(state, many)).toBe("Round 1 of 2 · Exercise 8 of 12");
    expect(pips(state, many.activities.length)).toBeNull();
  });

  it("marks the round's pips done, now and to do", () => {
    const state = at(intervals, turnStart(intervals, 4));
    expect(pips(state, 3)).toEqual(["done", "now", "todo"]);
    expect(pips(state, MAX_PIPS)).toHaveLength(MAX_PIPS);
  });

  it("headlines the current activity while working, the next while resting", () => {
    const working = at(intervals, turnStart(intervals, 0) + 5);
    expect(headline(working, intervals)).toEqual({ activity: intervals.activities[0], upcoming: false });

    const resting = at(intervals, turnStart(intervals, 0) + 45);
    expect(headline(resting, intervals)).toEqual({ activity: intervals.activities[1], upcoming: true });
  });

  it("announces the first activity during prep", () => {
    expect(headline(at(intervals, 0), intervals).activity).toBe(intervals.activities[0]);
    expect(nextActivity(at(intervals, 0), intervals)).toBe(intervals.activities[1]);
  });

  it("cycles into the next round and has nothing next on the last turn", () => {
    expect(nextActivity(at(intervals, turnStart(intervals, 2)), intervals)).toBe(
      intervals.activities[0],
    );
    const lastRest = at(intervals, turnStart(intervals, 5) + 45);
    expect(nextActivity(lastRest, intervals)).toBeNull();
    expect(headline(lastRest, intervals)).toEqual({ activity: intervals.activities[2], upcoming: false });
  });

  it("shows reps only for a movement that has them", () => {
    expect(loadLabel(activity(0, "Thruster", 10))).toBe("10 × 16 kg");
    expect(loadLabel(activity(0, "Farmer's carry", null))).toBe("16 kg");
    expect(loadLabel({ ...activity(0, "Halo"), weight: 12.5 })).toBe("10 × 12.5 kg");
  });
});

describe("flashes", () => {
  /** The flash as the display ticks from `from` to `to` seconds elapsed. */
  const flash = (workout: Workout, from: number, to: number) =>
    flashBetween(at(workout, from), at(workout, to));

  it("flashes as prep hands over to turn 1", () => {
    expect(flash(intervals, 9.5, 10)).toBe("turn");
  });

  it("marks work → rest with colour alone", () => {
    const restStarts = turnStart(intervals, 0) + 40;
    expect(flash(intervals, restStarts - 0.5, restStarts)).toBeNull();
  });

  it("flashes every turn boundary of a rest-less EMOM", () => {
    const second = turnStart(emom, 1);
    expect(flash(emom, second - 0.5, second)).toBe("turn");
  });

  it("gives no signal in the seconds before a turn change", () => {
    const next = turnStart(intervals, 1);
    expect(flash(intervals, next - 3.5, next - 2.5)).toBeNull();
    expect(flash(intervals, next - 1.5, next - 0.5)).toBeNull();
    expect(flash(intervals, 6.5, 7.5)).toBeNull();
  });

  it("ends on the held finish flash", () => {
    const end = turnStart(intervals, 6);
    expect(flash(intervals, end - 0.5, end)).toBe("finish");
    expect(flash(intervals, end, end + 5)).toBeNull();
  });

  it("stays dark if the reading ever jumps, rather than flashing late", () => {
    const boundary = turnStart(intervals, 2);
    expect(flash(intervals, boundary - 30, boundary + 5)).toBeNull();
    const end = turnStart(intervals, 6);
    expect(flash(intervals, end - 25, end)).toBeNull();
  });

  it("says nothing when the reading has not moved", () => {
    expect(flash(intervals, 20, 20)).toBeNull();
  });
});

describe("summary", () => {
  it("folds this workout into turns, time under load and elapsed time", () => {
    expect(
      summarise(intervals, "2026-09-11T06:00:00.000Z", "2026-09-11T06:06:30.500Z"),
    ).toEqual({ turns: 6, underLoadSeconds: 240, elapsedSeconds: 390.5 });
  });
});
