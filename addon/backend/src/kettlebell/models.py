"""Domain types, named as `CONTEXT.md` names them.

Every type here is frozen. Rows are read out of SQLite into these and never mutated
in place; changes go back through `kettlebell.store` as explicit writes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

__all__ = [
    "Exercise",
    "Prescription",
    "PrescriptionSlot",
    "Profile",
    "Routine",
    "Session",
    "Slot",
]


@dataclass(frozen=True, slots=True)
class Profile:
    """A person who trains. Chosen from the picker; no password."""

    id: int
    name: str
    sound_enabled: bool
    avatar_mime: str | None


@dataclass(frozen=True, slots=True)
class Exercise:
    """A movement in the shared library. Archived, never deleted."""

    id: int
    name: str
    video_url: str | None
    notes: str | None
    default_reps: int | None
    default_weight: float
    archived: bool


@dataclass(frozen=True, slots=True)
class Routine:
    """A reusable workout shape: slots, a round count, and one timing config.

    A turn is `work_seconds + rest_seconds`; `rest_seconds == 0` is a classic EMOM.
    """

    id: int
    name: str
    rounds: int
    work_seconds: int
    rest_seconds: int


@dataclass(frozen=True, slots=True)
class Slot:
    """One position in a routine: an exercise, an optional rep target, a weight.

    `reps` is None when the movement is prescribed by load and the work window
    alone — a carry, a get-up — and the screen then shows only the weight.
    """

    id: int
    routine_id: int
    position: int
    exercise_id: int
    reps: int | None
    weight: float


@dataclass(frozen=True, slots=True)
class PrescriptionSlot:
    """One slot as it was prescribed, with the weight already resolved.

    Carries `exercise_id` for per-exercise trends and `exercise_name` so an old
    session stays readable after a rename or an archive.
    """

    position: int
    exercise_id: int
    exercise_name: str
    reps: int | None
    weight: float


@dataclass(frozen=True, slots=True)
class Prescription:
    """What a session prescribed, frozen at workout start and never changed."""

    routine_id: int
    routine_name: str
    rounds: int
    work_seconds: int
    rest_seconds: int
    slots: tuple[PrescriptionSlot, ...] = field(default_factory=tuple)

    @property
    def turns(self) -> int:
        """Turns in the whole workout: one pass through the slots, times rounds."""
        return self.rounds * len(self.slots)

    @property
    def time_under_load(self) -> int:
        """Seconds of work prescribed: turns times `work_seconds`, rest excluded.

        This is the figure published to Home Assistant (ADR-0002). Volume — reps
        times weight — used to hold this place, but reps are optional, so volume
        silently reads zero for a routine of carries. Time under load is defined
        for every prescription there is.
        """
        return self.turns * self.work_seconds


@dataclass(frozen=True, slots=True)
class Session:
    """One workout actually performed. Written on completion, never amended."""

    id: int
    profile_id: int
    started_at: datetime
    ended_at: datetime
    prescription: Prescription

    @property
    def duration_seconds(self) -> float:
        """Wall-clock length of the workout, prep excluded."""
        return (self.ended_at - self.started_at).total_seconds()
