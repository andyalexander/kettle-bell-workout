import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from kettlebell import sessions, store
from kettlebell.models import Exercise, Profile, Routine

STARTED = datetime(2026, 9, 9, 7, 0, tzinfo=UTC)
ENDED = STARTED + timedelta(minutes=8)


def test_a_prescription_resolves_the_profiles_own_weight(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    slot = store.list_slots(db, emom.id)[0]
    store.set_weight_override(db, andrew.id, slot.id, 32)

    prescription = sessions.freeze_prescription(db, andrew.id, emom.id)
    assert [item.weight for item in prescription.slots] == [32.0, 20.0]
    assert prescription.routine_name == "Monday"
    assert (prescription.work_seconds, prescription.rest_seconds) == (60, 0)


def test_one_routine_prescribes_differently_per_profile(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    someone_else = store.add_profile(db, "Guest")
    slot = store.list_slots(db, emom.id)[0]
    store.set_weight_override(db, andrew.id, slot.id, 32)

    mine = sessions.freeze_prescription(db, andrew.id, emom.id)
    theirs = sessions.freeze_prescription(db, someone_else.id, emom.id)
    assert mine.slots[0].weight == 32.0
    assert theirs.slots[0].weight == 24.0


def test_totals_fold_over_every_turn(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    prescription = sessions.freeze_prescription(db, andrew.id, emom.id)
    # 4 rounds x 2 slots = 8 turns, each a 60-second work window.
    assert prescription.turns == 8
    assert prescription.time_under_load == 480


def test_a_recorded_session_survives_editing_the_routine(
    db: sqlite3.Connection, andrew: Profile, emom: Routine, swing: Exercise
) -> None:
    prescription = sessions.freeze_prescription(db, andrew.id, emom.id)
    recorded = sessions.record_session(db, andrew.id, prescription, STARTED, ENDED)

    store.update_exercise(
        db, swing.id, name="Renamed swing", default_reps=10, default_weight=24
    )
    store.archive_exercise(db, swing.id)
    _ = store.set_slots(
        db, emom.id, [store.SlotSpec(exercise_id=swing.id, reps=100, weight=48)]
    )

    stored = sessions.get_session(db, recorded.id)
    assert stored is not None
    assert stored.prescription == prescription
    assert stored.prescription.slots[0].exercise_name == "Two-hand swing"
    assert stored.prescription.time_under_load == 480


def test_history_survives_deleting_the_routine(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    prescription = sessions.freeze_prescription(db, andrew.id, emom.id)
    recorded = sessions.record_session(db, andrew.id, prescription, STARTED, ENDED)

    _ = db.execute("DELETE FROM routine WHERE id = ?", (emom.id,))

    stored = sessions.get_session(db, recorded.id)
    assert stored is not None and stored.prescription.routine_name == "Monday"


def test_timestamps_round_trip_as_utc(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    prescription = sessions.freeze_prescription(db, andrew.id, emom.id)
    recorded = sessions.record_session(db, andrew.id, prescription, STARTED, ENDED)

    stored = sessions.get_session(db, recorded.id)
    assert stored is not None
    assert stored.started_at == STARTED
    assert stored.duration_seconds == 480.0
    raw = db.execute(
        "SELECT started_at FROM session WHERE id = ?", (recorded.id,)
    ).fetchone()
    assert str(raw["started_at"]).endswith("+00:00")


def test_naive_timestamps_are_refused(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    prescription = sessions.freeze_prescription(db, andrew.id, emom.id)
    with pytest.raises(ValueError):
        _ = sessions.record_session(
            db, andrew.id, prescription, STARTED.replace(tzinfo=None), ENDED
        )


def test_sessions_list_newest_first_per_profile(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    guest = store.add_profile(db, "Guest")
    prescription = sessions.freeze_prescription(db, andrew.id, emom.id)
    older = sessions.record_session(db, andrew.id, prescription, STARTED, ENDED)
    newer = sessions.record_session(
        db, andrew.id, prescription, STARTED + timedelta(days=1), ENDED
    )
    _ = sessions.record_session(db, guest.id, prescription, STARTED, ENDED)

    mine = sessions.list_sessions(db, andrew.id)
    assert [session.id for session in mine] == [newer.id, older.id]
    assert len(sessions.list_sessions(db)) == 3
    assert len(sessions.list_sessions(db, andrew.id, limit=1)) == 1


def test_a_routine_without_slots_cannot_be_started(
    db: sqlite3.Connection, andrew: Profile
) -> None:
    empty = store.add_routine(db, "Empty", rounds=3, work_seconds=60, rest_seconds=0)
    with pytest.raises(LookupError):
        _ = sessions.freeze_prescription(db, andrew.id, empty.id)
    with pytest.raises(LookupError):
        _ = sessions.freeze_prescription(db, andrew.id, 9999)


def test_a_repless_prescription_survives_the_round_trip(
    db: sqlite3.Connection, andrew: Profile
) -> None:
    """Reps are optional end to end — through the join, the JSON and back."""
    carry = store.add_exercise(
        db, "Farmer's carry", default_reps=None, default_weight=16
    )
    routine = store.add_routine(
        db, "Carries", rounds=3, work_seconds=40, rest_seconds=20
    )
    _ = store.set_slots(
        db, routine.id, [store.SlotSpec(exercise_id=carry.id, reps=None, weight=16)]
    )

    prescription = sessions.freeze_prescription(db, andrew.id, routine.id)
    assert prescription.slots[0].reps is None

    recorded = sessions.record_session(db, andrew.id, prescription, STARTED, ENDED)
    stored = sessions.get_session(db, recorded.id)
    assert stored is not None
    assert stored.prescription == prescription
    assert stored.prescription.time_under_load == 120
