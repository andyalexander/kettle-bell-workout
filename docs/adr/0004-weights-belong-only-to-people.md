# ADR-0004: Weights belong only to people

- **Status**: accepted
- **Date**: 2026-09-12
- **Ticket**: [Edit a routine's exercises and weights, and set my own weight](https://github.com/andyalexander/kettle-bell-workout/issues/47), amended while [prototyping the routine editor](https://github.com/andyalexander/kettle-bell-workout/issues/48)
- **Amends**: [Data model](https://github.com/andyalexander/kettle-bell-workout/issues/2) (a weight resolved as `override ?? slot.weight`) and rule 1 of `CONTEXT.md`

## Context

The data model gave every weight two layers. An exercise carried a **default
weight**, a slot took it as its **baseline** when the exercise was put in, and a
profile could lay a **weight override** on top. At workout start each activity's
weight resolved as `override ?? slot.weight`. The routine-editing grilling kept
that shape and put a *Use routine's weight* action in the editor to get back to the
baseline.

Andrew met that shape in the editor prototype and rejected it. When he creates a
routine he doesn't know a weight for it, and shouldn't have to invent one. A weight
is added when a routine is set up for a particular person. A baseline is a number
nobody chose, shown to everybody, and it made the editor explain two kinds of
weight to someone who only ever thinks of one: *mine*.

That left one question the old model never faced. A person can now start a routine
with no weight for a slot. Three answers were weighed: **ask for the weights
first**, **train without a weight**, or **block Start until every slot has one**.
Andrew chose **train without a weight**. Nothing stands between someone and a
workout, and nothing makes a weight up.

## Decision

**Neither an exercise nor a slot carries a weight.** The only weight is a
**personal weight**: one profile's weight for one slot, in the table
`personal_weight (profile_id, slot_id, weight)`, formerly `weight_override`. It is
still **held at the slot's position** (#9's upsert by position), and swapping the
slot's exercise clears it.

**A slot with no personal weight trains without one.** `fix_workout` gives each
activity the profile's personal weight or `null`. `Activity.weight` is
`float | None`, the snapshot freezes `null` (ADR-0001), a finish carrying `null` is
accepted, and `top_weight` skips a weightless activity. This is the same shape
reps took in ADR-0002: absent when there is nothing honest to say.

**Migration 3** drops `exercise.default_weight` and `slot.weight` and renames
`weight_override` to `personal_weight`, keeping its rows. The dropped weights are
**not** copied to anyone. Andrew chose between *keep them for whoever has trained
the routine*, *keep them for every profile*, and *drop them*, and picked *drop
them*. A row already in `weight_override` was always one person's own choice, so it
stays.

## Consequences

- After the migration **every profile on the Pi has no weights**, so *Starter
  circuit* trains weightless until each person sets their own. Setting a weight
  needs the routine editor. This change must therefore **ship with it**
  ([Implement the routine-editing API](https://github.com/andyalexander/kettle-bell-workout/issues/49),
  [Build the routine editor](https://github.com/andyalexander/kettle-bell-workout/issues/50)),
  never in a release of its own.
- Recorded workouts keep the weights they were lifted at. History is a snapshot,
  and a migration of the live tables cannot reach into `snapshot_json`.
- A new profile can train any routine at once, weightless, rather than inheriting
  someone else's numbers.
- The workout screen shows the rep count alone, or nothing, where it used to show
  `10 × 16 kg`.
- Vocabulary: *baseline*, *default weight* and *weight override* are retired in
  favour of **personal weight** (`CONTEXT.md`).
