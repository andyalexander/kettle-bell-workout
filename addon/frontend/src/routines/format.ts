import type { RoutineSummary } from "../api";

/** The routine list's middle line (#19): `3 rounds × 5 · 40/20 · 15 min`. */
export function routineLine(routine: RoutineSummary): string {
  const rounds = `${routine.rounds} ${routine.rounds === 1 ? "round" : "rounds"}`;
  const turn = `${routine.work_seconds}/${routine.rest_seconds}`;
  const length = formatMinutes(routine.total_seconds);
  return `${rounds} × ${routine.exercise_names.length} · ${turn} · ${length}`;
}

/** A length in minutes, keeping any odd seconds rather than rounding them away. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes === 0) return `${remainder} s`;
  return remainder === 0 ? `${minutes} min` : `${minutes} min ${remainder} s`;
}
