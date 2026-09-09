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
    """One library entry, as content rather than as a row."""

    name: str
    default_weight: float


@dataclass(frozen=True, slots=True)
class SeedRoutine:
    """One routine, naming its exercises rather than holding slot ids."""

    name: str
    rounds: int
    work_seconds: int
    rest_seconds: int
    exercise_names: tuple[str, ...]


SEED_EXERCISES: tuple[SeedExercise, ...] = (
    SeedExercise("Thruster", 10.0),
    SeedExercise("Single-arm row", 12.0),
    SeedExercise("Farmer's carry", 16.0),
    SeedExercise("Halo", 8.0),
    SeedExercise("Two-hand swing", 16.0),
)
"""Andrew's movements, at weights drawn from the bells he owns (6/8/10/12/16 kg).

Weights are only a prefill for the routine builder; the load actually trained is
the slot's, or a profile's own weight override on top of it.
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
                connection,
                candidate.name,
                default_reps=None,
                default_weight=candidate.default_weight,
            )
    return {candidate.name: existing[candidate.name] for candidate in SEED_EXERCISES}


def _seed_routine(
    connection: sqlite3.Connection, exercises: dict[str, Exercise]
) -> Routine | None:
    """Create the starter routine, unless a routine by that name already exists.

    An existing routine is left completely alone — it may have been edited, and
    rewriting its slots would discard whatever was changed and, worse, could move
    an exercise under a slot id somebody's weight override is keyed on.
    """
    existing = list_routines(connection)
    if any(routine.name == STARTER_ROUTINE.name for routine in existing):
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
            SlotSpec(
                exercise_id=exercises[name].id,
                reps=None,
                weight=exercises[name].default_weight,
            )
            for name in STARTER_ROUTINE.exercise_names
        ],
    )
    return routine
