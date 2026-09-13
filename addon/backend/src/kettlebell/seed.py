"""First-run content: Andrew's exercise library and one routine to train.

Seeding is *not* a migration. A migration is a one-way fact about the shape of
the database; seed content is editable data, so re-running it must never
resurrect an exercise that has since been archived or renamed. Everything here
is therefore insert-if-absent, keyed on the unique name, and nothing is ever
updated or deleted.

The library carries no rep counts. These are movements bounded by the work
window and the bell — reps are optional (ADR-0002), and a nominal number would
be a fiction the workout screen then displays across the room.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from kettlebell.models import Exercise, Routine
from kettlebell.store import (
    SlotSpec,
    add_exercise,
    add_routine,
    list_exercises,
    list_routines,
    set_slots,
)

__all__ = ["SEED_EXERCISES", "STARTER_ROUTINE", "seed"]


@dataclass(frozen=True, slots=True)
class SeedExercise:
    """One library entry, as content rather than as a row. A name, and no weight."""

    name: str


@dataclass(frozen=True, slots=True)
class SeedRoutine:
    """One routine, naming its exercises rather than holding slot ids."""

    name: str
    rounds: int
    work_seconds: int
    rest_seconds: int
    exercise_names: tuple[str, ...]


SEED_EXERCISES: tuple[SeedExercise, ...] = (
    SeedExercise("Thruster"),
    SeedExercise("Single-arm row"),
    SeedExercise("Farmer's carry"),
    SeedExercise("Halo"),
    SeedExercise("Two-hand swing"),
)
"""Andrew's movements, by name alone.

Weights belong only to people (ADR-0004), so the seed can't choose one: each
profile sets its own, or trains without one.
"""

STARTER_ROUTINE = SeedRoutine(
    name="Starter circuit",
    rounds=3,
    work_seconds=40,
    rest_seconds=20,
    exercise_names=tuple(exercise.name for exercise in SEED_EXERCISES),
)
"""Five slots, three rounds, 40s work and 20s rest — fifteen minutes exactly."""


def seed(connection: sqlite3.Connection) -> None:
    """Ensure the seed library and routine exist. Safe to run on every start."""
    exercises = _seed_exercises(connection)
    _seed_routine(connection, exercises)


def _seed_exercises(connection: sqlite3.Connection) -> dict[str, Exercise]:
    """Add any missing library entries, and return the seed set by name."""
    existing = {
        exercise.name: exercise
        for exercise in list_exercises(connection, include_archived=True)
    }
    for candidate in SEED_EXERCISES:
        if candidate.name not in existing:
            existing[candidate.name] = add_exercise(
                connection, candidate.name, default_reps=None
            )
    return {candidate.name: existing[candidate.name] for candidate in SEED_EXERCISES}


def _seed_routine(
    connection: sqlite3.Connection, exercises: dict[str, Exercise]
) -> Routine | None:
    """Create the starter routine, but only in a database with no routines at all.

    Once routines can be edited, the starter may have been renamed or deleted, and
    looking it up by name would bring it back. An existing routine is left
    completely alone: rewriting its slots would discard whatever was changed and
    could move an exercise under a slot somebody's personal weight is keyed on.
    """
    if list_routines(connection):
        return None
    routine = add_routine(
        connection,
        STARTER_ROUTINE.name,
        rounds=STARTER_ROUTINE.rounds,
        work_seconds=STARTER_ROUTINE.work_seconds,
        rest_seconds=STARTER_ROUTINE.rest_seconds,
    )
    _ = set_slots(
        connection,
        routine.id,
        [
            SlotSpec(exercise_id=exercises[name].id, reps=None)
            for name in STARTER_ROUTINE.exercise_names
        ],
    )
    return routine
