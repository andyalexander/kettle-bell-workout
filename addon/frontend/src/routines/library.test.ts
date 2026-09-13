import { describe, expect, it } from "vitest";

import type { Profile, RoutineSummary } from "../api";
import { splitLibrary } from "./library";

const routine = (id: number, name: string): RoutineSummary => ({
  id,
  name,
  rounds: 3,
  work_seconds: 40,
  rest_seconds: 20,
  total_seconds: 900,
  exercise_names: ["Halo"],
});

const profile = (routineIds: readonly number[]): Profile => ({
  id: 1,
  name: "Andrew",
  avatar_url: null,
  routine_ids: routineIds,
});

const names = (routines: readonly RoutineSummary[]) => routines.map(({ name }) => name);

const LIBRARY = [routine(1, "Friday"), routine(2, "Monday"), routine(3, "Starter circuit")];

describe("the routine library, as one profile sees it", () => {
  it("parts the list from the routines to add, each in the library's order", () => {
    const { listed, unlisted } = splitLibrary(LIBRARY, profile([3, 1]));

    expect(names(listed)).toEqual(["Friday", "Starter circuit"]);
    expect(names(unlisted)).toEqual(["Monday"]);
  });

  it("offers every routine to someone whose list is empty", () => {
    const { listed, unlisted } = splitLibrary(LIBRARY, profile([]));

    expect(listed).toEqual([]);
    expect(unlisted).toEqual(LIBRARY);
  });

  it("offers nothing once every routine is on the list", () => {
    expect(splitLibrary(LIBRARY, profile([1, 2, 3])).unlisted).toEqual([]);
  });

  it("skips a listed id the library leaves out, as it does a routine with no slots", () => {
    expect(splitLibrary(LIBRARY, profile([9])).listed).toEqual([]);
  });
});
