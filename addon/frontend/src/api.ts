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
  readonly sound_enabled: boolean;
  /** Always null until avatar upload exists; show the default image. */
  readonly avatar_url: string | null;
}

/** A routine as the routine list shows it — the same for every profile. */
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

/** One entry in a workout: an exercise at the profile's resolved weight. */
export interface Activity {
  readonly position: number;
  readonly exercise_id: number;
  readonly exercise_name: string;
  /** Absent for a movement bounded by the clock and the bell (ADR-0002). */
  readonly reps: number | null;
  /** Kilograms. */
  readonly weight: number;
}

/** A workout as fixed at start — every weight already resolved. */
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

/** A call the server refused, carrying its `detail`. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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
  if (!response.ok) throw new ApiError(response.status, await detailOf(response));
  return (await response.json()) as T;
}

async function detailOf(response: Response): Promise<string> {
  try {
    const { detail } = (await response.json()) as { detail?: unknown };
    return readableDetail(detail);
  } catch {
    return response.statusText;
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

/** Fire and forget: a lost preference is not worth interrupting anyone over. */
export function setSoundEnabled(profileId: number, soundEnabled: boolean): void {
  request("PATCH", `/profiles/${profileId}`, { sound_enabled: soundEnabled }).catch(
    () => undefined,
  );
}

export const listRoutines = () => request<RoutineSummary[]>("GET", "/routines");

/** Fix a workout to perform. A read: nothing is written until it is finished. */
export const startWorkout = (profileId: number, routineId: number) =>
  request<Workout>("GET", `/profiles/${profileId}/routines/${routineId}/workout`);

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
