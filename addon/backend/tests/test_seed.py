import sqlite3

from kettlebell import seed, store


def test_seeding_an_empty_database_gives_something_trainable(
    db: sqlite3.Connection,
) -> None:
    seed.seed(db)

    exercises = store.list_exercises(db)
    assert [exercise.name for exercise in exercises] == sorted(
        candidate.name for candidate in seed.SEED_EXERCISES
    )
    assert all(exercise.default_reps is None for exercise in exercises)

    routines = store.list_routines(db)
    assert len(routines) == 1
    routine = routines[0]
    assert (routine.rounds, routine.work_seconds, routine.rest_seconds) == (3, 40, 20)

    slots = store.list_slots(db, routine.id)
    assert len(slots) == len(seed.SEED_EXERCISES)
    assert all(slot.reps is None for slot in slots)


def test_the_starter_routine_is_exactly_fifteen_minutes(db: sqlite3.Connection) -> None:
    """The shape Andrew asked for: five slots, three rounds, 40s work, 20s rest."""
    seed.seed(db)
    routine = store.list_routines(db)[0]
    turns = routine.rounds * len(store.list_slots(db, routine.id))
    assert turns * (routine.work_seconds + routine.rest_seconds) == 15 * 60


def test_slots_follow_the_order_the_exercises_are_seeded_in(
    db: sqlite3.Connection,
) -> None:
    seed.seed(db)
    routine = store.list_routines(db)[0]
    by_id = {exercise.id: exercise.name for exercise in store.list_exercises(db)}
    ordered = [by_id[slot.exercise_id] for slot in store.list_slots(db, routine.id)]
    assert ordered == list(seed.STARTER_ROUTINE.exercise_names)


def test_seeding_twice_changes_nothing(db: sqlite3.Connection) -> None:
    seed.seed(db)
    before = (store.list_exercises(db), store.list_routines(db))
    seed.seed(db)
    assert (store.list_exercises(db), store.list_routines(db)) == before


def test_seeding_never_resurrects_an_archived_exercise(
    db: sqlite3.Connection,
) -> None:
    """Seeding is not a migration: what the user retires stays retired."""
    seed.seed(db)
    victim = store.list_exercises(db)[0]
    store.archive_exercise(db, victim.id)

    seed.seed(db)

    assert victim.name not in {e.name for e in store.list_exercises(db)}
    assert len(store.list_exercises(db, include_archived=True)) == len(
        seed.SEED_EXERCISES
    )


def test_seeding_leaves_an_edited_starter_routine_alone(
    db: sqlite3.Connection,
) -> None:
    """Rewriting slots would discard edits and could strand a weight override."""
    seed.seed(db)
    routine = store.list_routines(db)[0]
    kept = store.list_slots(db, routine.id)[0]
    _ = store.set_slots(
        db,
        routine.id,
        [store.SlotSpec(exercise_id=kept.exercise_id, reps=12, weight=99.0)],
    )

    seed.seed(db)

    slots = store.list_slots(db, routine.id)
    assert len(slots) == 1
    assert slots[0].id == kept.id
    assert slots[0].reps == 12
    assert slots[0].weight == 99.0
