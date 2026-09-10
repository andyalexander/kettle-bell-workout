"""SQLite connection setup and the versioned migrations that shape the file.

The database lives at `/data/kettlebell.db` in production, which survives add-on
updates and restarts, so the schema is versioned rather than recreated. Migrations
are plain SQL keyed by `PRAGMA user_version`; Alembic would be a dependency and a
second source of truth for six tables that change rarely.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

__all__ = ["MIGRATIONS", "apply_migrations", "connect", "open_database", "transaction"]

_INITIAL_SCHEMA = """
CREATE TABLE profile (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    avatar_bytes BLOB,
    avatar_mime TEXT,
    sound_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sound_enabled IN (0, 1)),
    CHECK ((avatar_bytes IS NULL) = (avatar_mime IS NULL))
);

CREATE TABLE exercise (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    video_url TEXT,
    notes TEXT,
    -- Reps are optional: a carry or a get-up is prescribed by load and the work
    -- window alone, and a nominal count would be a fiction the UI then shows.
    default_reps INTEGER CHECK (default_reps IS NULL OR default_reps > 0),
    default_weight REAL NOT NULL CHECK (default_weight >= 0),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);

CREATE TABLE routine (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    rounds INTEGER NOT NULL CHECK (rounds > 0),
    work_seconds INTEGER NOT NULL CHECK (work_seconds > 0),
    rest_seconds INTEGER NOT NULL CHECK (rest_seconds >= 0)
);

CREATE TABLE slot (
    id INTEGER PRIMARY KEY,
    routine_id INTEGER NOT NULL REFERENCES routine(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    exercise_id INTEGER NOT NULL REFERENCES exercise(id),
    reps INTEGER CHECK (reps IS NULL OR reps > 0),
    weight REAL NOT NULL CHECK (weight >= 0),
    UNIQUE (routine_id, position)
);

CREATE TABLE weight_override (
    profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
    slot_id INTEGER NOT NULL REFERENCES slot(id) ON DELETE CASCADE,
    weight REAL NOT NULL CHECK (weight >= 0),
    PRIMARY KEY (profile_id, slot_id)
) WITHOUT ROWID;

-- `routine_id` is informational only (ADR-0001) and deliberately carries no foreign
-- key: deleting a routine must never cascade training history away, and setting the
-- column NULL would lose the only link back to the shape that was trained.
-- `snapshot_json` is the workout as it was fixed at start: routine name, rounds,
-- timing and every activity.
CREATE TABLE workout (
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
    routine_id INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
);

CREATE INDEX workout_by_profile_time ON workout (profile_id, started_at);
"""

MIGRATIONS: tuple[str, ...] = (_INITIAL_SCHEMA,)
"""Ordered migrations; a database at `user_version` N has applied the first N."""


def open_database(path: Path) -> sqlite3.Connection:
    """Connect to the database at `path`, creating and migrating it as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = connect(path)
    _ = apply_migrations(connection)
    return connection


def connect(path: Path) -> sqlite3.Connection:
    """Open a connection with the pragmas every caller depends on."""
    connection = sqlite3.connect(path, isolation_level=None)
    connection.row_factory = sqlite3.Row
    _ = connection.execute("PRAGMA foreign_keys = ON")
    _ = connection.execute("PRAGMA journal_mode = WAL")
    _ = connection.execute("PRAGMA synchronous = NORMAL")
    _ = connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def apply_migrations(connection: sqlite3.Connection) -> int:
    """Apply every migration the database has not seen; return its new version."""
    version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    for index, script in enumerate(MIGRATIONS[version:], start=version + 1):
        # `executescript` commits before it runs, so the transaction lives in the
        # script itself. PRAGMA takes no parameters, and `index` is our own counter.
        _ = connection.executescript(
            f"BEGIN;\n{script}\nPRAGMA user_version = {index};\nCOMMIT;"
        )
    return len(MIGRATIONS)


@contextmanager
def transaction(connection: sqlite3.Connection) -> Generator[sqlite3.Connection]:
    """Run a block in one transaction, rolling back if it raises."""
    _ = connection.execute("BEGIN")
    try:
        yield connection
    except BaseException:
        _ = connection.execute("ROLLBACK")
        raise
    _ = connection.execute("COMMIT")
