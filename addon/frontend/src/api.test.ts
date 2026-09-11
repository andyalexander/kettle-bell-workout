import { describe, expect, it } from "vitest";

import type { Activity, Workout } from "./api";
import { readableDetail, toTiming } from "./api";

const activity = (position: number, exercise_name: string): Activity => ({
  position,
  exercise_id: position + 1,
  exercise_name,
  reps: null,
  weight: 12,
});

/** The seeded Starter circuit (#10): five activities, 3 rounds of 40/20. */
const starterCircuit: Workout = {
  routine_id: 1,
  routine_name: "Starter circuit",
  rounds: 3,
  work_seconds: 40,
  rest_seconds: 20,
  activities: ["Thruster", "Single-arm row", "Farmer's carry", "Halo", "Two-hand swing"].map(
    (name, position) => activity(position, name),
  ),
};

describe("a workout from the wire, as the timer runs it", () => {
  it("counts the activities and carries the timing across", () => {
    expect(toTiming(starterCircuit)).toEqual({
      activityCount: 5,
      rounds: 3,
      workSeconds: 40,
      restSeconds: 20,
    });
  });
});

describe("a refusal, as the screen shows it", () => {
  it("passes our own reasons through", () => {
    expect(readableDetail("A profile called Andrew already exists")).toBe(
      "A profile called Andrew already exists",
    );
  });

  it("reads a validation failure's messages, not its JSON", () => {
    const detail = [
      {
        type: "string_too_short",
        loc: ["body", "name"],
        msg: "String should have at least 1 character",
        input: "",
        ctx: { min_length: 1 },
      },
    ];
    expect(readableDetail(detail)).toBe("String should have at least 1 character");
  });

  it("falls back to JSON for a shape it doesn't know", () => {
    expect(readableDetail({ odd: true })).toBe('{"odd":true}');
  });
});
