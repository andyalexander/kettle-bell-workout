# ADR-0002: Reps are optional, and time under load replaces volume

- **Status**: accepted
- **Date**: 2026-09-09
- **Ticket**: [Seed the exercise library with real exercises and form videos](https://github.com/andyalexander/kettle-bell-workout/issues/10)
- **Amends**: [Data model](https://github.com/andyalexander/kettle-bell-workout/issues/2) (rule 4) and the [MQTT contract](https://github.com/andyalexander/kettle-bell-workout/issues/6) (two of its five sensors)
- **Terminology**: since [#13](https://github.com/andyalexander/kettle-bell-workout/issues/13), `Prescription` is `Workout`, `PrescriptionSlot` is `Activity`, `Session` is `RecordedWorkout`, and `ProfileProgress.sessions` is `workouts` — so the `sessions` sensor below is published as `workouts`. The text below keeps the words of its day.

## Context

Seeding the library with the exercises actually trained — thruster, single-arm row,
farmer's carry, halo, two-hand swing — surfaced that a rep count is not something
every movement has. A farmer's carry is bounded by the work window and the bell; a
rep number for it is invented. The same is true of a get-up at the pace a 40-second
window allows. And the person training would rather decide reps in the moment than
have a number prescribed at them across the room.

The schema disagreed: `exercise.default_reps` and `slot.reps` were both `NOT NULL
CHECK (reps > 0)`, so a repless movement was unrepresentable.

Making them nullable is a two-line change. The consequence is not. **Volume** was
defined as reps × weight summed over every turn, and it was the value published to
Home Assistant as `last_volume` and `volume` with `state_class: total`, feeding
long-term statistics. A repless slot contributes nothing to that sum, so the seeded
routine — five repless exercises — would publish a lifetime volume of **0** forever.

A silently-zero total is worse than an absent one. Home Assistant will chart it,
average it, and keep it across restores, and nothing about it looks broken.

Three options were weighed:

1. **Fold volume over rep-carrying slots only.** Cheapest, but the sensor becomes a
   partial truth wearing the name of a total.
2. **Keep reps mandatory** and seed nominal counts. Rejected: it re-introduces the
   fiction, and the fiction is then displayed on the workout screen.
3. **Retire volume; publish time under load.**

## Decision

**Reps are optional.** `exercise.default_reps` and `slot.reps` are nullable, and
`PrescriptionSlot.reps` is `int | None`. Where reps are absent the workout screen
shows the weight alone. Rule 4 of `CONTEXT.md` is amended accordingly: reps stay
literal when present, with no per-side concept.

**Volume is retired.** The published metric is **time under load** — `turns ×
work_seconds`, in seconds, with rest and prep excluded — exposed as
`Prescription.time_under_load`. `ProfileProgress` carries `time_under_load` and
`last_time_under_load`; `volume_since` becomes `time_under_load_since`; the
per-exercise trend in `exercise_series` carries seconds beside top weight.

The MQTT contract from #6 keeps its shape and its reasoning — device-based
discovery, one HA device per profile, retained state, lifetime totals with
`state_class: total` — but two sensors are renamed and re-typed:

| #6 sensor | becomes | type |
| --- | --- | --- |
| `last_volume` (kg) | `last_duration` | `device_class: duration`, unit `s`, `state_class: measurement` |
| `volume` (kg, `total`) | `training_time` | `device_class: duration`, unit `s`, `state_class: total` |

`last_workout`, `last_routine` and `sessions` are unchanged. Nothing has been
published to a broker yet — implementation is #15 — so no statistics are orphaned.

## Consequences

- Every prescription has a defined training figure, including one made entirely of
  carries. That is the property volume never had.
- Time under load is **prescribed, not observed**: two runs of the same routine
  report the same number, and a pause does not reduce it. `Session.duration_seconds`
  remains the wall-clock length and is deliberately *not* published — a long pause
  should not read as extra training.
- Load drops out of the published metric entirely. Progressive overload is visible
  through `top_weight` per exercise, which is where it was always more legible than
  in an aggregate.
- The initial schema was amended in place rather than through a second migration.
  This was available only because the add-on has never been deployed — no `/data`
  exists on the Pi ([#14](https://github.com/andyalexander/kettle-bell-workout/issues/14)
  is still open). Once it has, every schema change is a migration.
