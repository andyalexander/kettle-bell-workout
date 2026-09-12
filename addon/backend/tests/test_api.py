"""The workout-flow API, tested only through HTTP (ADR-0003, issue #18).

Data is arranged through `store` — the builder API does not exist yet — but every
assertion is about what the iPad would see over the wire.
"""

import sqlite3
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from kettlebell import store
from kettlebell.config import Settings
from kettlebell.main import create_app
from kettlebell.models import Profile, RecordedWorkout, Routine
from kettlebell.seed import seed

pytestmark = pytest.mark.anyio

# As the iPad stamps them: UTC, to the millisecond.
STARTED = "2026-09-09T07:00:00.000Z"
ENDED = "2026-09-09T07:08:10.250Z"


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


async def test_profiles_list_by_name(
    client: AsyncClient, db: sqlite3.Connection
) -> None:
    _ = store.add_profile(db, "Guest")
    _ = store.add_profile(db, "Andrew")

    response = await client.get("/api/profiles")

    assert response.status_code == 200
    assert response.json() == [
        {"id": 2, "name": "Andrew", "avatar_url": None},
        {"id": 1, "name": "Guest", "avatar_url": None},
    ]


async def test_a_profile_is_created_from_a_name_alone(client: AsyncClient) -> None:
    response = await client.post("/api/profiles", json={"name": "Andrew"})

    assert response.status_code == 201
    created = {"id": 1, "name": "Andrew", "avatar_url": None}
    assert response.json() == created
    assert (await client.get("/api/profiles")).json() == [created]


async def test_a_blank_name_is_refused(client: AsyncClient) -> None:
    response = await client.post("/api/profiles", json={"name": "   "})

    assert response.status_code == 422
    assert (await client.get("/api/profiles")).json() == []


async def test_a_name_already_taken_is_refused(client: AsyncClient) -> None:
    _ = await client.post("/api/profiles", json={"name": "Andrew"})

    response = await client.post("/api/profiles", json={"name": "Andrew"})

    assert response.status_code == 422
    assert len((await client.get("/api/profiles")).json()) == 1


async def test_routines_list_with_their_length_and_exercises(
    client: AsyncClient, db: sqlite3.Connection
) -> None:
    seed(db)

    response = await client.get("/api/routines")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": 1,
            "name": "Starter circuit",
            "rounds": 3,
            "work_seconds": 40,
            "rest_seconds": 20,
            # Fifteen minutes exactly, as #10 set it: prep is not part of a workout.
            "total_seconds": 900,
            "exercise_names": [
                "Thruster",
                "Single-arm row",
                "Farmer's carry",
                "Halo",
                "Two-hand swing",
            ],
        }
    ]


async def test_a_routine_with_no_slots_is_not_offered(
    client: AsyncClient, db: sqlite3.Connection
) -> None:
    seed(db)
    _ = store.add_routine(db, "Empty", rounds=3, work_seconds=60, rest_seconds=0)

    response = await client.get("/api/routines")

    assert [routine["name"] for routine in response.json()] == ["Starter circuit"]


async def test_starting_a_workout_resolves_the_profiles_own_weights(
    client: AsyncClient, db: sqlite3.Connection, andrew: Profile, emom: Routine
) -> None:
    swing_slot = store.list_slots(db, emom.id)[0]
    store.set_weight_override(db, andrew.id, swing_slot.id, 32)

    response = await client.get(f"/api/profiles/{andrew.id}/routines/{emom.id}/workout")

    assert response.status_code == 200
    assert response.json() == {
        "routine_id": 1,
        "routine_name": "Monday",
        "rounds": 4,
        "work_seconds": 60,
        "rest_seconds": 0,
        "activities": [
            {
                "position": 0,
                "exercise_id": 1,
                "exercise_name": "Two-hand swing",
                "reps": 10,
                "weight": 32.0,
            },
            {
                "position": 1,
                "exercise_id": 2,
                "exercise_name": "Double clean",
                "reps": 5,
                "weight": 20.0,
            },
        ],
    }


async def test_a_routine_that_cannot_be_started_is_not_found(
    client: AsyncClient, db: sqlite3.Connection, andrew: Profile
) -> None:
    empty = store.add_routine(db, "Empty", rounds=3, work_seconds=60, rest_seconds=0)

    unknown = await client.get(f"/api/profiles/{andrew.id}/routines/99/workout")
    slotless = await client.get(
        f"/api/profiles/{andrew.id}/routines/{empty.id}/workout"
    )

    assert (unknown.status_code, slotless.status_code) == (404, 404)


async def test_a_workout_for_an_unknown_profile_is_not_found(
    client: AsyncClient, emom: Routine
) -> None:
    response = await client.get(f"/api/profiles/99/routines/{emom.id}/workout")

    assert response.status_code == 404


async def _finish(
    client: AsyncClient,
    profile_id: int,
    routine_id: int,
    *,
    started_at: str = STARTED,
    ended_at: str = ENDED,
) -> dict[str, Any]:
    """Do what the iPad does: fix a workout, then send it back as received."""
    fixed = await client.get(
        f"/api/profiles/{profile_id}/routines/{routine_id}/workout"
    )
    return {
        "profile_id": profile_id,
        "started_at": started_at,
        "ended_at": ended_at,
        **fixed.json(),
    }


async def test_finishing_records_the_workout(
    client: AsyncClient, andrew: Profile, emom: Routine
) -> None:
    response = await client.post(
        "/api/workouts", json=await _finish(client, andrew.id, emom.id)
    )

    assert response.status_code == 201
    assert response.json() == {"id": 1}


async def test_a_retried_finish_writes_nothing_and_answers_with_the_same_id(
    client: AsyncClient, andrew: Profile, emom: Routine
) -> None:
    finish = await _finish(client, andrew.id, emom.id)
    _ = await client.post("/api/workouts", json=finish)

    retry = await client.post("/api/workouts", json=finish)
    later = await client.post(
        "/api/workouts",
        json=await _finish(
            client,
            andrew.id,
            emom.id,
            started_at="2026-09-09T18:00:00.000Z",
            ended_at="2026-09-09T18:08:00.000Z",
        ),
    )

    assert (retry.status_code, retry.json()) == (200, {"id": 1})
    # Had the retry written a row, this would be the third.
    assert later.json() == {"id": 2}


async def test_only_a_newly_recorded_workout_is_published(
    client: AsyncClient,
    published: list[RecordedWorkout],
    andrew: Profile,
    emom: Routine,
) -> None:
    finish = await _finish(client, andrew.id, emom.id)

    _ = await client.post("/api/workouts", json=finish)
    _ = await client.post("/api/workouts", json=finish)

    assert [
        (workout.id, workout.profile_id, workout.workout.routine_name)
        for workout in published
    ] == [(1, andrew.id, "Monday")]
    # From 07:00:00.000 to 07:08:10.250 — the iPad's own stamps, both kept.
    assert published[0].duration_seconds == 490.25


@pytest.mark.parametrize(
    "spoiled",
    [
        pytest.param({"started_at": "2026-09-09T07:00:00.000"}, id="naive"),
        pytest.param({"ended_at": "2026-09-09T06:59:00.000Z"}, id="ends-before-start"),
        pytest.param({"ended_at": STARTED}, id="ends-as-it-starts"),
        pytest.param(
            {
                "started_at": "2999-01-01T07:00:00.000Z",
                "ended_at": "2999-01-01T07:08:00.000Z",
            },
            id="in-the-future",
        ),
        pytest.param({"profile_id": 99}, id="unknown-profile"),
        pytest.param({"activities": []}, id="no-activities"),
    ],
)
async def test_a_finish_that_cannot_be_true_is_refused_and_writes_nothing(
    client: AsyncClient,
    published: list[RecordedWorkout],
    andrew: Profile,
    emom: Routine,
    spoiled: dict[str, Any],
) -> None:
    finish = await _finish(client, andrew.id, emom.id)

    refused = await client.post("/api/workouts", json={**finish, **spoiled})
    valid = await client.post("/api/workouts", json=finish)

    assert refused.status_code == 422
    # Only the valid finish reached the database, and so only it was published.
    assert (valid.status_code, valid.json()) == (201, {"id": 1})
    assert [workout.id for workout in published] == [1]
