"""Reads and writes for everything that is still editable.

Profiles, the exercise library, routines, slots and weight overrides all change
freely — history is protected by snapshotting each workout (ADR-0001), not by
locking these rows. Workouts live in `kettlebell.workouts`.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import SupportsInt, cast

from kettlebell.db import transaction
from kettlebell.models import Exercise, Profile, Routine, Slot

__all__ = [
    "SlotSpec",
    "add_profile",
    "archive_exercise",
    "add_exercise",
    "add_routine",
    "clear_weight_override",
    "get_avatar",
    "get_exercise",
    "get_profile",
    "get_routine",
    "list_exercises",
    "list_profiles",
    "list_routines",
    "list_slots",
    "list_weight_overrides",
    "set_avatar",
    "set_slots",
    "set_sound_enabled",
    "set_weight_override",
    "update_exercise",
]


@dataclass(frozen=True, slots=True)
class SlotSpec:
    """A slot as the caller wants it, before it has an id.

    `reps` is None for a movement prescribed by load and the clock alone.
    """

    exercise_id: int
    reps: int | None
    weight: float


# --- profiles ---------------------------------------------------------------


def add_profile(
    connection: sqlite3.Connection, name: str, *, sound_enabled: bool = False
) -> Profile:
    """Create a profile. Sound is off by default; the picker shows name and avatar."""
    with transaction(connection):
        cursor = connection.execute(
            "INSERT INTO profile (name, sound_enabled) VALUES (?, ?)",
            (name, int(sound_enabled)),
        )
    return Profile(
        id=int(cursor.lastrowid or 0),
        name=name,
        sound_enabled=sound_enabled,
        avatar_mime=None,
    )


def list_profiles(connection: sqlite3.Connection) -> list[Profile]:
    """Every profile, by name — the picker's order."""
    rows = connection.execute(
        "SELECT id, name, sound_enabled, avatar_mime FROM profile ORDER BY name"
    ).fetchall()
    return [_to_profile(row) for row in rows]


def get_profile(connection: sqlite3.Connection, profile_id: int) -> Profile | None:
    """One profile, or None when it has been deleted."""
    row = connection.execute(
        "SELECT id, name, sound_enabled, avatar_mime FROM profile WHERE id = ?",
        (profile_id,),
    ).fetchone()
    return None if row is None else _to_profile(row)


def set_sound_enabled(
    connection: sqlite3.Connection, profile_id: int, *, enabled: bool
) -> None:
    """Set the audio-cue preference, which follows the person across devices."""
    with transaction(connection):
        _ = connection.execute(
            "UPDATE profile SET sound_enabled = ? WHERE id = ?",
            (int(enabled), profile_id),
        )


def set_avatar(
    connection: sqlite3.Connection,
    profile_id: int,
    image: bytes | None,
    mime: str | None = None,
) -> None:
    """Store avatar bytes in the profile row, or clear them when `image` is None.

    Pass already-downscaled bytes — see `kettlebell.avatars.downscale_avatar`.
    Keeping the image here is what makes the database the entire application state.
    """
    if (image is None) != (mime is None):
        raise ValueError("avatar bytes and mime type must be given together")
    with transaction(connection):
        _ = connection.execute(
            "UPDATE profile SET avatar_bytes = ?, avatar_mime = ? WHERE id = ?",
            (image, mime, profile_id),
        )


def get_avatar(
    connection: sqlite3.Connection, profile_id: int
) -> tuple[bytes, str] | None:
    """Read the avatar's bytes and mime type, or None when there is no image."""
    row = connection.execute(
        "SELECT avatar_bytes, avatar_mime FROM profile WHERE id = ?", (profile_id,)
    ).fetchone()
    if row is None or row["avatar_bytes"] is None:
        return None
    return bytes(row["avatar_bytes"]), str(row["avatar_mime"])


# --- exercise library -------------------------------------------------------


def add_exercise(
    connection: sqlite3.Connection,
    name: str,
    *,
    default_reps: int | None,
    default_weight: float,
    video_url: str | None = None,
    notes: str | None = None,
) -> Exercise:
    """Add a movement to the shared library.

    The defaults only prefill a slot in the routine builder; they are never read
    at workout time. `default_reps` is None for a movement that has no honest rep
    count — a carry is bounded by the work window, not by a number.
    """
    with transaction(connection):
        cursor = connection.execute(
            "INSERT INTO exercise"
            " (name, video_url, notes, default_reps, default_weight)"
            " VALUES (?, ?, ?, ?, ?)",
            (name, video_url, notes, default_reps, default_weight),
        )
    return Exercise(
        id=int(cursor.lastrowid or 0),
        name=name,
        video_url=video_url,
        notes=notes,
        default_reps=default_reps,
        default_weight=default_weight,
        archived=False,
    )


def list_exercises(
    connection: sqlite3.Connection, *, include_archived: bool = False
) -> list[Exercise]:
    """Read the library, archived movements hidden unless asked for.

    History never comes through here — a workout carries its own names — so
    hiding an archived exercise cannot change what a past workout reads.
    """
    clause = "" if include_archived else " WHERE archived = 0"
    rows = connection.execute(
        # `clause` is a fixed literal, not caller input.
        f"SELECT * FROM exercise{clause} ORDER BY name"
    ).fetchall()
    return [_to_exercise(row) for row in rows]


def get_exercise(connection: sqlite3.Connection, exercise_id: int) -> Exercise | None:
    """One exercise, archived or not."""
    row = connection.execute(
        "SELECT * FROM exercise WHERE id = ?", (exercise_id,)
    ).fetchone()
    return None if row is None else _to_exercise(row)


def update_exercise(
    connection: sqlite3.Connection,
    exercise_id: int,
    *,
    name: str,
    default_reps: int | None,
    default_weight: float,
    video_url: str | None = None,
    notes: str | None = None,
) -> None:
    """Edit a library entry. A rename does not reach backwards into history."""
    with transaction(connection):
        _ = connection.execute(
            "UPDATE exercise SET name = ?, video_url = ?, notes = ?,"
            " default_reps = ?, default_weight = ? WHERE id = ?",
            (name, video_url, notes, default_reps, default_weight, exercise_id),
        )


def archive_exercise(
    connection: sqlite3.Connection, exercise_id: int, *, archived: bool = True
) -> None:
    """Retire a movement from the library without deleting it."""
    with transaction(connection):
        _ = connection.execute(
            "UPDATE exercise SET archived = ? WHERE id = ?",
            (int(archived), exercise_id),
        )


# --- routines and slots -----------------------------------------------------


def add_routine(
    connection: sqlite3.Connection,
    name: str,
    *,
    rounds: int,
    work_seconds: int,
    rest_seconds: int,
) -> Routine:
    """Create a routine. `rest_seconds == 0` is a classic EMOM."""
    with transaction(connection):
        cursor = connection.execute(
            "INSERT INTO routine (name, rounds, work_seconds, rest_seconds)"
            " VALUES (?, ?, ?, ?)",
            (name, rounds, work_seconds, rest_seconds),
        )
    return Routine(
        id=int(cursor.lastrowid or 0),
        name=name,
        rounds=rounds,
        work_seconds=work_seconds,
        rest_seconds=rest_seconds,
    )


def list_routines(connection: sqlite3.Connection) -> list[Routine]:
    """Every routine, by name — routines are shared across profiles."""
    rows = connection.execute("SELECT * FROM routine ORDER BY name").fetchall()
    return [_to_routine(row) for row in rows]


def get_routine(connection: sqlite3.Connection, routine_id: int) -> Routine | None:
    """One routine, or None when it has been deleted."""
    row = connection.execute(
        "SELECT * FROM routine WHERE id = ?", (routine_id,)
    ).fetchone()
    return None if row is None else _to_routine(row)


def set_slots(
    connection: sqlite3.Connection, routine_id: int, specs: Sequence[SlotSpec]
) -> list[Slot]:
    """Replace a routine's slots with `specs`, in the order given.

    Rows are updated in place by position rather than deleted and recreated, so a
    profile's weight overrides survive an edit that keeps the position — an
    override is keyed on `slot_id`, and dropping the row would silently drop
    somebody's personal load.
    """
    with transaction(connection):
        for position, spec in enumerate(specs):
            _ = connection.execute(
                "INSERT INTO slot (routine_id, position, exercise_id, reps, weight)"
                " VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT (routine_id, position) DO UPDATE SET"
                " exercise_id = excluded.exercise_id, reps = excluded.reps,"
                " weight = excluded.weight",
                (routine_id, position, spec.exercise_id, spec.reps, spec.weight),
            )
        _ = connection.execute(
            "DELETE FROM slot WHERE routine_id = ? AND position >= ?",
            (routine_id, len(specs)),
        )
    return list_slots(connection, routine_id)


def list_slots(connection: sqlite3.Connection, routine_id: int) -> list[Slot]:
    """Read a routine's slots in position order — the order they are performed in."""
    rows = connection.execute(
        "SELECT * FROM slot WHERE routine_id = ? ORDER BY position", (routine_id,)
    ).fetchall()
    return [_to_slot(row) for row in rows]


# --- weight overrides -------------------------------------------------------


def set_weight_override(
    connection: sqlite3.Connection, profile_id: int, slot_id: int, weight: float
) -> None:
    """Give one profile its own weight for one slot."""
    with transaction(connection):
        _ = connection.execute(
            "INSERT INTO weight_override (profile_id, slot_id, weight)"
            " VALUES (?, ?, ?)"
            " ON CONFLICT (profile_id, slot_id) DO UPDATE SET weight = excluded.weight",
            (profile_id, slot_id, weight),
        )


def clear_weight_override(
    connection: sqlite3.Connection, profile_id: int, slot_id: int
) -> None:
    """Drop an override, so the slot's baseline weight applies again."""
    with transaction(connection):
        _ = connection.execute(
            "DELETE FROM weight_override WHERE profile_id = ? AND slot_id = ?",
            (profile_id, slot_id),
        )


def list_weight_overrides(
    connection: sqlite3.Connection, profile_id: int, routine_id: int
) -> dict[int, float]:
    """Read a profile's overrides for one routine, keyed by slot id."""
    rows = connection.execute(
        "SELECT o.slot_id, o.weight FROM weight_override o"
        " JOIN slot s ON s.id = o.slot_id"
        " WHERE o.profile_id = ? AND s.routine_id = ?",
        (profile_id, routine_id),
    ).fetchall()
    return {int(row["slot_id"]): float(row["weight"]) for row in rows}


# --- row mapping ------------------------------------------------------------


def _to_profile(row: sqlite3.Row) -> Profile:
    mime = row["avatar_mime"]
    return Profile(
        id=int(row["id"]),
        name=str(row["name"]),
        sound_enabled=bool(row["sound_enabled"]),
        avatar_mime=None if mime is None else str(mime),
    )


def _to_exercise(row: sqlite3.Row) -> Exercise:
    return Exercise(
        id=int(row["id"]),
        name=str(row["name"]),
        video_url=_optional_text(row["video_url"]),
        notes=_optional_text(row["notes"]),
        default_reps=_optional_int(row["default_reps"]),
        default_weight=float(row["default_weight"]),
        archived=bool(row["archived"]),
    )


def _to_routine(row: sqlite3.Row) -> Routine:
    return Routine(
        id=int(row["id"]),
        name=str(row["name"]),
        rounds=int(row["rounds"]),
        work_seconds=int(row["work_seconds"]),
        rest_seconds=int(row["rest_seconds"]),
    )


def _to_slot(row: sqlite3.Row) -> Slot:
    return Slot(
        id=int(row["id"]),
        routine_id=int(row["routine_id"]),
        position=int(row["position"]),
        exercise_id=int(row["exercise_id"]),
        reps=_optional_int(row["reps"]),
        weight=float(row["weight"]),
    )


def _optional_text(value: object) -> str | None:
    return None if value is None else str(value)


def _optional_int(value: object) -> int | None:
    return None if value is None else int(cast(SupportsInt, value))
