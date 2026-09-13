/**
 * The routine editor's draft, held in memory until Save (#50).
 *
 * Every weight here is the editing profile's own (ADR-0004). The server alone
 * knows everyone else's and decides what a save does to them, so the draft's one
 * duty to them is to carry each slot's `origin` through every move.
 */

import type { Damage, EditableRoutine, Exercise, RoutineIn } from "../api";

export interface DraftSlot {
  /** Stable while the slot moves about, for React. */
  readonly key: number;
  /** Where this slot sat in the routine as saved; null for one added here. */
  readonly origin: number | null;
  readonly exercise: Exercise;
  /** Typed text, so a half-typed `12.` survives; empty is no weight. */
  readonly weight: string;
}

export interface Draft {
  /** Null until a new routine has been saved. */
  readonly id: number | null;
  readonly name: string;
  /** Typed text, so an emptied field stays empty while you type. */
  readonly rounds: string;
  readonly work: string;
  readonly rest: string;
  readonly slots: readonly DraftSlot[];
}

let lastKey = 0;
const newKey = () => ++lastKey;

const weightText = (weight: number | null) => (weight === null ? "" : String(weight));

/** A saved routine, ready to edit: each slot remembers where it came from. */
export function draftOf(routine: EditableRoutine): Draft {
  return {
    id: routine.id,
    name: routine.name,
    rounds: String(routine.rounds),
    work: String(routine.work_seconds),
    rest: String(routine.rest_seconds),
    slots: routine.slots.map((slot, position) => ({
      key: newKey(),
      origin: position,
      exercise: { id: slot.exercise_id, name: slot.exercise_name },
      weight: weightText(slot.weight),
    })),
  };
}

/**
 * Swap a slot with its neighbour. Its origin goes with it, which is how the
 * server tells a reorder from a swap; past either end it goes nowhere.
 */
export function moveSlot(draft: Draft, index: number, by: -1 | 1): Draft {
  const here = draft.slots[index];
  const there = draft.slots[index + by];
  if (!here || !there) return draft;
  const slots = [...draft.slots];
  slots[index] = there;
  slots[index + by] = here;
  return { ...draft, slots };
}

/** A new slot goes on the end, from nowhere, so it has no weight for anyone. */
export const addSlot = (draft: Draft, exercise: Exercise): Draft => ({
  ...draft,
  slots: [...draft.slots, { key: newKey(), origin: null, exercise, weight: "" }],
});

/**
 * A different exercise in the same slot. The origin stays, so the server sees a
 * swap and clears everyone's weight there; mine goes from the draft too.
 */
export const swapExercise = (draft: Draft, index: number, exercise: Exercise): Draft => ({
  ...draft,
  slots: draft.slots.map((slot, i) => (i === index ? { ...slot, exercise, weight: "" } : slot)),
});

/** A slot gone, and its origin with it, so the server drops its weights too. */
export const removeSlot = (draft: Draft, index: number): Draft => ({
  ...draft,
  slots: draft.slots.filter((_, i) => i !== index),
});

/** My own weight for one slot, as typed; empty is none. */
export const setWeight = (draft: Draft, index: number, weight: string): Draft => ({
  ...draft,
  slots: draft.slots.map((slot, i) => (i === index ? { ...slot, weight } : slot)),
});

/** ＋ New routine: no name, no exercises, and a sensible 3 rounds of 40/20. */
export const newDraft = (): Draft => ({
  id: null,
  name: "",
  rounds: "3",
  work: "40",
  rest: "20",
  slots: [],
});

/**
 * Whether Back would lose an edit: the draft now differs from the one opened.
 * An edit put back again is no change, and React's keys are never compared.
 */
export const isChanged = (opened: Draft, current: Draft): boolean =>
  JSON.stringify(comparable(opened)) !== JSON.stringify(comparable(current));

const comparable = ({ name, rounds, work, rest, slots }: Draft) => ({
  name,
  rounds,
  work,
  rest,
  slots: slots.map(({ origin, exercise, weight }) => [origin, exercise.id, weight]),
});

/**
 * Why Save can't send this draft yet, or null when it can. The server has the
 * last word, on a taken name for one; this only spares a round trip and a
 * validator's wording.
 */
export function problemWith(draft: Draft): string | null {
  if (!draft.name.trim()) return "Give the routine a name.";
  if (!(Number(draft.rounds) >= 1)) return "Rounds must be at least 1.";
  if (!(Number(draft.work) >= 1)) return "Work must be at least 1 second.";
  if (draft.rest === "") return "Rest needs a number. 0 is fine.";
  if (draft.slots.length === 0) return "Add at least one exercise.";
  const unreadable = draft.slots.find((slot) => Number.isNaN(parseWeight(slot.weight)));
  if (unreadable) return `The weight for ${unreadable.exercise.name} isn't a number.`;
  return null;
}

/** One ⚠️ line: whose weight, on what, and what the save does to it. */
export function damageLine(damage: Damage): string {
  const theirs = `${damage.profile_name}'s ${damage.weight} kg on ${damage.exercise_name}`;
  return damage.now_exercise_name === null
    ? `${theirs} will be deleted.`
    : `${theirs} will now be on ${damage.now_exercise_name}.`;
}

/** A typed weight in kilograms, a comma allowed for the decimal point; NaN if unreadable. */
const parseWeight = (text: string) =>
  text.trim() === "" ? null : Number(text.replace(",", "."));

/** What Save sends. Check `problemWith` first: this trusts the draft. */
export function saveBody(draft: Draft): RoutineIn {
  return {
    name: draft.name.trim(),
    rounds: Number(draft.rounds),
    work_seconds: Number(draft.work),
    rest_seconds: Number(draft.rest),
    slots: draft.slots.map((slot) => ({
      exercise_id: slot.exercise.id,
      origin: slot.origin,
      weight: parseWeight(slot.weight),
    })),
  };
}
