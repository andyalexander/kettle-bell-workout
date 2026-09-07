# ADR-0001: Snapshot the prescription into the session

- **Status**: accepted
- **Date**: 2026-09-07
- **Ticket**: [Data model: routines, exercises, sessions, and honest history](https://github.com/andyalexander/kettle-bell-workout/issues/2)

## Context

Workout logging is fully automatic: finishing a workout records what was prescribed,
with zero taps mid-workout. That makes a session a statement about the past — but a
foreign key from `session` to `routine` is a pointer to the *present*. Editing a
routine, renaming an exercise, or changing a weight would silently rewrite history
that has already been trained and reported to Home Assistant.

Three ways to break that pointer were considered:

1. **Snapshot** the resolved prescription into the session row.
2. **Version** routines, with sessions pointing at an immutable version.
3. **Copy-on-write** — a routine becomes immutable once trained against.

## Decision

Snapshot. When a workout starts, the resolved prescription is frozen into
`session.prescription_json`: routine name, rounds, timing config, and for every slot
the `exercise_id`, exercise name, reps and resolved weight (`override ?? slot.weight`).
`routine` and `slot` rows stay freely editable. `session.routine_id` is retained but
informational only — nothing reads through it to render history.

## Consequences

- History cannot be rewritten by any later edit. Routine editing needs no special
  care, and the builder has no "this will change your history" caveats.
- Reading history and computing metrics is a fold over one column — no joins to
  mutable data, no version resolution.
- An exercise rename or a corrected video link does **not** propagate backwards.
  Old sessions keep the name used at the time, which is the honest reading.
- Exercises are archived rather than deleted, so the library stays consistent with
  the names inside prescriptions.
- Per-exercise trends join on the snapshotted `exercise_id`, so they survive renames.
- Duplication is accepted: a prescription is a few hundred bytes of JSON per workout.
- Versioning was rejected as two extra tables and a branching edit flow for a
  comparison feature nobody asked for; copy-on-write was rejected because routine
  identity fragments in the picker.
