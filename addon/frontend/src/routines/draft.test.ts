import { describe, expect, it } from "vitest";

import type { EditableRoutine } from "../api";
import type { Draft } from "./draft";
import {
  addSlot,
  damageLine,
  draftOf,
  moveSlot,
  newDraft,
  problemWith,
  removeSlot,
  saveBody,
  setWeight,
  swapExercise,
} from "./draft";

/** Starter circuit as Andrew edits it: his own 12 kg on the thruster, nothing on the halo. */
const starter: EditableRoutine = {
  id: 1,
  name: "Starter circuit",
  rounds: 3,
  work_seconds: 40,
  rest_seconds: 20,
  slots: [
    { exercise_id: 1, exercise_name: "Thruster", weight: 12 },
    { exercise_id: 4, exercise_name: "Halo", weight: null },
    { exercise_id: 5, exercise_name: "Two-hand swing", weight: 16 },
  ],
};

describe("a routine opened and saved", () => {
  it("sends every slot back from where it was, with my weights", () => {
    expect(saveBody(draftOf(starter))).toEqual({
      name: "Starter circuit",
      rounds: 3,
      work_seconds: 40,
      rest_seconds: 20,
      slots: [
        { exercise_id: 1, origin: 0, weight: 12 },
        { exercise_id: 4, origin: 1, weight: null },
        { exercise_id: 5, origin: 2, weight: 16 },
      ],
    });
  });
});

const sent = (draft: Draft) =>
  saveBody(draft).slots.map(({ exercise_id, origin, weight }) => [exercise_id, origin, weight]);

const clean = { id: 9, name: "Double clean" };

describe("adding an exercise", () => {
  it("goes on the end with no origin and no weight, for anyone", () => {
    expect(sent(addSlot(draftOf(starter), clean)).at(-1)).toEqual([9, null, null]);
  });
});

describe("swapping a slot's exercise", () => {
  it("keeps its origin, so the server sees a swap, and clears my weight", () => {
    expect(sent(swapExercise(draftOf(starter), 0, clean))[0]).toEqual([9, 0, null]);
  });
});

describe("removing a slot", () => {
  it("takes its origin with it, so its weights go too", () => {
    expect(sent(removeSlot(draftOf(starter), 1))).toEqual([
      [1, 0, 12],
      [5, 2, 16],
    ]);
  });
});

describe("setting my weight", () => {
  it("reads a comma as the decimal point", () => {
    expect(sent(setWeight(draftOf(starter), 1, "12,5"))[1]).toEqual([4, 1, 12.5]);
  });

  it("sends none once emptied, so it trains without one", () => {
    expect(sent(setWeight(draftOf(starter), 0, ""))[0]).toEqual([1, 0, null]);
  });
});

describe("a new routine", () => {
  it("starts nameless and empty, at 3 rounds of 40/20", () => {
    expect(saveBody(newDraft())).toEqual({
      name: "",
      rounds: 3,
      work_seconds: 40,
      rest_seconds: 20,
      slots: [],
    });
  });
});

describe("what's wrong with a draft before Save sends it", () => {
  const edited = (change: Partial<Draft>) => ({ ...draftOf(starter), ...change });

  it("is nothing for a routine as saved", () => {
    expect(problemWith(draftOf(starter))).toBeNull();
  });

  it.each([
    [{ name: "  " }, "Give the routine a name."],
    [{ rounds: "0" }, "Rounds must be at least 1."],
    [{ work: "" }, "Work must be at least 1 second."],
    [{ rest: "" }, "Rest needs a number. 0 is fine."],
    [{ slots: [] }, "Add at least one exercise."],
  ])("refuses %o", (change, problem) => {
    expect(problemWith(edited(change))).toBe(problem);
  });

  it("names the exercise whose weight isn't a number", () => {
    expect(problemWith(setWeight(draftOf(starter), 2, "1.2.3"))).toBe(
      "The weight for Two-hand swing isn't a number.",
    );
  });
});

describe("a ⚠️ line", () => {
  const jos = {
    profile_name: "Jo",
    position: 0,
    exercise_name: "Thruster",
    weight: 10,
  } as const;

  it("says where a shifted weight lands", () => {
    expect(damageLine({ ...jos, effect: "shifted", now_exercise_name: "Halo" })).toBe(
      "Jo's 10 kg on Thruster will now be on Halo.",
    );
  });

  it("says a lost weight is deleted", () => {
    expect(damageLine({ ...jos, weight: 12.5, effect: "deleted", now_exercise_name: null })).toBe(
      "Jo's 12.5 kg on Thruster will be deleted.",
    );
  });
});

describe("moving a slot", () => {
  it("takes its origin and my weight with it, so the server sees a reorder", () => {
    expect(sent(moveSlot(draftOf(starter), 2, -1))).toEqual([
      [1, 0, 12],
      [5, 2, 16],
      [4, 1, null],
    ]);
  });

  it("goes nowhere past either end", () => {
    const draft = draftOf(starter);
    expect(moveSlot(draft, 0, -1)).toBe(draft);
    expect(moveSlot(draft, 2, 1)).toBe(draft);
  });
});
