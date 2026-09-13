import sqlite3

import pytest

from kettlebell import store
from kettlebell.models import Exercise, Profile, Routine


def test_a_new_profile_is_faceless(db: sqlite3.Connection) -> None:
    profile = store.add_profile(db, "Andrew")
    assert profile.avatar_mime is None
    assert store.list_profiles(db) == [profile]


def test_avatar_bytes_round_trip(db: sqlite3.Connection, andrew: Profile) -> None:
    store.set_avatar(db, andrew.id, b"\x00webp-bytes", "image/webp")
    assert store.get_avatar(db, andrew.id) == (b"\x00webp-bytes", "image/webp")

    store.set_avatar(db, andrew.id, None, None)
    assert store.get_avatar(db, andrew.id) is None


def test_avatar_bytes_and_mime_travel_together(
    db: sqlite3.Connection, andrew: Profile
) -> None:
    with pytest.raises(ValueError):
        store.set_avatar(db, andrew.id, b"bytes", None)


def test_archived_exercises_leave_the_library(
    db: sqlite3.Connection, swing: Exercise, clean: Exercise
) -> None:
    store.archive_exercise(db, clean.id)
    assert [exercise.id for exercise in store.list_exercises(db)] == [swing.id]
    assert len(store.list_exercises(db, include_archived=True)) == 2

    # Archiving is reversible, and never deletes the row the names come from.
    stored = store.get_exercise(db, clean.id)
    assert stored is not None and stored.archived is True


def test_slot_positions_are_unique_within_a_routine(
    db: sqlite3.Connection, emom: Routine
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        _ = db.execute(
            "INSERT INTO slot (routine_id, position, exercise_id, reps)"
            " SELECT routine_id, position, exercise_id, reps"
            " FROM slot WHERE routine_id = ? LIMIT 1",
            (emom.id,),
        )


def test_the_same_exercise_may_fill_several_slots(
    db: sqlite3.Connection, swing: Exercise
) -> None:
    routine = store.add_routine(
        db, "Ladder", rounds=3, work_seconds=40, rest_seconds=20
    )
    slots = store.set_slots(
        db,
        routine.id,
        [
            store.SlotSpec(exercise_id=swing.id, reps=10),
            store.SlotSpec(exercise_id=swing.id, reps=8),
        ],
    )
    assert [slot.position for slot in slots] == [0, 1]
    assert {slot.exercise_id for slot in slots} == {swing.id}


def test_editing_slots_keeps_ids_and_therefore_personal_weights(
    db: sqlite3.Connection, andrew: Profile, emom: Routine, swing: Exercise
) -> None:
    first, second = store.list_slots(db, emom.id)
    store.set_weight(db, andrew.id, first.id, 32)

    # Editing the reps in place must not cost Andrew his personal weight.
    edited = store.set_slots(
        db,
        emom.id,
        [
            store.SlotSpec(exercise_id=swing.id, reps=15),
            store.SlotSpec(exercise_id=second.exercise_id, reps=second.reps),
        ],
    )
    assert edited[0].id == first.id
    assert edited[0].reps == 15
    assert store.list_weights(db, andrew.id, emom.id) == {first.id: 32.0}


def test_shortening_a_routine_drops_the_trailing_slots(
    db: sqlite3.Connection, emom: Routine, swing: Exercise
) -> None:
    kept = store.set_slots(db, emom.id, [store.SlotSpec(exercise_id=swing.id, reps=10)])
    assert len(kept) == 1
    assert len(store.list_slots(db, emom.id)) == 1


def test_a_personal_weight_is_one_weight_per_profile_and_slot(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    slot = store.list_slots(db, emom.id)[0]
    store.set_weight(db, andrew.id, slot.id, 28)
    store.set_weight(db, andrew.id, slot.id, 32)
    assert store.list_weights(db, andrew.id, emom.id) == {slot.id: 32.0}

    # Clearing leaves no weight at all: there is nothing shared to fall back to.
    store.clear_weight(db, andrew.id, slot.id)
    assert store.list_weights(db, andrew.id, emom.id) == {}


def test_a_routine_starts_with_no_weights_for_anyone(
    db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    assert store.list_weights(db, andrew.id, emom.id) == {}
