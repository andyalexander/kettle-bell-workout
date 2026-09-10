# ADR-0003: The iPad carries the workout from start to finish

- **Status**: accepted
- **Date**: 2026-09-10
- **Ticket**: [The JSON API surface for the workout flow](https://github.com/andyalexander/kettle-bell-workout/issues/13)

## Context

A workout is **fixed** when it starts — every weight resolved, every exercise name
copied in (ADR-0001) — and **recorded** only when it completes. Nothing may be
written in between: aborting writes nothing at all, and the schema makes a
half-finished workout unrepresentable. So for the length of a workout, something
has to hold the fixed workout that is not the database.

Four places were considered:

1. **The iPad holds it.** Starting returns the workout; finishing sends it back.
2. **The server holds it in memory**, keyed by a token handed out at start.
3. **The server writes a pending row** at start and completes it at finish.
4. **The server resolves it again** at finish, from the routine as it is then.

## Decision

The iPad carries it. Starting a workout is a **read**
(`GET /api/profiles/{pid}/routines/{rid}/workout`) and writes nothing. Finishing
(`POST /api/workouts`) sends the workout back as received, with `started_at` and
`ended_at` stamped by the iPad in UTC to the millisecond. The server records it.

Because the iPad is the only party that sees both moments, it owns both timestamps,
and `(profile_id, started_at)` is unique: a repeated finish writes nothing and
answers with the workout already recorded. The iPad saves the finish call locally
before sending it, and retries until the server confirms — including on the next
launch.

## Consequences

- A workout survives an add-on restart or update mid-workout; option 2 would have
  lost it.
- "Abort writes nothing" stays literally true; option 3 would have broken it and
  needed a nullable `ended_at`.
- What is recorded is what was shown, even if a routine or override is edited
  mid-workout; option 4 would have recorded a weight nobody lifted.
- **The server trusts the workout the iPad sends.** It validates shape — a known
  profile, at least one activity, sane timestamps — but not that the activities
  match the routine. Acceptable on a password-less LAN app, where anyone on the
  network can already write anything.
- A retried finish is harmless, so the iPad can retry without limit.
- The pending finish lives in browser storage, which is per-origin: one waiting at
  `http://` is not seen from `https://` (#12) until that address is opened again.
- When abandoned workouts are modelled, the progress they need is also something
  only the iPad observes — this decision is where that design starts.
