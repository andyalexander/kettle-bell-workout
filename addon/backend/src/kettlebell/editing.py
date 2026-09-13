"""Editing a routine: reading it as one profile, creating it, and saving it.

Routines are shared and weights are personal (ADR-0004), so every edit is made *as*
one profile: the editor shows that profile's weights and sets them, while everyone
else's are held at the slot's position and only ever moved or lost behind a ⚠️.

Nothing here deletes a routine. A new one goes on its creator's list, and taking one
off a list leaves it in the library for anyone to add (ADR-0005).
"""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, SupportsFloat, cast

from kettlebell import store
from kettlebell.db import transaction
from kettlebell.models import Slot

__all__ = [
    "Damage",
    "DamageUnconfirmed",
    "Draft",
    "DraftSlot",
    "EditableRoutine",
    "EditableSlot",
    "InvalidDraft",
    "create_routine",
    "read_routine",
    "save_routine",
]


@dataclass(frozen=True, slots=True)
class DraftSlot:
    """A slot as the editor saves it.

    `origin` is the slot's position in the routine as it was saved, or None for a
    slot added in this edit: it is what tells a reorder from a swap. `weight` is
    the editing profile's own, or None to have none.
    """

    exercise_id: int
    origin: int | None
    weight: float | None


@dataclass(frozen=True, slots=True)
class Draft:
    """A routine as the editor saves it: its shape, and its slots in order."""

    name: str
    rounds: int
    work_seconds: int
    rest_seconds: int
    slots: tuple[DraftSlot, ...]


class InvalidDraft(ValueError):
    """The draft can't become a routine. Nothing has been written."""


type Effect = Literal["shifted", "deleted"]
"""What a save does to a weight: moves it onto another exercise, or loses it."""


@dataclass(frozen=True, slots=True)
class Damage:
    """Someone else's weight that a save would shift or delete — one ⚠️ line.

    `exercise_name` is what the weight is on now; `now_exercise_name` is what it
    would fall on after the save, or None when it would be deleted.
    """

    profile_name: str
    position: int
    exercise_name: str
    weight: float
    effect: Effect
    now_exercise_name: str | None


class DamageUnconfirmed(Exception):
    """The save would shift or delete someone's weight, and wasn't confirmed.

    Nothing has been written. The editor shows `damage` behind the ⚠️ and, on
    *Save anyway*, sends the same save again, confirmed.
    """

    def __init__(self, damage: Sequence[Damage]) -> None:
        """Hold the damage the editor must show before the save is sent again."""
        super().__init__(f"{len(damage)} weight(s) would shift or be deleted")
        self.damage: tuple[Damage, ...] = tuple(damage)


@dataclass(frozen=True, slots=True)
class EditableSlot:
    """One slot as the editor shows it: an exercise, and the editor's own weight."""

    exercise_id: int
    exercise_name: str
    weight: float | None


@dataclass(frozen=True, slots=True)
class EditableRoutine:
    """A routine as one profile edits it. Nobody else's weight is in here."""

    id: int
    name: str
    rounds: int
    work_seconds: int
    rest_seconds: int
    slots: tuple[EditableSlot, ...]


def read_routine(
    connection: sqlite3.Connection, profile_id: int, routine_id: int
) -> EditableRoutine | None:
    """Read a routine for editing as `profile_id`, or None when there is none."""
    routine = connection.execute(
        "SELECT * FROM routine WHERE id = ?", (routine_id,)
    ).fetchone()
    if routine is None:
        return None
    rows = connection.execute(
        "SELECT s.exercise_id, e.name, w.weight FROM slot s"
        " JOIN exercise e ON e.id = s.exercise_id"
        " LEFT JOIN personal_weight w ON w.slot_id = s.id AND w.profile_id = ?"
        " WHERE s.routine_id = ? ORDER BY s.position",
        (profile_id, routine_id),
    ).fetchall()
    return EditableRoutine(
        id=int(routine["id"]),
        name=str(routine["name"]),
        rounds=int(routine["rounds"]),
        work_seconds=int(routine["work_seconds"]),
        rest_seconds=int(routine["rest_seconds"]),
        slots=tuple(
            EditableSlot(
                exercise_id=int(row["exercise_id"]),
                exercise_name=str(row["name"]),
                weight=_optional_float(row["weight"]),
            )
            for row in rows
        ),
    )


def create_routine(
    connection: sqlite3.Connection, profile_id: int, draft: Draft
) -> int:
    """Create a routine from a draft, on the creator's list with their weights.

    Returns the new routine's id. It goes on nobody else's list (ADR-0005).
    """
    with transaction(connection):
        _check(connection, draft, routine_id=None, saved_count=0)
        routine = store.add_routine(
            connection,
            draft.name,
            rounds=draft.rounds,
            work_seconds=draft.work_seconds,
            rest_seconds=draft.rest_seconds,
        )
        _write_slots(connection, profile_id, routine.id, draft.slots, saved=[])
        store.add_to_list(connection, profile_id, routine.id)
    return routine.id


def save_routine(
    connection: sqlite3.Connection,
    profile_id: int,
    routine_id: int,
    draft: Draft,
    *,
    confirmed: bool = False,
) -> None:
    """Save an edit made as `profile_id`. The last save wins.

    Raises `LookupError` when the routine is gone, `InvalidDraft` when the draft
    can't be saved, and `DamageUnconfirmed` when it would shift or delete
    someone else's weight and `confirmed` is false. Each writes nothing.
    """
    with transaction(connection):
        if store.get_routine(connection, routine_id) is None:
            raise LookupError(f"no routine {routine_id}")
        saved = store.list_slots(connection, routine_id)
        _check(connection, draft, routine_id=routine_id, saved_count=len(saved))
        damage = _damage(connection, profile_id, routine_id, saved, draft.slots)
        if damage and not confirmed:
            raise DamageUnconfirmed(damage)
        store.update_routine(
            connection,
            routine_id,
            name=draft.name,
            rounds=draft.rounds,
            work_seconds=draft.work_seconds,
            rest_seconds=draft.rest_seconds,
        )
        _write_slots(connection, profile_id, routine_id, draft.slots, saved)


def _check(
    connection: sqlite3.Connection,
    draft: Draft,
    *,
    routine_id: int | None,
    saved_count: int,
) -> None:
    """Refuse a draft no routine can be: `InvalidDraft` names the first problem."""
    taken = connection.execute(
        "SELECT 1 FROM routine WHERE name = ? AND id IS NOT ?", (draft.name, routine_id)
    ).fetchone()
    if taken is not None:
        raise InvalidDraft(f"a routine named {draft.name!r} already exists")
    if not draft.slots:
        raise InvalidDraft("a routine needs at least one exercise")
    library = {e.id for e in store.list_exercises(connection, include_archived=True)}
    unknown = sorted({slot.exercise_id for slot in draft.slots} - library)
    if unknown:
        raise InvalidDraft(f"no exercise {unknown[0]}")
    origins = [slot.origin for slot in draft.slots if slot.origin is not None]
    if len(set(origins)) != len(origins) or any(o >= saved_count for o in origins):
        raise InvalidDraft("each origin must be a different slot of the saved routine")


def _write_slots(
    connection: sqlite3.Connection,
    profile_id: int,
    routine_id: int,
    slots: Sequence[DraftSlot],
    saved: Sequence[Slot],
) -> None:
    """Lay the slots out by position, then set or clear the editor's weights.

    Rows are kept by position, and so is every weight on them — except on a slot
    that starts empty, where everyone's is cleared. The editor has no reps, so a
    slot keeps the reps it came with, unless it starts empty.
    """
    specs = [
        store.SlotSpec(exercise_id=slot.exercise_id, reps=_reps(slot, saved))
        for slot in slots
    ]
    written = store.set_slots(connection, routine_id, specs)
    for row, slot in zip(written, slots, strict=True):
        if _starts_empty(slot, saved):
            store.clear_slot_weights(connection, row.id)
        if slot.weight is None:
            store.clear_weight(connection, profile_id, row.id)
        else:
            store.set_weight(connection, profile_id, row.id, slot.weight)


def _damage(
    connection: sqlite3.Connection,
    profile_id: int,
    routine_id: int,
    saved: Sequence[Slot],
    slots: Sequence[DraftSlot],
) -> list[Damage]:
    """Every other profile's weight the save would shift or delete, slot by slot.

    The editor's own weights are left out: the save sets those explicitly.
    """
    rows = connection.execute(
        "SELECT p.name AS profile_name, s.position, e.name AS exercise_name, w.weight"
        " FROM personal_weight w"
        " JOIN slot s ON s.id = w.slot_id"
        " JOIN exercise e ON e.id = s.exercise_id"
        " JOIN profile p ON p.id = w.profile_id"
        " WHERE s.routine_id = ? AND w.profile_id != ?"
        " ORDER BY s.position, p.name",
        (routine_id, profile_id),
    ).fetchall()
    names = {
        e.id: e.name for e in store.list_exercises(connection, include_archived=True)
    }
    damage: list[Damage] = []
    for row in rows:
        position = int(row["position"])
        effect = _fate(saved, slots, position)
        if effect is None:
            continue
        damage.append(
            Damage(
                profile_name=str(row["profile_name"]),
                position=position,
                exercise_name=str(row["exercise_name"]),
                weight=float(row["weight"]),
                effect=effect,
                now_exercise_name=(
                    None if effect == "deleted" else names[slots[position].exercise_id]
                ),
            )
        )
    return damage


def _fate(
    saved: Sequence[Slot], slots: Sequence[DraftSlot], position: int
) -> Effect | None:
    """Decide what the save does to weights held at `position`; None leaves them.

    Weights are held at the slot's position, so what matters is which slot sits
    there afterwards: none, or one that starts empty, deletes them; one with a
    different exercise shifts them onto it.
    """
    if position >= len(slots) or _starts_empty(slots[position], saved):
        return "deleted"
    if slots[position].exercise_id == saved[position].exercise_id:
        return None
    return "shifted"


def _starts_empty(slot: DraftSlot, saved: Sequence[Slot]) -> bool:
    """Whether a slot carries nothing over: no weight for anyone, and no reps.

    True for a slot added in this edit, and for one whose exercise was swapped.
    """
    return slot.origin is None or saved[slot.origin].exercise_id != slot.exercise_id


def _reps(slot: DraftSlot, saved: Sequence[Slot]) -> int | None:
    """Carry a slot's reps over from where it was saved, if still the same move."""
    if slot.origin is None or _starts_empty(slot, saved):
        return None
    return saved[slot.origin].reps


def _optional_float(value: object) -> float | None:
    return None if value is None else float(cast(SupportsFloat, value))
