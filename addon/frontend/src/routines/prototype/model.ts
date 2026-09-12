// PROTOTYPE (#48), throwaway. The routine editor's draft, held in memory: nothing
// here reaches the server. Delete once a variant has won.
//
// No default weights (#47, amended): an exercise is a name, a slot is an
// exercise at a position, and the only weight is a person's own, per slot.
import type { Profile, RoutineSummary, Workout } from "../../api";

export interface LibraryExercise {
  readonly id: number;
  readonly name: string;
}

/** The seed library (`seed.py`) by name; ＋ New exercise adds to a copy in memory. */
export const STUB_LIBRARY: readonly LibraryExercise[] = [
  { id: 1, name: "Thruster" },
  { id: 2, name: "Single-arm row" },
  { id: 3, name: "Farmer's carry" },
  { id: 4, name: "Halo" },
  { id: 5, name: "Two-hand swing" },
];

export interface DraftSlot {
  /** Stable while the slot moves about, for React. */
  readonly key: number;
  /** Where this slot sat in the saved routine; null for a slot added here. */
  readonly origin: number | null;
  readonly exercise: LibraryExercise;
  /** The viewer's own weight; null trains without one. */
  readonly weight: number | null;
  readonly swapped: boolean;
}

export interface Draft {
  readonly id: number | null;
  readonly name: string;
  /** Typed text, so an emptied field stays empty while you type. */
  readonly rounds: string;
  readonly work: string;
  readonly rest: string;
  readonly slots: readonly DraftSlot[];
}

/** Someone else's weight, held at a position in the saved routine. */
export interface HeldOverride {
  readonly who: string;
  readonly position: number;
  readonly weight: number;
}

export type PickTarget =
  | { readonly kind: "add" }
  | { readonly kind: "swap"; readonly index: number };

const OWNED_BELLS: readonly number[] = [6, 8, 10, 12, 16];
const nextBell = (weight: number) => OWNED_BELLS.find((bell) => bell > weight) ?? weight + 4;

let lastKey = 0;
const newKey = () => ++lastKey;

export const kg = (weight: number) => `${weight} kg`;

/** A weight for display: `12 kg`, or a dash when there is none. */
export const shownWeight = (weight: number | null) => (weight === null ? "—" : kg(weight));

export const newDraft = (): Draft => ({
  id: null,
  name: "",
  rounds: "3",
  work: "40",
  rest: "20",
  slots: [],
});

/** The real routine, its weights taken as the viewer's, with Halo (slot 4) left empty. */
export function draftFromWorkout(
  workout: Workout,
  library: readonly LibraryExercise[],
): Draft {
  return {
    id: workout.routine_id,
    name: workout.routine_name,
    rounds: String(workout.rounds),
    work: String(workout.work_seconds),
    rest: String(workout.rest_seconds),
    slots: workout.activities.map((activity, position) => ({
      key: newKey(),
      origin: position,
      exercise: library.find(({ name }) => name === activity.exercise_name) ?? {
        id: 100 + activity.exercise_id,
        name: activity.exercise_name,
      },
      weight: position === 3 ? null : activity.weight,
      swapped: false,
    })),
  };
}

/** Stub: the other profile (or "Jo") has its own weight on slots 1 and 2. */
export function stubOthers(
  profiles: readonly Profile[],
  viewer: Profile,
  slots: readonly DraftSlot[],
): HeldOverride[] {
  const who = profiles.find(({ id }) => id !== viewer.id)?.name ?? "Jo";
  return slots
    .slice(0, 2)
    .map((slot, position) => ({ who, position, weight: nextBell(slot.weight ?? 8) }));
}

const mapSlot = (draft: Draft, index: number, change: (slot: DraftSlot) => DraftSlot) => ({
  ...draft,
  slots: draft.slots.map((slot, i) => (i === index ? change(slot) : slot)),
});

export function moveSlot(draft: Draft, index: number, by: -1 | 1): Draft {
  const slots = [...draft.slots];
  const [here, there] = [slots[index], slots[index + by]];
  if (!here || !there) return draft;
  slots[index] = there;
  slots[index + by] = here;
  return { ...draft, slots };
}

export const removeSlot = (draft: Draft, index: number): Draft => ({
  ...draft,
  slots: draft.slots.filter((_, i) => i !== index),
});

/** A new slot has no weight for anyone. */
export const addSlot = (draft: Draft, exercise: LibraryExercise): Draft => ({
  ...draft,
  slots: [
    ...draft.slots,
    { key: newKey(), origin: null, exercise, weight: null, swapped: false },
  ],
});

/** Swapping clears every weight at the slot, yours included. */
export const swapExercise = (draft: Draft, index: number, exercise: LibraryExercise) =>
  mapSlot(draft, index, (slot) => ({ ...slot, exercise, weight: null, swapped: true }));

export const setWeight = (draft: Draft, index: number, weight: number | null) =>
  mapSlot(draft, index, (slot) => ({ ...slot, weight }));

export function problemFor(
  draft: Draft,
  routines: readonly RoutineSummary[],
): string | null {
  const name = draft.name.trim();
  if (!name) return "Give the routine a name.";
  const taken = routines.some(
    (routine) => routine.id !== draft.id && routine.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) return `There's already a routine called ${name}.`;
  if (!Number(draft.rounds)) return "Rounds must be at least 1.";
  if (!Number(draft.work)) return "Work must be at least 1 second.";
  if (draft.rest === "") return "Rest needs a number (0 is fine).";
  if (draft.slots.length === 0) return "Add at least one exercise.";
  return null;
}

/**
 * Whose weights a save would move or lose. Weights are held at the slot's
 * position, so what matters is which exercise sits at that position afterwards.
 */
export function warningsFor(
  saved: readonly DraftSlot[],
  slots: readonly DraftSlot[],
  others: readonly HeldOverride[],
): string[] {
  return others.flatMap(({ who, position, weight }) => {
    const was = saved[position];
    if (!was) return [];
    const theirs = `${who}'s ${kg(weight)}`;
    const now = slots[position];
    if (!now) return [`${theirs} on ${was.exercise.name} will be deleted.`];
    if (now.exercise.id === was.exercise.id && !now.swapped) return [];
    if (now.origin === position) {
      return [
        `${theirs} on ${was.exercise.name} will be cleared: slot ${position + 1} is now ${now.exercise.name}.`,
      ];
    }
    return [`${theirs} at slot ${position + 1} will now apply to ${now.exercise.name}.`];
  });
}

export function deleteWarnings(
  saved: readonly DraftSlot[],
  others: readonly HeldOverride[],
): string[] {
  const lost = others.map(
    ({ who, position, weight }) =>
      `${who}'s ${kg(weight)} on ${saved[position]?.exercise.name ?? "?"} will be deleted.`,
  );
  return [...lost, "Recorded workouts are kept."];
}
