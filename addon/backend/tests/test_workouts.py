import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from kettlebell import store, workouts
from kettlebell.models import Exercise, Profile, Routine

STARTED = datetime(2026, 9, 9, 7, 0, tzinfo=UTC)
ENDED = STARTED + timedelta(minutes=8)


def test_a_workout_resolves_the_profiles_own_weight(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    slot = store.list_slots(db, emom.id)[0]
    store.set_weight_override(db, andrew.id, slot.id, 32)

    workout = workouts.fix_workout(db, andrew.id, emom.id)
    assert [activity.weight for activity in workout.activities] == [32.0, 20.0]
    assert workout.routine_name == "Monday"
    assert (workout.work_seconds, workout.rest_seconds) == (60, 0)


def test_one_routine_fixes_differently_per_profile(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    someone_else = store.add_profile(db, "Guest")
    slot = store.list_slots(db, emom.id)[0]
    store.set_weight_override(db, andrew.id, slot.id, 32)

    mine = workouts.fix_workout(db, andrew.id, emom.id)
    theirs = workouts.fix_workout(db, someone_else.id, emom.id)
    assert mine.activities[0].weight == 32.0
    assert theirs.activities[0].weight == 24.0


def test_totals_fold_over_every_turn(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    workout = workouts.fix_workout(db, andrew.id, emom.id)
    # 4 rounds x 2 activities = 8 turns, each a 60-second work window.
    assert workout.turns == 8
    assert workout.time_under_load == 480


def test_a_recorded_workout_survives_editing_the_routine(
    db: sqlite3.Connection, andrew: Profile, emom: Routine, swing: Exercise
) -> None:
    workout = workouts.fix_workout(db, andrew.id, emom.id)
    recorded = workouts.record_workout(db, andrew.id, workout, STARTED, ENDED)

    store.update_exercise(
        db, swing.id, name="Renamed swing", default_reps=10, default_weight=24
    )
    store.archive_exercise(db, swing.id)
    _ = store.set_slots(
        db, emom.id, [store.SlotSpec(exercise_id=swing.id, reps=100, weight=48)]
    )

    stored = workouts.get_workout(db, recorded.id)
    assert stored is not None
    assert stored.workout == workout
    assert stored.workout.activities[0].exercise_name == "Two-hand swing"
    assert stored.workout.time_under_load == 480


def test_history_survives_deleting_the_routine(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    workout = workouts.fix_workout(db, andrew.id, emom.id)
    recorded = workouts.record_workout(db, andrew.id, workout, STARTED, ENDED)

    _ = db.execute("DELETE FROM routine WHERE id = ?", (emom.id,))

    stored = workouts.get_workout(db, recorded.id)
    assert stored is not None and stored.workout.routine_name == "Monday"


def test_timestamps_round_trip_as_utc(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    workout = workouts.fix_workout(db, andrew.id, emom.id)
    recorded = workouts.record_workout(db, andrew.id, workout, STARTED, ENDED)

    stored = workouts.get_workout(db, recorded.id)
    assert stored is not None
    assert stored.started_at == STARTED
    assert stored.duration_seconds == 480.0
    raw = db.execute(
        "SELECT started_at FROM workout WHERE id = ?", (recorded.id,)
    ).fetchone()
    assert str(raw["started_at"]).endswith("+00:00")


def test_naive_timestamps_are_refused(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    workout = workouts.fix_workout(db, andrew.id, emom.id)
    with pytest.raises(ValueError):
        _ = workouts.record_workout(
            db, andrew.id, workout, STARTED.replace(tzinfo=None), ENDED
        )


def test_workouts_list_newest_first_per_profile(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    guest = store.add_profile(db, "Guest")
    workout = workouts.fix_workout(db, andrew.id, emom.id)
    older = workouts.record_workout(db, andrew.id, workout, STARTED, ENDED)
    newer = workouts.record_workout(
        db, andrew.id, workout, STARTED + timedelta(days=1), ENDED
    )
    _ = workouts.record_workout(db, guest.id, workout, STARTED, ENDED)

    mine = workouts.list_workouts(db, andrew.id)
    assert [recorded.id for recorded in mine] == [newer.id, older.id]
    assert len(workouts.list_workouts(db)) == 3
    assert len(workouts.list_workouts(db, andrew.id, limit=1)) == 1


def test_a_routine_without_slots_cannot_be_started(
    db: sqlite3.Connection, andrew: Profile
) -> None:
    empty = store.add_routine(db, "Empty", rounds=3, work_seconds=60, rest_seconds=0)
    with pytest.raises(LookupError):
        _ = workouts.fix_workout(db, andrew.id, empty.id)
    with pytest.raises(LookupError):
        _ = workouts.fix_workout(db, andrew.id, 9999)


def test_a_repless_workout_survives_the_round_trip(
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

    workout = workouts.fix_workout(db, andrew.id, routine.id)
    assert workout.activities[0].reps is None

    recorded = workouts.record_workout(db, andrew.id, workout, STARTED, ENDED)
    stored = workouts.get_workout(db, recorded.id)
    assert stored is not None
    assert stored.workout == workout
    assert stored.workout.time_under_load == 120
