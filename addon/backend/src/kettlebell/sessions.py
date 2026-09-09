"""Freezing a prescription, and recording the session it produced.

Two moments, deliberately separate. At workout start the prescription is *resolved*
and frozen in memory — `override ?? slot.weight`, plus the routine's name, rounds
and timing. Nothing is written yet, because aborting a workout writes nothing at
all. When the last turn ends, the session row is written with that same frozen
prescription and never touched again (ADR-0001).

A consequence worth naming: a session row can only exist for a completed workout,
so `ended_at` is NOT NULL and a half-finished session is unrepresentable. That is
rule 3 of `CONTEXT.md` expressed in the schema, and it is what will have to change
when abandoned workouts get modelled.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from kettlebell.db import transaction
from kettlebell.models import Prescription, PrescriptionSlot, Session

__all__ = [
    "freeze_prescription",
    "get_session",
    "list_sessions",
    "record_session",
]


def freeze_prescription(
    connection: sqlite3.Connection, profile_id: int, routine_id: int
) -> Prescription:
    """Resolve a routine into what this profile is about to be asked to do.

    Every weight is resolved here — a prescription never contains an unresolved
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

    return Prescription(
        routine_id=int(routine["id"]),
        routine_name=str(routine["name"]),
        rounds=int(routine["rounds"]),
        work_seconds=int(routine["work_seconds"]),
        rest_seconds=int(routine["rest_seconds"]),
        slots=tuple(
            PrescriptionSlot(
                position=int(row["position"]),
                exercise_id=int(row["exercise_id"]),
                exercise_name=str(row["exercise_name"]),
                reps=int(row["reps"]),
                weight=float(row["weight"]),
            )
            for row in rows
        ),
    )


def record_session(
    connection: sqlite3.Connection,
    profile_id: int,
    prescription: Prescription,
    started_at: datetime,
    ended_at: datetime,
) -> Session:
    """Write a completed workout. Called once, when the summary screen appears."""
    with transaction(connection):
        cursor = connection.execute(
            "INSERT INTO session"
            " (profile_id, routine_id, started_at, ended_at, prescription_json)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                profile_id,
                prescription.routine_id,
                _to_iso(started_at),
                _to_iso(ended_at),
                json.dumps(_prescription_to_dict(prescription)),
            ),
        )
    return Session(
        id=int(cursor.lastrowid or 0),
        profile_id=profile_id,
        started_at=started_at,
        ended_at=ended_at,
        prescription=prescription,
    )


def list_sessions(
    connection: sqlite3.Connection,
    profile_id: int | None = None,
    *,
    limit: int | None = None,
) -> list[Session]:
    """Sessions newest first, for one profile or for everybody."""
    where = "" if profile_id is None else " WHERE profile_id = ?"
    clause = "" if limit is None else " LIMIT ?"
    parameters: tuple[int, ...] = tuple(
        value for value in (profile_id, limit) if value is not None
    )
    rows = connection.execute(
        # Both interpolated fragments are fixed literals; values stay parameters.
        f"SELECT * FROM session{where} ORDER BY started_at DESC, id DESC{clause}",
        parameters,
    ).fetchall()
    return [_to_session(row) for row in rows]


def get_session(connection: sqlite3.Connection, session_id: int) -> Session | None:
    """One session, or None when it does not exist."""
    row = connection.execute(
        "SELECT * FROM session WHERE id = ?", (session_id,)
    ).fetchone()
    return None if row is None else _to_session(row)


# --- serialisation ----------------------------------------------------------


def _prescription_to_dict(prescription: Prescription) -> dict[str, Any]:
    return {
        "routine_id": prescription.routine_id,
        "routine_name": prescription.routine_name,
        "rounds": prescription.rounds,
        "work_seconds": prescription.work_seconds,
        "rest_seconds": prescription.rest_seconds,
        "slots": [
            {
                "position": slot.position,
                "exercise_id": slot.exercise_id,
                "exercise_name": slot.exercise_name,
                "reps": slot.reps,
                "weight": slot.weight,
            }
            for slot in prescription.slots
        ],
    }


def _prescription_from_json(payload: str) -> Prescription:
    raw: dict[str, Any] = json.loads(payload)
    slots: list[dict[str, Any]] = raw["slots"]
    return Prescription(
        routine_id=int(raw["routine_id"]),
        routine_name=str(raw["routine_name"]),
        rounds=int(raw["rounds"]),
        work_seconds=int(raw["work_seconds"]),
        rest_seconds=int(raw["rest_seconds"]),
        slots=tuple(
            PrescriptionSlot(
                position=int(slot["position"]),
                exercise_id=int(slot["exercise_id"]),
                exercise_name=str(slot["exercise_name"]),
                reps=int(slot["reps"]),
                weight=float(slot["weight"]),
            )
            for slot in slots
        ),
    )


def _to_session(row: sqlite3.Row) -> Session:
    return Session(
        id=int(row["id"]),
        profile_id=int(row["profile_id"]),
        started_at=_from_iso(str(row["started_at"])),
        ended_at=_from_iso(str(row["ended_at"])),
        prescription=_prescription_from_json(str(row["prescription_json"])),
    )


def _to_iso(moment: datetime) -> str:
    """Store UTC, ISO-8601. Home Assistant needs the offset to be explicit (#6)."""
    if moment.tzinfo is None:
        raise ValueError("timestamps must be timezone-aware")
    return moment.astimezone(UTC).isoformat()


def _from_iso(text: str) -> datetime:
    return datetime.fromisoformat(text)
