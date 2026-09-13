import sqlite3
from pathlib import Path

import pytest

from kettlebell.db import (
    MIGRATIONS,
    apply_migrations,
    connect,
    open_database,
    transaction,
)


def test_migrations_stamp_the_user_version(db: sqlite3.Connection) -> None:
    assert db.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)


def test_migrations_are_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "kettlebell.db"
    first = open_database(path)
    tables = first.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).fetchall()
    first.close()

    # Reopening is what an add-on restart does; it must not rebuild anything.
    second = open_database(path)
    assert apply_migrations(second) == len(MIGRATIONS)
    assert (
        second.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        ).fetchall()
        == tables
    )
    second.close()


def test_dropping_sound_keeps_every_profile(tmp_path: Path) -> None:
    # A database from before the app went silent, as the Pi's is.
    old = connect(tmp_path / "kettlebell.db")
    _ = old.executescript(
        f"BEGIN;\n{MIGRATIONS[0]}\nPRAGMA user_version = 1;\n"
        "INSERT INTO profile (name, sound_enabled) VALUES ('Andrew', 1);\nCOMMIT;"
    )

    assert apply_migrations(old) == len(MIGRATIONS)
    columns = {row["name"] for row in old.execute("PRAGMA table_info(profile)")}
    assert "sound_enabled" not in columns
    assert [row["name"] for row in old.execute("SELECT name FROM profile")] == [
        "Andrew"
    ]
    old.close()


def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
    # `table` is always a literal from the test, never input.
    return {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}


def test_personal_weights_drop_every_shared_weight(tmp_path: Path) -> None:
    # A database from before weights belonged only to people, as the Pi's is.
    old = connect(tmp_path / "kettlebell.db")
    _ = old.executescript(
        f"BEGIN;\n{MIGRATIONS[0]}\n{MIGRATIONS[1]}\nPRAGMA user_version = 2;\n"
        "INSERT INTO profile (name) VALUES ('Andrew');\n"
        "INSERT INTO exercise (name, default_weight) VALUES ('Halo', 8);\n"
        "INSERT INTO routine (name, rounds, work_seconds, rest_seconds)"
        " VALUES ('Starter circuit', 3, 40, 20);\n"
        "INSERT INTO slot (routine_id, position, exercise_id, weight)"
        " VALUES (1, 0, 1, 8);\n"
        "INSERT INTO weight_override (profile_id, slot_id, weight) VALUES (1, 1, 10);\n"
        "COMMIT;"
    )

    assert apply_migrations(old) == len(MIGRATIONS)
    # Shared weights are dropped, not handed to anyone (ADR-0004).
    assert "default_weight" not in _columns(old, "exercise")
    assert "weight" not in _columns(old, "slot")
    # A weight someone already set was always theirs, so it stays.
    rows = old.execute("SELECT profile_id, slot_id, weight FROM personal_weight")
    assert [tuple(row) for row in rows] == [(1, 1, 10.0)]
    assert old.execute("SELECT count(*) FROM slot").fetchone()[0] == 1
    old.close()


def test_the_six_tables_exist(db: sqlite3.Connection) -> None:
    names = {
        row["name"]
        for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    assert {
        "profile",
        "exercise",
        "routine",
        "slot",
        "personal_weight",
        "workout",
    } <= names


def test_foreign_keys_are_enforced(db: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        _ = db.execute(
            "INSERT INTO slot (routine_id, position, exercise_id, reps)"
            " VALUES (99, 0, 99, 5)"
        )


def test_transaction_rolls_back_on_error(db: sqlite3.Connection) -> None:
    with pytest.raises(RuntimeError), transaction(db):
        _ = db.execute("INSERT INTO profile (name) VALUES ('ghost')")
        raise RuntimeError("boom")
    assert db.execute("SELECT count(*) FROM profile").fetchone()[0] == 0
