"""Fixing a workout at start, and recording it when it completes.

Two moments, deliberately separate. At start the workout is *fixed* — every weight
resolved as `override ?? slot.weight`, plus the routine's name, rounds and timing.
Nothing is written yet, because aborting a workout writes nothing at all. When the
last turn ends, the workout row is written with that same fixed workout and never
touched again (ADR-0001).

A consequence worth naming: a workout row can only exist for a completed workout,
so `ended_at` is NOT NULL and a half-finished workout is unrepresentable. That is
rule 3 of `CONTEXT.md` expressed in the schema, and it is what will have to change
when abandoned workouts get modelled.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any, SupportsInt, cast

from kettlebell.db import transaction
from kettlebell.models import Activity, RecordedWorkout, Workout

__all__ = [
    "find_workout",
    "fix_workout",
    "get_workout",
    "list_workouts",
    "record_workout",
]


def fix_workout(
    connection: sqlite3.Connection, profile_id: int, routine_id: int
) -> Workout:
    """Resolve a routine into what this profile is about to be asked to do.

    Every weight is resolved here — a workout never contains an unresolved
    override — and every exercise name is copied in, so a later rename or archive
    leaves the record readable.
    """
    routine = connection.execute(
        "SELECT * FROM routine WHERE id = ?", (routine_id,)
    ).fetchone()
    if routine is None:
        raise LookupError(f"no routine with id {routine_id}")

    rows = connection.execute(
        "SELECT s.position, s.exercise_id, e.name AS exercise_name, s.reps,"
        " COALESCE(o.weight, s.weight) AS weight"
        " FROM slot s"
        " JOIN exercise e ON e.id = s.exercise_id"
        " LEFT JOIN weight_override o"
        "   ON o.slot_id = s.id AND o.profile_id = ?"
        " WHERE s.routine_id = ?"
        " ORDER BY s.position",
        (profile_id, routine_id),
    ).fetchall()
    if not rows:
        raise LookupError(f"routine {routine_id} has no slots")

    return Workout(
        routine_id=int(routine["id"]),
        routine_name=str(routine["name"]),
        rounds=int(routine["rounds"]),
        work_seconds=int(routine["work_seconds"]),
        rest_seconds=int(routine["rest_seconds"]),
        activities=tuple(
            Activity(
                position=int(row["position"]),
                exercise_id=int(row["exercise_id"]),
                exercise_name=str(row["exercise_name"]),
                reps=_optional_int(row["reps"]),
                weight=float(row["weight"]),
            )
            for row in rows
        ),
    )


def record_workout(
    connection: sqlite3.Connection,
    profile_id: int,
    workout: Workout,
    started_at: datetime,
    ended_at: datetime,
) -> RecordedWorkout:
    """Write a completed workout. Called once, when the summary screen appears."""
    with transaction(connection):
        cursor = connection.execute(
            "INSERT INTO workout"
            " (profile_id, routine_id, started_at, ended_at, snapshot_json)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                profile_id,
                workout.routine_id,
                _to_iso(started_at),
                _to_iso(ended_at),
                json.dumps(_workout_to_dict(workout)),
            ),
        )
    return RecordedWorkout(
        id=int(cursor.lastrowid or 0),
        profile_id=profile_id,
        started_at=started_at,
        ended_at=ended_at,
        workout=workout,
    )


def list_workouts(
    connection: sqlite3.Connection,
    profile_id: int | None = None,
    *,
    limit: int | None = None,
) -> list[RecordedWorkout]:
    """List recorded workouts newest first, for one profile or for everybody."""
    where = "" if profile_id is None else " WHERE profile_id = ?"
    clause = "" if limit is None else " LIMIT ?"
    parameters: tuple[int, ...] = tuple(
        value for value in (profile_id, limit) if value is not None
    )
    rows = connection.execute(
        # Both interpolated fragments are fixed literals; values stay parameters.
        f"SELECT * FROM workout{where} ORDER BY started_at DESC, id DESC{clause}",
        parameters,
    ).fetchall()
    return [_to_recorded(row) for row in rows]


def find_workout(
    connection: sqlite3.Connection, profile_id: int, started_at: datetime
) -> RecordedWorkout | None:
    """Find the workout this profile started at `started_at`, if it is recorded.

    `(profile_id, started_at)` is unique, and this is how a retried finish is
    recognised for what it is (ADR-0003).
    """
    row = connection.execute(
        "SELECT * FROM workout WHERE profile_id = ? AND started_at = ?",
        (profile_id, _to_iso(started_at)),
    ).fetchone()
    return None if row is None else _to_recorded(row)


def get_workout(
    connection: sqlite3.Connection, workout_id: int
) -> RecordedWorkout | None:
    """One recorded workout, or None when it does not exist."""
    row = connection.execute(
        "SELECT * FROM workout WHERE id = ?", (workout_id,)
    ).fetchone()
    return None if row is None else _to_recorded(row)


# --- serialisation ----------------------------------------------------------


def _workout_to_dict(workout: Workout) -> dict[str, Any]:
    return {
        "routine_id": workout.routine_id,
        "routine_name": workout.routine_name,
        "rounds": workout.rounds,
        "work_seconds": workout.work_seconds,
        "rest_seconds": workout.rest_seconds,
        "activities": [
            {
                "position": activity.position,
                "exercise_id": activity.exercise_id,
                "exercise_name": activity.exercise_name,
                "reps": activity.reps,
                "weight": activity.weight,
            }
            for activity in workout.activities
        ],
    }


def _workout_from_json(payload: str) -> Workout:
    raw: dict[str, Any] = json.loads(payload)
    activities: list[dict[str, Any]] = raw["activities"]
    return Workout(
        routine_id=int(raw["routine_id"]),
        routine_name=str(raw["routine_name"]),
        rounds=int(raw["rounds"]),
        work_seconds=int(raw["work_seconds"]),
        rest_seconds=int(raw["rest_seconds"]),
        activities=tuple(
            Activity(
                position=int(activity["position"]),
                exercise_id=int(activity["exercise_id"]),
                exercise_name=str(activity["exercise_name"]),
                reps=_optional_int(activity["reps"]),
                weight=float(activity["weight"]),
            )
            for activity in activities
        ),
    )


def _to_recorded(row: sqlite3.Row) -> RecordedWorkout:
    return RecordedWorkout(
        id=int(row["id"]),
        profile_id=int(row["profile_id"]),
        started_at=_from_iso(str(row["started_at"])),
        ended_at=_from_iso(str(row["ended_at"])),
        workout=_workout_from_json(str(row["snapshot_json"])),
    )


def _optional_int(value: object) -> int | None:
    """Reps are optional, in the row and in the snapshot JSON alike."""
    return None if value is None else int(cast(SupportsInt, value))


def _to_iso(moment: datetime) -> str:
    """Store UTC, ISO-8601. Home Assistant needs the offset to be explicit (#6).

    Always to the millisecond — the precision the iPad stamps — so one instant has
    exactly one spelling, and a retried finish produces the identical key.
    """
    if moment.tzinfo is None:
        raise ValueError("timestamps must be timezone-aware")
    return moment.astimezone(UTC).isoformat(timespec="milliseconds")


def _from_iso(text: str) -> datetime:
    return datetime.fromisoformat(text)
