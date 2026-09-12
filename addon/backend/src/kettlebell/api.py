"""The JSON API for the workout flow — picking a profile, a routine, and training.

The iPad carries a workout from start to finish (ADR-0003): starting one is a read,
finishing it is the only write, and aborting makes no call at all.

Handlers are plain `def`, so FastAPI runs each in its threadpool, and every request
gets a connection of its own, closed once the response is done. The database path
comes from `app.state`, set by `kettlebell.main.create_app`.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Self

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    Response,
)
from pydantic import (
    AwareDatetime,
    BaseModel,
    Field,
    StringConstraints,
    model_validator,
)

from kettlebell import store, workouts
from kettlebell.db import connect
from kettlebell.models import Activity, Profile, RecordedWorkout, Routine, Workout

__all__ = ["OnRecorded", "router"]

type OnRecorded = Callable[[RecordedWorkout], None]
"""Told about each workout new to the database — the seam MQTT publishing fills."""


def _connection(request: Request) -> Generator[sqlite3.Connection]:
    """Open one connection per request, and close it after the response."""
    path: Path = request.app.state.database_path
    opened = connect(path)
    try:
        yield opened
    finally:
        opened.close()


Db = Annotated[sqlite3.Connection, Depends(_connection)]

router = APIRouter(prefix="/api")


class ProfileOut(BaseModel):
    """A profile as the picker shows it."""

    id: int
    name: str
    # Always null until avatar upload exists; the picker falls back to a default.
    avatar_url: str | None

    @classmethod
    def of(cls, profile: Profile) -> ProfileOut:
        """Render a stored profile for the wire."""
        return cls(id=profile.id, name=profile.name, avatar_url=None)


class ProfileIn(BaseModel):
    """A new profile: a name alone. Avatars come later."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


@router.get("/profiles")
def profiles(db: Db) -> list[ProfileOut]:
    """Every profile, by name — the picker's order."""
    return [ProfileOut.of(profile) for profile in store.list_profiles(db)]


@router.post("/profiles", status_code=201)
def create_profile(body: ProfileIn, db: Db) -> ProfileOut:
    """Add a profile from the picker's **+** tile. Names are unique."""
    try:
        return ProfileOut.of(store.add_profile(db, body.name))
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=422, detail=f"a profile named {body.name!r} already exists"
        ) from None


class RoutineOut(BaseModel):
    """A routine as the routine list shows it: its shape, length and movements."""

    id: int
    name: str
    rounds: int
    work_seconds: int
    rest_seconds: int
    # Every turn, rest included; prep sits outside the workout (CONTEXT.md).
    total_seconds: int
    exercise_names: list[str]

    @classmethod
    def of(cls, routine: Routine, exercise_names: list[str]) -> RoutineOut:
        """Render a routine and its exercise names, in slot order."""
        turns = routine.rounds * len(exercise_names)
        return cls(
            id=routine.id,
            name=routine.name,
            rounds=routine.rounds,
            work_seconds=routine.work_seconds,
            rest_seconds=routine.rest_seconds,
            total_seconds=turns * (routine.work_seconds + routine.rest_seconds),
            exercise_names=exercise_names,
        )


@router.get("/routines")
def routines(db: Db) -> list[RoutineOut]:
    """Every routine that can be started, the same for everyone.

    Only the load is personal. A routine with no slots is left out, since there
    would be nothing to perform.
    """
    names = store.list_routine_exercise_names(db)
    return [
        RoutineOut.of(routine, names[routine.id])
        for routine in store.list_routines(db)
        if routine.id in names
    ]


@router.get("/profiles/{profile_id}/routines/{routine_id}/workout")
def workout(profile_id: int, routine_id: int, db: Db) -> Workout:
    """Fix a workout for this profile to perform. A read: it writes nothing.

    The iPad carries what comes back until the last turn ends, then sends it to
    `POST /api/workouts` as received (ADR-0003). A routine that does not exist
    and one with no slots are both not found: neither can be started.
    """
    # Checked here because resolving weights would not notice: with no profile,
    # there are simply no overrides, and every baseline would come back.
    if store.get_profile(db, profile_id) is None:
        raise HTTPException(status_code=404, detail=f"no profile {profile_id}")
    try:
        return workouts.fix_workout(db, profile_id, routine_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from None


CLOCK_SKEW = timedelta(minutes=1)
"""How far the iPad's clock may run ahead of the Pi's before a stamp is "future".

Without it, an iPad a second fast would see its finish refused — and the summary
say "retrying" — until the Pi's clock caught up.
"""


class FinishIn(BaseModel):
    """A finished workout: the fixed workout as received, stamped by the iPad.

    Only its shape is checked, not that it matches the routine: the server trusts
    the workout it handed out (ADR-0003).
    """

    profile_id: int
    started_at: AwareDatetime
    ended_at: AwareDatetime
    routine_id: int
    routine_name: str
    rounds: int
    work_seconds: int
    rest_seconds: int
    activities: Annotated[list[Activity], Field(min_length=1)]

    @model_validator(mode="after")
    def check_times(self) -> Self:
        """Refuse a workout that ends before it starts, or ends in the future."""
        if self.ended_at <= self.started_at:
            raise ValueError("a workout must end after it starts")
        if self.ended_at > datetime.now(UTC) + CLOCK_SKEW:
            raise ValueError("a workout cannot end in the future")
        return self

    def to_workout(self) -> Workout:
        """Rebuild the workout that was performed, exactly as it was fixed."""
        return Workout(
            routine_id=self.routine_id,
            routine_name=self.routine_name,
            rounds=self.rounds,
            work_seconds=self.work_seconds,
            rest_seconds=self.rest_seconds,
            activities=tuple(self.activities),
        )


class RecordedOut(BaseModel):
    """Confirmation that a workout is recorded — all the iPad needs to stop."""

    id: int


@router.post("/workouts", status_code=201)
def record(
    body: FinishIn,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Db,
) -> RecordedOut:
    """Record a completed workout. The only write in the workout flow.

    A repeat of one already recorded — same profile, same start — writes nothing
    and answers `200` with its id, so the iPad can retry without limit.
    """
    # 422, not 404: the profile is named in the body, not in the path.
    if store.get_profile(db, body.profile_id) is None:
        raise HTTPException(status_code=422, detail=f"no profile {body.profile_id}")
    existing = workouts.find_workout(db, body.profile_id, body.started_at)
    if existing is not None:
        response.status_code = 200
        return RecordedOut(id=existing.id)
    recorded = workouts.record_workout(
        db, body.profile_id, body.to_workout(), body.started_at, body.ended_at
    )
    # After the commit and after the response, and only for a workout new to the
    # database: publishing must never break a workout being logged (#6), and a
    # retry must never be published twice.
    on_recorded: OnRecorded = request.app.state.on_recorded
    background.add_task(on_recorded, recorded)
    return RecordedOut(id=recorded.id)
