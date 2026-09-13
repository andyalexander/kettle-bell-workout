"""The routine-editing API, tested only through HTTP (issue #49).

Every assertion is about what the routine editor would see over the wire. Data is
arranged through `store` only where no route exists to arrange it — a second
person's weight, say, which would otherwise need a second editing session.
"""

import sqlite3
from typing import Any

import pytest
from httpx import AsyncClient

from kettlebell import store
from kettlebell.models import Exercise, Profile, Routine

pytestmark = pytest.mark.anyio


@pytest.fixture
def jo(db: sqlite3.Connection) -> Profile:
    """Somebody else who trains the same routines at weights of their own."""
    return store.add_profile(db, "Jo")


async def test_the_library_lists_active_exercises_by_name(
    client: AsyncClient, db: sqlite3.Connection, swing: Exercise, clean: Exercise
) -> None:
    retired = store.add_exercise(db, "Windmill", default_reps=None)
    store.archive_exercise(db, retired.id)

    response = await client.get("/api/exercises")

    assert response.status_code == 200
    assert response.json() == [
        {"id": clean.id, "name": "Double clean"},
        {"id": swing.id, "name": "Two-hand swing"},
    ]


async def test_an_exercise_is_added_by_name_alone(client: AsyncClient) -> None:
    response = await client.post("/api/exercises", json={"name": " Goblet squat "})

    assert response.status_code == 201
    added = {"id": 1, "name": "Goblet squat"}
    assert response.json() == added
    assert (await client.get("/api/exercises")).json() == [added]


@pytest.mark.parametrize("name", ["Two-hand swing", "   "], ids=["taken", "blank"])
async def test_an_exercise_name_must_be_new_and_not_blank(
    client: AsyncClient, swing: Exercise, name: str
) -> None:
    response = await client.post("/api/exercises", json={"name": name})

    assert response.status_code == 422
    assert len((await client.get("/api/exercises")).json()) == 1


async def test_a_routine_is_read_for_editing_with_only_the_editors_weights(
    client: AsyncClient,
    db: sqlite3.Connection,
    andrew: Profile,
    jo: Profile,
    emom: Routine,
) -> None:
    swing_slot, clean_slot = store.list_slots(db, emom.id)
    store.set_weight(db, andrew.id, swing_slot.id, 16)
    store.set_weight(db, jo.id, clean_slot.id, 8)

    response = await client.get(f"/api/profiles/{andrew.id}/routines/{emom.id}")

    assert response.status_code == 200
    assert response.json() == {
        "id": emom.id,
        "name": "Monday",
        "rounds": 4,
        "work_seconds": 60,
        "rest_seconds": 0,
        "slots": [
            {"exercise_id": 1, "exercise_name": "Two-hand swing", "weight": 16.0},
            # Jo's 8 kg is Jo's: Andrew has no weight here.
            {"exercise_id": 2, "exercise_name": "Double clean", "weight": None},
        ],
    }


async def test_editing_an_unknown_routine_or_as_an_unknown_profile_is_not_found(
    client: AsyncClient, andrew: Profile, emom: Routine
) -> None:
    unknown_routine = await client.get(f"/api/profiles/{andrew.id}/routines/99")
    unknown_profile = await client.get(f"/api/profiles/99/routines/{emom.id}")

    assert (unknown_routine.status_code, unknown_profile.status_code) == (404, 404)


def _slot(
    exercise_id: int, *, origin: int | None = None, weight: float | None = None
) -> dict[str, Any]:
    """Build a slot as the editor sends it: its origin, and the editor's weight."""
    return {"exercise_id": exercise_id, "origin": origin, "weight": weight}


def _draft(*slots: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """Build a draft as the editor saves it; a new one starts at 3 × 40 s / 20 s."""
    return {
        "name": "Friday",
        "rounds": 3,
        "work_seconds": 40,
        "rest_seconds": 20,
        "slots": list(slots),
        **changes,
    }


async def test_a_routine_is_created_with_the_creators_weights(
    client: AsyncClient, andrew: Profile, swing: Exercise, clean: Exercise
) -> None:
    response = await client.post(
        f"/api/profiles/{andrew.id}/routines",
        json=_draft(_slot(swing.id, weight=12.5), _slot(clean.id)),
    )

    assert response.status_code == 201
    created = {
        "id": 1,
        "name": "Friday",
        "rounds": 3,
        "work_seconds": 40,
        "rest_seconds": 20,
        "slots": [
            {
                "exercise_id": swing.id,
                "exercise_name": "Two-hand swing",
                "weight": 12.5,
            },
            {"exercise_id": clean.id, "exercise_name": "Double clean", "weight": None},
        ],
    }
    assert response.json() == created
    assert (await client.get(f"/api/profiles/{andrew.id}/routines/1")).json() == created
    listed = (await client.get("/api/routines")).json()
    assert [routine["name"] for routine in listed] == ["Friday"]


@pytest.mark.parametrize(
    "spoiled",
    [
        pytest.param({"name": "Monday"}, id="name-taken"),
        pytest.param({"name": "  "}, id="blank-name"),
        pytest.param({"slots": []}, id="no-slots"),
        pytest.param({"slots": [_slot(99)]}, id="unknown-exercise"),
        pytest.param({"slots": [_slot(1, weight=-4)]}, id="negative-weight"),
        pytest.param({"slots": [_slot(1, origin=0)]}, id="origin-in-a-new-routine"),
        pytest.param({"rounds": 0}, id="no-rounds"),
        pytest.param({"work_seconds": 0}, id="no-work"),
        pytest.param({"rest_seconds": -1}, id="negative-rest"),
    ],
)
async def test_a_routine_that_cannot_be_created_is_refused_and_writes_nothing(
    client: AsyncClient,
    db: sqlite3.Connection,
    andrew: Profile,
    emom: Routine,
    spoiled: dict[str, Any],
) -> None:
    response = await client.post(
        f"/api/profiles/{andrew.id}/routines", json=_draft(_slot(1), **spoiled)
    )

    assert response.status_code == 422
    assert store.list_routines(db) == [emom]


async def _lifts(
    client: AsyncClient, profile: Profile, routine: Routine
) -> list[tuple[str, float | None]]:
    """Read what `profile` would lift, activity by activity, starting it now."""
    fixed = await client.get(
        f"/api/profiles/{profile.id}/routines/{routine.id}/workout"
    )
    return [(a["exercise_name"], a["weight"]) for a in fixed.json()["activities"]]


async def test_saving_changes_the_routine_and_the_editors_own_weights(
    client: AsyncClient,
    db: sqlite3.Connection,
    andrew: Profile,
    emom: Routine,
    swing: Exercise,
    clean: Exercise,
) -> None:
    """Only Andrew has weights, so even a reorder needs no confirming."""
    swing_slot, clean_slot = store.list_slots(db, emom.id)
    store.set_weight(db, andrew.id, swing_slot.id, 16)
    store.set_weight(db, andrew.id, clean_slot.id, 12)

    response = await client.put(
        f"/api/profiles/{andrew.id}/routines/{emom.id}",
        json=_draft(
            _slot(clean.id, origin=1, weight=14),
            _slot(swing.id, origin=0),
            name="Tuesday",
            rounds=5,
        ),
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": emom.id,
        "name": "Tuesday",
        "rounds": 5,
        "work_seconds": 40,
        "rest_seconds": 20,
        "slots": [
            {"exercise_id": clean.id, "exercise_name": "Double clean", "weight": 14.0},
            {
                "exercise_id": swing.id,
                "exercise_name": "Two-hand swing",
                "weight": None,
            },
        ],
    }
    fixed = await client.get(f"/api/profiles/{andrew.id}/routines/{emom.id}/workout")
    # The editor has no reps, so each slot keeps the ones it came with.
    assert [a["reps"] for a in fixed.json()["activities"]] == [5, 10]


async def test_saving_an_unknown_routine_is_not_found(
    client: AsyncClient, andrew: Profile, swing: Exercise
) -> None:
    response = await client.put(
        f"/api/profiles/{andrew.id}/routines/99", json=_draft(_slot(swing.id))
    )

    assert response.status_code == 404


async def test_a_routine_keeps_its_own_name_but_cannot_take_anothers(
    client: AsyncClient, db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    _ = store.add_routine(db, "Friday", rounds=1, work_seconds=60, rest_seconds=0)
    url = f"/api/profiles/{andrew.id}/routines/{emom.id}"

    kept = await client.put(url, json=_draft(_slot(1, origin=0), name="Monday"))
    taken = await client.put(url, json=_draft(_slot(1, origin=0), name="Friday"))

    assert (kept.status_code, taken.status_code) == (200, 422)


@pytest.mark.parametrize(
    "origins", [(0, 0), (0, 2)], ids=["same-origin-twice", "origin-out-of-range"]
)
async def test_a_save_must_place_each_saved_slot_at_most_once(
    client: AsyncClient,
    db: sqlite3.Connection,
    andrew: Profile,
    emom: Routine,
    swing: Exercise,
    origins: tuple[int, int],
) -> None:
    before = store.list_slots(db, emom.id)

    response = await client.put(
        f"/api/profiles/{andrew.id}/routines/{emom.id}",
        json=_draft(*(_slot(swing.id, origin=origin) for origin in origins)),
    )

    assert response.status_code == 422
    assert store.list_slots(db, emom.id) == before


async def test_a_save_that_moves_someone_elses_weight_waits_for_confirming(
    client: AsyncClient,
    db: sqlite3.Connection,
    andrew: Profile,
    jo: Profile,
    emom: Routine,
    swing: Exercise,
    clean: Exercise,
) -> None:
    swing_slot, _ = store.list_slots(db, emom.id)
    store.set_weight(db, jo.id, swing_slot.id, 20)
    url = f"/api/profiles/{andrew.id}/routines/{emom.id}"
    reordered = _draft(_slot(clean.id, origin=1), _slot(swing.id, origin=0))

    refused = await client.put(url, json=reordered)

    assert refused.status_code == 409
    assert refused.json() == {
        "detail": {
            "damage": [
                {
                    "profile_name": "Jo",
                    "position": 0,
                    "exercise_name": "Two-hand swing",
                    "weight": 20.0,
                    "effect": "shifted",
                    "now_exercise_name": "Double clean",
                }
            ]
        }
    }
    assert await _lifts(client, jo, emom) == [
        ("Two-hand swing", 20.0),
        ("Double clean", None),
    ]

    confirmed = await client.put(url, json={**reordered, "confirmed": True})

    assert confirmed.status_code == 200
    # Held at the slot's position: Jo's 20 kg now falls on the clean.
    assert await _lifts(client, jo, emom) == [
        ("Double clean", 20.0),
        ("Two-hand swing", None),
    ]


def _deleted(position: int, exercise_name: str, weight: float) -> dict[str, Any]:
    """One ⚠️ line for a weight of Jo's that the save would delete."""
    return {
        "profile_name": "Jo",
        "position": position,
        "exercise_name": exercise_name,
        "weight": weight,
        "effect": "deleted",
        "now_exercise_name": None,
    }


async def _save_twice(
    client: AsyncClient, url: str, draft: dict[str, Any]
) -> tuple[list[Any], int]:
    """Save as the editor does: learn the damage, then Save anyway."""
    refused = await client.put(url, json=draft)
    assert refused.status_code == 409
    confirmed = await client.put(url, json={**draft, "confirmed": True})
    return refused.json()["detail"]["damage"], confirmed.status_code


async def test_swapping_an_exercise_clears_every_weight_on_its_slot(
    client: AsyncClient,
    db: sqlite3.Connection,
    andrew: Profile,
    jo: Profile,
    emom: Routine,
    clean: Exercise,
) -> None:
    swing_slot, _ = store.list_slots(db, emom.id)
    store.set_weight(db, jo.id, swing_slot.id, 20)
    windmill = store.add_exercise(db, "Windmill", default_reps=None)
    url = f"/api/profiles/{andrew.id}/routines/{emom.id}"

    damage, status = await _save_twice(
        client, url, _draft(_slot(windmill.id, origin=0), _slot(clean.id, origin=1))
    )

    assert damage == [_deleted(0, "Two-hand swing", 20.0)]
    assert status == 200
    assert await _lifts(client, jo, emom) == [
        ("Windmill", None),
        ("Double clean", None),
    ]


async def test_removing_a_slot_deletes_its_weights_and_shifts_those_after_it(
    client: AsyncClient,
    db: sqlite3.Connection,
    andrew: Profile,
    jo: Profile,
    emom: Routine,
    clean: Exercise,
) -> None:
    swing_slot, clean_slot = store.list_slots(db, emom.id)
    store.set_weight(db, jo.id, swing_slot.id, 20)
    store.set_weight(db, jo.id, clean_slot.id, 12)
    url = f"/api/profiles/{andrew.id}/routines/{emom.id}"

    damage, status = await _save_twice(client, url, _draft(_slot(clean.id, origin=1)))

    # The clean moves up into the swing's position, and so under its 20 kg.
    assert damage == [
        {
            "profile_name": "Jo",
            "position": 0,
            "exercise_name": "Two-hand swing",
            "weight": 20.0,
            "effect": "shifted",
            "now_exercise_name": "Double clean",
        },
        _deleted(1, "Double clean", 12.0),
    ]
    assert status == 200
    assert await _lifts(client, jo, emom) == [("Double clean", 20.0)]


async def test_a_new_slot_has_no_weight_for_anyone(
    client: AsyncClient,
    db: sqlite3.Connection,
    andrew: Profile,
    jo: Profile,
    emom: Routine,
    swing: Exercise,
) -> None:
    """Even where it lands on a position that held somebody's weight."""
    _, clean_slot = store.list_slots(db, emom.id)
    store.set_weight(db, jo.id, clean_slot.id, 12)
    url = f"/api/profiles/{andrew.id}/routines/{emom.id}"

    damage, status = await _save_twice(
        client, url, _draft(_slot(swing.id, origin=0), _slot(swing.id))
    )

    assert damage == [_deleted(1, "Double clean", 12.0)]
    assert status == 200
    assert await _lifts(client, jo, emom) == [
        ("Two-hand swing", None),
        ("Two-hand swing", None),
    ]


async def test_deleting_a_routine_waits_for_confirming_and_keeps_its_history(
    client: AsyncClient,
    db: sqlite3.Connection,
    andrew: Profile,
    jo: Profile,
    emom: Routine,
) -> None:
    swing_slot, _ = store.list_slots(db, emom.id)
    store.set_weight(db, andrew.id, swing_slot.id, 16)
    store.set_weight(db, jo.id, swing_slot.id, 20)
    fixed = await client.get(f"/api/profiles/{andrew.id}/routines/{emom.id}/workout")
    finish = {
        "profile_id": andrew.id,
        "started_at": "2026-09-09T07:00:00.000Z",
        "ended_at": "2026-09-09T07:08:00.000Z",
        **fixed.json(),
    }
    assert (await client.post("/api/workouts", json=finish)).status_code == 201
    url = f"/api/profiles/{andrew.id}/routines/{emom.id}"

    refused = await client.delete(url)

    assert refused.status_code == 409
    # Andrew's own 16 kg goes too, but he is the one deleting it.
    assert refused.json()["detail"]["damage"] == [_deleted(0, "Two-hand swing", 20.0)]
    assert (await client.get(url)).status_code == 200

    confirmed = await client.delete(url, params={"confirmed": True})

    assert confirmed.status_code == 204
    assert (await client.get(url)).status_code == 404
    assert (await client.get("/api/routines")).json() == []
    # A repeat finish finds the recorded workout: deleting its routine kept it.
    repeat = await client.post("/api/workouts", json=finish)
    assert (repeat.status_code, repeat.json()) == (200, {"id": 1})


async def test_a_routine_nobody_else_has_weights_on_is_deleted_at_once(
    client: AsyncClient, andrew: Profile, emom: Routine
) -> None:
    url = f"/api/profiles/{andrew.id}/routines/{emom.id}"

    deleted = await client.delete(url)
    unknown = await client.delete(url)

    assert (deleted.status_code, unknown.status_code) == (204, 404)
