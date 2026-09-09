import { describe, expect, it } from "vitest";

import { PREP_SECONDS, schedule, totalTurns, turnSeconds } from "./schedule";
import type { Prescription } from "./schedule";

/** 5 slots x 4 rounds of 40 work / 20 rest: 20 turns of 60s, 1200s of session. */
const intervals: Prescription = {
  slotCount: 5,
  rounds: 4,
  workSeconds: 40,
  restSeconds: 20,
};

/** The hard case: a rest-less EMOM, where every turn is a work phase. */
const emom: Prescription = { slotCount: 3, rounds: 2, workSeconds: 60, restSeconds: 0 };

/** Elapsed seconds at the start of turn `n` (zero-based), prep included. */
const atTurn = (p: Prescription, n: number) => PREP_SECONDS + n * turnSeconds(p);

describe("shape", () => {
  it("counts a turn per slot per round", () => {
    expect(totalTurns(intervals)).toBe(20);
    expect(totalTurns(emom)).toBe(6);
  });

  it("makes a turn work plus rest", () => {
    expect(turnSeconds(intervals)).toBe(60);
    expect(turnSeconds(emom)).toBe(60);
  });

  it("rejects a prescription that cannot be performed", () => {
    expect(() => schedule({ ...intervals, slotCount: 0 }, 0)).toThrow(RangeError);
    expect(() => schedule({ ...intervals, rounds: 0 }, 0)).toThrow(RangeError);
    expect(() => schedule({ ...intervals, workSeconds: 0 }, 0)).toThrow(RangeError);
    expect(() => schedule({ ...intervals, restSeconds: -1 }, 0)).toThrow(RangeError);
    expect(() => schedule({ ...intervals, workSeconds: 40.5 }, 0)).toThrow(RangeError);
  });
});

describe("prep", () => {
  it("counts ten seconds in before turn 1", () => {
    expect(schedule(intervals, 0)).toMatchObject({ phase: "prep", secondsRemaining: 10 });
    expect(schedule(intervals, 9.5)).toMatchObject({ phase: "prep", secondsRemaining: 0.5 });
  });

  it("shows the first turn's slot, because prep announces what is coming", () => {
    expect(schedule(intervals, 0)).toMatchObject({ turn: 0, round: 1, slotIndex: 0 });
  });

  it("treats a clock reading before the start as prep, not as an error", () => {
    expect(schedule(intervals, -3)).toMatchObject({ phase: "prep", secondsRemaining: 10 });
  });
});

describe("turns", () => {
  it("starts the session on the tick prep ends", () => {
    expect(schedule(intervals, PREP_SECONDS)).toMatchObject({
      phase: "work",
      turn: 0,
      secondsRemaining: 40,
    });
  });

  it("flips to rest when the work seconds are spent", () => {
    expect(schedule(intervals, PREP_SECONDS + 39.9)).toMatchObject({ phase: "work" });
    expect(schedule(intervals, PREP_SECONDS + 40)).toMatchObject({
      phase: "rest",
      secondsRemaining: 20,
      turn: 0,
    });
    expect(schedule(intervals, PREP_SECONDS + 59.9)).toMatchObject({
      phase: "rest",
      turn: 0,
    });
  });

  it("runs turns back to back, with no transition phase", () => {
    expect(schedule(intervals, atTurn(intervals, 1))).toMatchObject({
      phase: "work",
      turn: 1,
      secondsRemaining: 40,
    });
  });

  it("never rests when rest is zero, and still marks every turn", () => {
    expect(schedule(emom, atTurn(emom, 0) + 59.9)).toMatchObject({ phase: "work", turn: 0 });
    expect(schedule(emom, atTurn(emom, 1))).toMatchObject({
      phase: "work",
      turn: 1,
      secondsRemaining: 60,
    });
  });

  it("reports the round and the position within it, not just a flat index", () => {
    expect(schedule(intervals, atTurn(intervals, 4))).toMatchObject({ round: 1, slotIndex: 4 });
    expect(schedule(intervals, atTurn(intervals, 5))).toMatchObject({ round: 2, slotIndex: 0 });
    expect(schedule(intervals, atTurn(intervals, 19))).toMatchObject({ round: 4, slotIndex: 4 });
  });

  it("is a pure function of elapsed, so any reading lands in the same place", () => {
    const mid = atTurn(intervals, 7) + 12.5;
    expect(schedule(intervals, mid)).toEqual(schedule(intervals, mid));
  });
});

describe("done", () => {
  it("ends the moment the last turn is spent", () => {
    const end = atTurn(intervals, totalTurns(intervals));
    expect(schedule(intervals, end - 0.1)).toMatchObject({ phase: "rest", turn: 19 });
    expect(schedule(intervals, end)).toMatchObject({
      phase: "done",
      turn: 20,
      secondsRemaining: 0,
    });
  });

  it("stays done however long the summary is left on screen", () => {
    expect(schedule(intervals, 99_999)).toMatchObject({ phase: "done", secondsRemaining: 0 });
  });
});
