import sqlite3
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from kettlebell import store
from kettlebell.config import Settings
from kettlebell.db import open_database
from kettlebell.main import create_app
from kettlebell.models import Exercise, Profile, RecordedWorkout, Routine


@pytest.fixture
def tmp_path_settings(tmp_path: Path) -> Settings:
    """Point at a scratch database, with no front end built and no broker."""
    return Settings(
        database_path=tmp_path / "kettlebell.db",
        static_dir=tmp_path / "static",
        log_level="info",
        mqtt=None,
        version="9.9.9",
    )


@pytest.fixture
def anyio_backend() -> str:
    """Run async tests on asyncio only; trio is not a deployment target."""
    return "asyncio"


@pytest.fixture
def db(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    """Open a migrated, empty database on disk — WAL needs a real file."""
    connection = open_database(tmp_path / "kettlebell.db")
    yield connection
    connection.close()


@pytest.fixture
def published() -> list[RecordedWorkout]:
    """Every workout handed to the MQTT seam, in the order it was handed over."""
    return []


@pytest.fixture
async def client(
    db: sqlite3.Connection,
    tmp_path_settings: Settings,
    published: list[RecordedWorkout],
) -> AsyncIterator[AsyncClient]:
    """Talk to the app over ASGI, against the file `db` has already migrated.

    The lifespan is not entered: seeding would put the starter library in every
    test's way, and migration has already happened.
    """
    assert tmp_path_settings.database_path.exists(), db
    app = create_app(tmp_path_settings, on_recorded=published.append)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def andrew(db: sqlite3.Connection) -> Profile:
    return store.add_profile(db, "Andrew")


@pytest.fixture
def swing(db: sqlite3.Connection) -> Exercise:
    return store.add_exercise(db, "Two-hand swing", default_reps=10)


@pytest.fixture
def clean(db: sqlite3.Connection) -> Exercise:
    return store.add_exercise(db, "Double clean", default_reps=5)


@pytest.fixture
def emom(db: sqlite3.Connection, swing: Exercise, clean: Exercise) -> Routine:
    """Two slots, four rounds, a rest-less 60-second EMOM.

    No weights: those are personal, and nobody has set one yet.
    """
    routine = store.add_routine(db, "Monday", rounds=4, work_seconds=60, rest_seconds=0)
    _ = store.set_slots(
        db,
        routine.id,
        [
            store.SlotSpec(exercise_id=swing.id, reps=10),
            store.SlotSpec(exercise_id=clean.id, reps=5),
        ],
    )
    return routine
