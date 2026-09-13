/**
 * The typed client for the workout-flow API (issue #18, ADR-0003).
 *
 * Field names are the wire's own snake_case, so a workout received from the
 * server can be sent back to it untouched — the iPad carries it, it does not
 * reinterpret it.
 */

import type { FinishQueue } from "./finishQueue";
import { createFinishQueue } from "./finishQueue";
import type { WorkoutTiming } from "./timer/schedule";

/** A person who trains, as the picker shows them. */
export interface Profile {
  readonly id: number;
  readonly name: string;
  /** Always null until avatar upload exists; show the default image. */
  readonly avatar_url: string | null;
  /** The routines on this profile's routine list, by id (ADR-0005). */
  readonly routine_ids: readonly number[];
}

/** A routine in the library, as every list of routines shows it — the same for everyone. */
export interface RoutineSummary {
  readonly id: number;
  readonly name: string;
  readonly rounds: number;
  readonly work_seconds: number;
  readonly rest_seconds: number;
  /** Every turn, rest included; prep is not part of a workout. */
  readonly total_seconds: number;
  readonly exercise_names: readonly string[];
}

/** One entry in a workout: an exercise at the profile's own weight, or at none. */
export interface Activity {
  readonly position: number;
  readonly exercise_id: number;
  readonly exercise_name: string;
  /** Absent for a movement bounded by the clock and the bell (ADR-0002). */
  readonly reps: number | null;
  /** Kilograms; null when the profile has set none, so it trains without one (ADR-0004). */
  readonly weight: number | null;
}

/** A workout as fixed at start — each activity at the profile's own weight, or none. */
export interface Workout {
  readonly routine_id: number;
  readonly routine_name: string;
  readonly rounds: number;
  readonly work_seconds: number;
  readonly rest_seconds: number;
  readonly activities: readonly Activity[];
}

/** A workout sent back when its last turn ends, stamped by the iPad in UTC. */
export interface FinishedWorkout extends Workout {
  readonly profile_id: number;
  /** ISO-8601 UTC to the millisecond; with `profile_id`, the workout's identity. */
  readonly started_at: string;
  readonly ended_at: string;
}

// --- the routine editor (issue #49, ADR-0004) --------------------------------

/** A library exercise: a name, and no weight. */
export interface Exercise {
  readonly id: number;
  readonly name: string;
}

/** One slot as the editor shows it: an exercise, at the editing profile's weight. */
export interface EditableSlot {
  readonly exercise_id: number;
  readonly exercise_name: string;
  /** Kilograms; the editing profile's own, or null for none. */
  readonly weight: number | null;
}

/** A routine as one profile edits it. Nobody else's weight is in here. */
export interface EditableRoutine {
  readonly id: number;
  readonly name: string;
  readonly rounds: number;
  readonly work_seconds: number;
  readonly rest_seconds: number;
  readonly slots: readonly EditableSlot[];
}

/** A slot as Save sends it. */
export interface SlotIn {
  readonly exercise_id: number;
  /** The slot's position as saved, or null when added in this edit: a reorder, not a swap. */
  readonly origin: number | null;
  readonly weight: number | null;
}

/** A routine as Save sends it, with the editing profile's weights. */
export interface RoutineIn {
  readonly name: string;
  readonly rounds: number;
  readonly work_seconds: number;
  readonly rest_seconds: number;
  readonly slots: readonly SlotIn[];
}

/** Someone else's weight that a save would move or lose: one ⚠️ line. */
export interface Damage {
  readonly profile_name: string;
  readonly position: number;
  /** What the weight is on now. */
  readonly exercise_name: string;
  readonly weight: number;
  readonly effect: "shifted" | "deleted";
  /** What it would fall on after the save; null when it would be deleted. */
  readonly now_exercise_name: string | null;
}

/** The timer's view of a workout — the one place the wire meets the engine. */
export function toTiming(workout: Workout): WorkoutTiming {
  return {
    activityCount: workout.activities.length,
    rounds: workout.rounds,
    workSeconds: workout.work_seconds,
    restSeconds: workout.rest_seconds,
  };
}

// --- calls ------------------------------------------------------------------

/** How long any call may wait on the Pi before it counts as failed. */
const REQUEST_TIMEOUT_MS = 10_000;

/** A call the server refused: its reason fit to show, and its `detail` as sent. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail: unknown = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/** The ⚠️ lines a save was refused with, or null for any other failure. */
export function damageIn(error: unknown): readonly Damage[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const { damage } = (error.detail ?? {}) as { damage?: readonly Damage[] };
  return damage ?? null;
}

/** What to tell someone a call failed: the server's reason, or that the Pi is away. */
export function describeFailure(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Can't reach the Pi. Check the Wi-Fi and try again.";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await refusal(response);
  // An add to or removal from a list answers 204, with no body to parse.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function refusal(response: Response): Promise<ApiError> {
  try {
    const { detail } = (await response.json()) as { detail?: unknown };
    return new ApiError(response.status, readableDetail(detail), detail);
  } catch {
    return new ApiError(response.status, response.statusText);
  }
}

/**
 * FastAPI's `detail`, fit to show someone: a string for our own refusals, a list
 * of `{ msg }` for a failed validation — read for its messages, not as JSON.
 */
export function readableDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0 && detail.every(hasMessage)) {
    return detail.map(({ msg }) => msg).join("; ");
  }
  return JSON.stringify(detail);
}

const hasMessage = (item: unknown): item is { msg: string } =>
  typeof item === "object" &&
  item !== null &&
  typeof (item as { msg?: unknown }).msg === "string";

export const listProfiles = () => request<Profile[]>("GET", "/profiles");

export const createProfile = (name: string) =>
  request<Profile>("POST", "/profiles", { name });

export const listRoutines = () => request<RoutineSummary[]>("GET", "/routines");

/** Fix a workout to perform. A read: nothing is written until it is finished. */
export const startWorkout = (profileId: number, routineId: number) =>
  request<Workout>("GET", `/profiles/${profileId}/routines/${routineId}/workout`);

/** The active library, by name. */
export const listExercises = () => request<Exercise[]>("GET", "/exercises");

/** Add to the shared library by name alone; a taken name is refused. */
export const createExercise = (name: string) =>
  request<Exercise>("POST", "/exercises", { name });

/** A routine as `profileId` edits it, with their weights and nobody else's. */
export const getRoutine = (profileId: number, routineId: number) =>
  request<EditableRoutine>("GET", `/profiles/${profileId}/routines/${routineId}`);

/** A new routine, with the creator's weights. Nobody else has any to disturb. */
export const createRoutine = (profileId: number, routine: RoutineIn) =>
  request<EditableRoutine>("POST", `/profiles/${profileId}/routines`, routine);

/**
 * Save an edit as `profileId`. Unconfirmed, a save that would move or lose
 * someone else's weight is refused with a `409`: read it with `damageIn`.
 */
export const saveRoutine = (
  profileId: number,
  routineId: number,
  routine: RoutineIn,
  confirmed: boolean,
) =>
  request<EditableRoutine>("PUT", `/profiles/${profileId}/routines/${routineId}`, {
    ...routine,
    confirmed,
  });

/** Put a routine from the library on a profile's list (ADR-0005); again is harmless. */
export async function addToList(profileId: number, routineId: number): Promise<void> {
  await request<null>("PUT", `/profiles/${profileId}/list/${routineId}`);
}

/** Take a routine off one profile's list; it stays in the library, their weights too. */
export async function removeFromList(profileId: number, routineId: number): Promise<void> {
  await request<null>("DELETE", `/profiles/${profileId}/list/${routineId}`);
}

/** Record a finish; `201` and a retry's `200` both mean the server has it. */
async function recordWorkout(finish: FinishedWorkout): Promise<void> {
  await request<{ id: number }>("POST", "/workouts", finish);
}

// --- the pending-finish queue's driver --------------------------------------

/** How often a finish still waiting is tried again. */
const RETRY_INTERVAL_MS = 5_000;

/**
 * Start the app's one pending-finish queue, backed by `localStorage`.
 *
 * Flushes whatever an earlier launch left behind — await `flushed` before the
 * picker shows — then retries every few seconds for as long as the app is open.
 * Finish a workout with `queue.enqueue(...)`. Call once, at launch.
 */
export function launchFinishQueue(): { queue: FinishQueue; flushed: Promise<void> } {
  const queue = createFinishQueue(localStorage, recordWorkout);
  setInterval(() => void queue.flush(), RETRY_INTERVAL_MS);
  return { queue, flushed: queue.flush() };
}
