# Context: Kettlebell trainer

A Home Assistant add-on for running EMOM and interval kettlebell workouts at home,
used on iPhone/iPad on the LAN. This file is the glossary — when code, issues or
docs name a domain concept, they use the term as defined here.

## Glossary

**Profile** — a person who trains. Chosen from a picker at the start of a workout;
no passwords. Carries a name and an avatar image.

**Exercise** — a movement in the shared library, e.g. "Double kettlebell clean".
Carries an optional form-video URL, notes, and default reps/weight used only to
prefill a slot in the routine builder. Exercises are **archived**, never deleted —
their names live on inside frozen prescriptions.

**Routine** — a reusable workout shape: an ordered list of slots, a round count, and
one timing config. Routines are **shared** across profiles; the load is personal
(see *weight override*).

**Slot** — one position in a routine: an exercise, target reps, and a baseline
weight. A slot's identity is its **position**, so the same exercise may appear many
times in one routine.

**Weight override** — a profile's own weight for a given slot, replacing the slot's
baseline. This is what lets one shared routine suit different people.

**Turn** — one slot performed once, within one round. A routine of 5 slots × 4 rounds
is 20 turns.

**Round** — one pass through every slot of a routine, in order. Routines cycle.

**Phase** — what a turn is doing at an instant: **work** or **rest**. A turn is
`work_seconds + rest_seconds`, so a rest-less EMOM has one phase per turn. The
timer also reports **prep** and **done**, which sit outside every turn.

**Prep** — the fixed 10-second countdown before turn 1, announcing the first slot.
It is an app constant, not part of a routine, and sits **outside** the session, so
it never inflates a session's recorded duration.

**Session** — one workout actually performed by one profile. Holds a **frozen
prescription**.

**Prescription** — the frozen record of what a session prescribed: routine name,
rounds, timing, and for every slot the exercise id, exercise name, reps and resolved
weight. Written once when the workout starts and never changed.

**Volume** — reps × weight, summed over every turn. Reported in kg.

## Rules the model holds to

1. **Routines are shared; load is personal.** At workout start each slot's weight
   resolves as `override ?? slot.weight`. A prescription never contains an
   unresolved override.
2. **History is a snapshot.** Editing a routine, renaming an exercise or changing an
   override never rewrites a past session. See ADR-0001.
3. **Every session completes.** v1 assumes workouts run to the end; totals fold over
   the whole prescription. Abandoned workouts are not modelled yet.
4. **Reps are literal.** There is no per-side concept — unilateral work is expressed
   by how exercises are named and slots laid out.
5. **Weights are kg** throughout.
6. **`/data/kettlebell.db` is the entire application state**, avatars included, so
   `backup: cold` puts all of it into Home Assistant's backups.

## Units and identity

- Weight: kilograms, stored as a number.
- Timestamps: UTC, stored ISO-8601.
- A prescription stores `exercise_id` alongside the exercise name — the id joins
  per-exercise trends across sessions, the name keeps old rows readable after a
  rename or archive.
