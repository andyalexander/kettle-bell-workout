"""The JSON API: picking a profile, a routine, training, and editing routines.

The iPad carries a workout from start to finish (ADR-0003): starting one is a read,
finishing it is the only write, and aborting makes no call at all.

Editing is done as one profile (`kettlebell.editing`): the editor sees and sets that
profile's weights, and a save that would shift or delete anyone else's answers `409`
until it is confirmed.

Every routine is in the library at `/api/routines`, but each profile trains from its
own routine list (ADR-0005): its routines' ids come with the profile, and
`/api/profiles/{id}/list/{routine_id}` adds a routine to it or takes one off.

Handlers are plain `def`, so FastAPI runs each in its threadpool, and every request
gets a connection of its own, closed once the response is done. The database path
comes from `app.state`, set by `kettlebell.main.create_app`.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Generator
from dataclasses import asdict
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
    NonNegativeFloat,
    NonNegativeInt,
    PositiveInt,
    StringConstraints,
    model_validator,
)

from kettlebell import editing, store, workouts
from kettlebell.db import connect
from kettlebell.editing import (
    DamageUnconfirmed,
    Draft,
    DraftSlot,
    EditableRoutine,
    InvalidDraft,
)
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
    """A profile as the picker shows it, with the routines on its list."""

    id: int
    name: str
    # Always null until avatar upload exists; the picker falls back to a default.
    avatar_url: str | None
    # Its routine list (ADR-0005): the app shows these of the library, and offers the
    # rest under ＋ New routine.
    routine_ids: list[int]

    @classmethod
    def of(cls, profile: Profile, routine_ids: list[int]) -> ProfileOut:
        """Render a stored profile and its routine list for the wire."""
        return cls(
            id=profile.id, name=profile.name, avatar_url=None, routine_ids=routine_ids
        )


type Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
"""A name as typed: surrounding spaces dropped, and never blank."""


class ProfileIn(BaseModel):
    """A new profile: a name alone. Avatars come later."""

    name: Name


@router.get("/profiles")
def profiles(db: Db) -> list[ProfileOut]:
    """Every profile, by name — the picker's order — each with its routine list."""
    lists = store.list_routine_lists(db)
    return [
        ProfileOut.of(profile, lists.get(profile.id, []))
        for profile in store.list_profiles(db)
    ]


@router.post("/profiles", status_code=201)
def create_profile(body: ProfileIn, db: Db) -> ProfileOut:
    """Add a profile from the picker's **+** tile. Names are unique.

    Its routine list starts empty: ＋ New routine offers the whole library.
    """
    try:
        return ProfileOut.of(store.add_profile(db, body.name), routine_ids=[])
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=422, detail=f"a profile named {body.name!r} already exists"
        ) from None


class ExerciseOut(BaseModel):
    """A library exercise as the editor's picker shows it: a name, and no weight."""

    id: int
    name: str


@router.get("/exercises")
def exercises(db: Db) -> list[ExerciseOut]:
    """List the library's active exercises by name; archived ones can't be picked."""
    return [
        ExerciseOut(id=exercise.id, name=exercise.name)
        for exercise in store.list_exercises(db)
    ]


class ExerciseIn(BaseModel):
    """A new library exercise, added from the picker by name only."""

    name: Name


@router.post("/exercises", status_code=201)
def create_exercise(body: ExerciseIn, db: Db) -> ExerciseOut:
    """Add an exercise to the shared library. Names are unique, archived included."""
    try:
        added = store.add_exercise(db, body.name, default_reps=None)
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=422, detail=f"an exercise named {body.name!r} already exists"
        ) from None
    return ExerciseOut(id=added.id, name=added.name)


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
    """List the library: every routine that can be started, whoever's list it's on.

    The app shows each profile the ones in its `routine_ids`, and offers the rest
    under ＋ New routine (ADR-0005). A routine with no slots is left out, since there
    would be nothing to perform.
    """
    names = store.list_routine_exercise_names(db)
    return [
        RoutineOut.of(routine, names[routine.id])
        for routine in store.list_routines(db)
        if routine.id in names
    ]


@router.get("/profiles/{profile_id}/routines/{routine_id}")
def editable_routine(profile_id: int, routine_id: int, db: Db) -> EditableRoutine:
    """Read a routine for the editor, with this profile's weights and nobody else's."""
    return _editable(db, profile_id, routine_id)


def _editable(
    db: sqlite3.Connection, profile_id: int, routine_id: int
) -> EditableRoutine:
    """Read a routine as `profile_id`; 404 when the profile or routine is gone."""
    _require_profile(db, profile_id)
    routine = editing.read_routine(db, profile_id, routine_id)
    if routine is None:
        raise HTTPException(status_code=404, detail=f"no routine {routine_id}")
    return routine


def _require_profile(db: sqlite3.Connection, profile_id: int) -> None:
    """Refuse a request made as a profile that doesn't exist."""
    if store.get_profile(db, profile_id) is None:
        raise HTTPException(status_code=404, detail=f"no profile {profile_id}")


class SlotIn(BaseModel):
    """A slot as the editor saves it — see `kettlebell.editing.DraftSlot`."""

    exercise_id: int
    origin: NonNegativeInt | None = None
    weight: NonNegativeFloat | None = None


class RoutineIn(BaseModel):
    """A routine as the editor saves it, with the editing profile's weights."""

    name: Name
    rounds: PositiveInt
    work_seconds: PositiveInt
    rest_seconds: NonNegativeInt
    slots: list[SlotIn]
    # True once the editor has shown the ⚠️ and the user chose *Save anyway*.
    confirmed: bool = False

    def to_draft(self) -> Draft:
        """Restate the edit in the domain's terms."""
        return Draft(
            name=self.name,
            rounds=self.rounds,
            work_seconds=self.work_seconds,
            rest_seconds=self.rest_seconds,
            slots=tuple(
                DraftSlot(exercise_id=s.exercise_id, origin=s.origin, weight=s.weight)
                for s in self.slots
            ),
        )


@router.post("/profiles/{profile_id}/routines", status_code=201)
def create_routine(profile_id: int, body: RoutineIn, db: Db) -> EditableRoutine:
    """Create a routine from the editor, the creator's weights set as theirs."""
    _require_profile(db, profile_id)
    try:
        routine_id = editing.create_routine(db, profile_id, body.to_draft())
    except InvalidDraft as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    return _editable(db, profile_id, routine_id)


@router.put("/profiles/{profile_id}/routines/{routine_id}")
def save_routine(
    profile_id: int, routine_id: int, body: RoutineIn, db: Db
) -> EditableRoutine:
    """Save an edit made as this profile. The last save wins.

    A save that would shift or delete someone else's weight answers `409` with
    the damage and writes nothing, until it is sent again with `confirmed`.
    """
    _require_profile(db, profile_id)
    try:
        editing.save_routine(
            db, profile_id, routine_id, body.to_draft(), confirmed=body.confirmed
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from None
    except InvalidDraft as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except DamageUnconfirmed as error:
        raise _unconfirmed(error) from None
    return _editable(db, profile_id, routine_id)


@router.put("/profiles/{profile_id}/list/{routine_id}", status_code=204)
def add_to_list(profile_id: int, routine_id: int, db: Db) -> None:
    """Put a routine from the library on this profile's list; again is harmless."""
    _require_profile(db, profile_id)
    if store.get_routine(db, routine_id) is None:
        raise HTTPException(status_code=404, detail=f"no routine {routine_id}")
    store.add_to_list(db, profile_id, routine_id)


@router.delete("/profiles/{profile_id}/list/{routine_id}", status_code=204)
def remove_from_list(profile_id: int, routine_id: int, db: Db) -> None:
    """Take a routine off this profile's list, and nobody else's (ADR-0005).

    It stays in the library for anyone to add again, this profile's weights on it
    included, and its recorded workouts are kept. Nothing deletes a routine.
    Removing one that isn't on the list is harmless.
    """
    _require_profile(db, profile_id)
    store.remove_from_list(db, profile_id, routine_id)


def _unconfirmed(error: DamageUnconfirmed) -> HTTPException:
    """Build the `409` that asks the editor to show the ⚠️ before trying again."""
    damage = [asdict(item) for item in error.damage]
    return HTTPException(status_code=409, detail={"damage": damage})


@router.get("/profiles/{profile_id}/routines/{routine_id}/workout")
def workout(profile_id: int, routine_id: int, db: Db) -> Workout:
    """Fix a workout for this profile to perform. A read: it writes nothing.

    The iPad carries what comes back until the last turn ends, then sends it to
    `POST /api/workouts` as received (ADR-0003). A routine that does not exist
    and one with no slots are both not found: neither can be started.
    """
    # Checked here because fixing the workout would not notice: with no profile,
    # there are simply no personal weights, and every activity would come back
    # weightless.
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
