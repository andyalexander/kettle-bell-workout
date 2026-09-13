"""Reads and writes for everything that is still editable.

Profiles, the exercise library, routines, slots, routine lists and personal weights
all change
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
    "add_to_list",
    "clear_slot_weights",
    "clear_weight",
    "delete_routine",
    "get_avatar",
    "get_exercise",
    "get_profile",
    "get_routine",
    "list_exercises",
    "list_profiles",
    "list_routine_exercise_names",
    "list_routine_lists",
    "list_routines",
    "list_slots",
    "list_weights",
    "remove_from_list",
    "set_avatar",
    "set_slots",
    "set_weight",
    "update_exercise",
    "update_routine",
]


@dataclass(frozen=True, slots=True)
class SlotSpec:
    """A slot as the caller wants it, before it has an id.

    `reps` is None for a movement prescribed by load and the clock alone. There is
    no weight: each profile sets its own with `set_weight` (ADR-0004).
    """

    exercise_id: int
    reps: int | None


# --- profiles ---------------------------------------------------------------


def add_profile(connection: sqlite3.Connection, name: str) -> Profile:
    """Create a profile; the picker shows its name and avatar."""
    with transaction(connection):
        cursor = connection.execute("INSERT INTO profile (name) VALUES (?)", (name,))
    return Profile(id=int(cursor.lastrowid or 0), name=name, avatar_mime=None)


def list_profiles(connection: sqlite3.Connection) -> list[Profile]:
    """Every profile, by name — the picker's order."""
    rows = connection.execute(
        "SELECT id, name, avatar_mime FROM profile ORDER BY name"
    ).fetchall()
    return [_to_profile(row) for row in rows]


def get_profile(connection: sqlite3.Connection, profile_id: int) -> Profile | None:
    """One profile, or None when it has been deleted."""
    row = connection.execute(
        "SELECT id, name, avatar_mime FROM profile WHERE id = ?",
        (profile_id,),
    ).fetchone()
    return None if row is None else _to_profile(row)


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
    video_url: str | None = None,
    notes: str | None = None,
) -> Exercise:
    """Add a movement to the shared library. It carries no weight (ADR-0004).

    `default_reps` only prefills a slot in the routine builder and is never read
    at workout time. It is None for a movement that has no honest rep count — a
    carry is bounded by the work window, not by a number.
    """
    with transaction(connection):
        cursor = connection.execute(
            "INSERT INTO exercise (name, video_url, notes, default_reps)"
            " VALUES (?, ?, ?, ?)",
            (name, video_url, notes, default_reps),
        )
    return Exercise(
        id=int(cursor.lastrowid or 0),
        name=name,
        video_url=video_url,
        notes=notes,
        default_reps=default_reps,
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
    video_url: str | None = None,
    notes: str | None = None,
) -> None:
    """Edit a library entry. A rename does not reach backwards into history."""
    with transaction(connection):
        _ = connection.execute(
            "UPDATE exercise SET name = ?, video_url = ?, notes = ?,"
            " default_reps = ? WHERE id = ?",
            (name, video_url, notes, default_reps, exercise_id),
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


def update_routine(
    connection: sqlite3.Connection,
    routine_id: int,
    *,
    name: str,
    rounds: int,
    work_seconds: int,
    rest_seconds: int,
) -> None:
    """Change a routine's name and shape. A workout already recorded keeps its own."""
    with transaction(connection):
        _ = connection.execute(
            "UPDATE routine SET name = ?, rounds = ?, work_seconds = ?,"
            " rest_seconds = ? WHERE id = ?",
            (name, rounds, work_seconds, rest_seconds, routine_id),
        )


def delete_routine(connection: sqlite3.Connection, routine_id: int) -> None:
    """Delete a routine, its slots, and every personal weight on them.

    Recorded workouts stay: `workout.routine_id` has no foreign key (ADR-0001).
    """
    with transaction(connection):
        _ = connection.execute("DELETE FROM routine WHERE id = ?", (routine_id,))


def list_routines(connection: sqlite3.Connection) -> list[Routine]:
    """List the whole routine library by name, whoever's list each one is on."""
    rows = connection.execute("SELECT * FROM routine ORDER BY name").fetchall()
    return [_to_routine(row) for row in rows]


def list_routine_exercise_names(connection: sqlite3.Connection) -> dict[int, list[str]]:
    """Each routine's exercise names in slot order, keyed by routine id.

    A routine with no slots has no entry. These are the library's current names,
    for choosing a routine — history never reads them, since a workout carries its
    own.
    """
    rows = connection.execute(
        "SELECT s.routine_id, e.name FROM slot s"
        " JOIN exercise e ON e.id = s.exercise_id"
        " ORDER BY s.routine_id, s.position"
    ).fetchall()
    names: dict[int, list[str]] = {}
    for row in rows:
        names.setdefault(int(row["routine_id"]), []).append(str(row["name"]))
    return names


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

    Rows are updated in place by position rather than deleted and recreated, so
    personal weights survive an edit that keeps the position — a personal weight
    is keyed on `slot_id`, and dropping the row would silently drop somebody's
    load.
    """
    with transaction(connection):
        for position, spec in enumerate(specs):
            _ = connection.execute(
                "INSERT INTO slot (routine_id, position, exercise_id, reps)"
                " VALUES (?, ?, ?, ?)"
                " ON CONFLICT (routine_id, position) DO UPDATE SET"
                " exercise_id = excluded.exercise_id, reps = excluded.reps",
                (routine_id, position, spec.exercise_id, spec.reps),
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


# --- routine lists (ADR-0005) -----------------------------------------------


def add_to_list(
    connection: sqlite3.Connection, profile_id: int, routine_id: int
) -> None:
    """Put a routine on a profile's list; one already there stays as it is."""
    with transaction(connection):
        _ = connection.execute(
            "INSERT INTO profile_routine (profile_id, routine_id) VALUES (?, ?)"
            " ON CONFLICT DO NOTHING",
            (profile_id, routine_id),
        )


def remove_from_list(
    connection: sqlite3.Connection, profile_id: int, routine_id: int
) -> None:
    """Take a routine off one profile's list. The routine and every weight stay."""
    with transaction(connection):
        _ = connection.execute(
            "DELETE FROM profile_routine WHERE profile_id = ? AND routine_id = ?",
            (profile_id, routine_id),
        )


def list_routine_lists(connection: sqlite3.Connection) -> dict[int, list[int]]:
    """Each profile's routine ids, keyed by profile id. An empty list has no entry."""
    rows = connection.execute(
        "SELECT profile_id, routine_id FROM profile_routine"
        " ORDER BY profile_id, routine_id"
    ).fetchall()
    lists: dict[int, list[int]] = {}
    for row in rows:
        lists.setdefault(int(row["profile_id"]), []).append(int(row["routine_id"]))
    return lists


# --- personal weights -------------------------------------------------------


def set_weight(
    connection: sqlite3.Connection, profile_id: int, slot_id: int, weight: float
) -> None:
    """Give one profile its own weight for one slot — the only weight there is."""
    with transaction(connection):
        _ = connection.execute(
            "INSERT INTO personal_weight (profile_id, slot_id, weight)"
            " VALUES (?, ?, ?)"
            " ON CONFLICT (profile_id, slot_id) DO UPDATE SET weight = excluded.weight",
            (profile_id, slot_id, weight),
        )


def clear_weight(connection: sqlite3.Connection, profile_id: int, slot_id: int) -> None:
    """Drop a profile's weight for a slot; it then trains without one."""
    with transaction(connection):
        _ = connection.execute(
            "DELETE FROM personal_weight WHERE profile_id = ? AND slot_id = ?",
            (profile_id, slot_id),
        )


def clear_slot_weights(connection: sqlite3.Connection, slot_id: int) -> None:
    """Drop every profile's weight for a slot, as when its exercise is swapped."""
    with transaction(connection):
        _ = connection.execute(
            "DELETE FROM personal_weight WHERE slot_id = ?", (slot_id,)
        )


def list_weights(
    connection: sqlite3.Connection, profile_id: int, routine_id: int
) -> dict[int, float]:
    """Read a profile's weights for one routine, keyed by slot id.

    A slot missing from the result has no weight for this profile.
    """
    rows = connection.execute(
        "SELECT w.slot_id, w.weight FROM personal_weight w"
        " JOIN slot s ON s.id = w.slot_id"
        " WHERE w.profile_id = ? AND s.routine_id = ?",
        (profile_id, routine_id),
    ).fetchall()
    return {int(row["slot_id"]): float(row["weight"]) for row in rows}


# --- row mapping ------------------------------------------------------------


def _to_profile(row: sqlite3.Row) -> Profile:
    mime = row["avatar_mime"]
    return Profile(
        id=int(row["id"]),
        name=str(row["name"]),
        avatar_mime=None if mime is None else str(mime),
    )


def _to_exercise(row: sqlite3.Row) -> Exercise:
    return Exercise(
        id=int(row["id"]),
        name=str(row["name"]),
        video_url=_optional_text(row["video_url"]),
        notes=_optional_text(row["notes"]),
        default_reps=_optional_int(row["default_reps"]),
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
    )


def _optional_text(value: object) -> str | None:
    return None if value is None else str(value)


def _optional_int(value: object) -> int | None:
    return None if value is None else int(cast(SupportsInt, value))
