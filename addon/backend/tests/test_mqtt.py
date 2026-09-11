"""Publishing to Home Assistant, observed at the broker's edge (#6, #15).

`send` stands in for the broker: every test asserts on the messages handed to
it, which is exactly what Home Assistant would receive.
"""

import json
import sqlite3
from datetime import UTC, datetime

import pytest

from kettlebell import __version__, store, workouts
from kettlebell.config import MqttSettings, Settings
from kettlebell.models import Profile, RecordedWorkout, Routine
from kettlebell.mqtt import Message, Publisher

BROKER = MqttSettings(
    host="core-mosquitto",
    port=1883,
    username=None,
    password=None,
    discovery_prefix="homeassistant",
    ssl=False,
)

type Sent = list[tuple[MqttSettings, list[Message]]]


@pytest.fixture
def sent() -> Sent:
    """Every call to the broker, in order: one entry per connection."""
    return []


@pytest.fixture
def publisher(tmp_path_settings: Settings, sent: Sent) -> Publisher:
    return Publisher(
        BROKER,
        tmp_path_settings.database_path,
        send=lambda settings, messages: sent.append((settings, messages)),
    )


def train(
    db: sqlite3.Connection, profile: Profile, routine: Routine, day: int
) -> RecordedWorkout:
    """Record `routine` as `profile` performed it on the morning of `day`."""
    started = datetime(2026, 9, day, 7, 0, tzinfo=UTC)
    ended = datetime(2026, 9, day, 7, 8, 10, 250_000, tzinfo=UTC)
    workout = workouts.fix_workout(db, profile.id, routine.id)
    return workouts.record_workout(db, profile.id, workout, started, ended)


def test_a_recorded_workout_sends_discovery_then_state_retained_on_one_connection(
    publisher: Publisher,
    sent: Sent,
    db: sqlite3.Connection,
    andrew: Profile,
    emom: Routine,
) -> None:
    publisher.announce(train(db, andrew, emom, day=9))

    [(settings, messages)] = sent
    assert settings == BROKER
    assert [(m.topic, m.qos, m.retain) for m in messages] == [
        ("homeassistant/device/kettlebell_profile_1/config", 1, True),
        ("kettlebell/profile/1/state", 1, True),
    ]


def test_state_is_the_profiles_own_lifetime_figures(
    publisher: Publisher,
    sent: Sent,
    db: sqlite3.Connection,
    andrew: Profile,
    emom: Routine,
) -> None:
    guest = store.add_profile(db, "Guest")
    _ = train(db, guest, emom, day=8)
    _ = train(db, andrew, emom, day=8)

    publisher.announce(train(db, andrew, emom, day=9))

    [(_, [_, state])] = sent
    # Monday is 2 activities x 4 rounds x 60 s of work: 480 s a time, rest-less.
    assert json.loads(state.payload) == {
        "last_workout": "2026-09-09T07:08:10.250+00:00",
        "last_routine": "Monday",
        "last_duration": 480,
        "workouts": 2,
        "training_time": 960,
    }


def test_startup_announces_every_profile_that_has_trained_on_one_connection(
    publisher: Publisher,
    sent: Sent,
    db: sqlite3.Connection,
    andrew: Profile,
    emom: Routine,
) -> None:
    _ = store.add_profile(db, "Guest")
    beth = store.add_profile(db, "Beth")
    _ = train(db, andrew, emom, day=8)
    _ = train(db, beth, emom, day=9)

    publisher.announce_everyone()

    [(_, messages)] = sent
    # Guest (id 2) has never trained, so has no device yet.
    assert [m.topic for m in messages] == [
        "homeassistant/device/kettlebell_profile_1/config",
        "kettlebell/profile/1/state",
        "homeassistant/device/kettlebell_profile_3/config",
        "kettlebell/profile/3/state",
    ]


def test_a_broker_that_fails_is_logged_never_raised(
    tmp_path_settings: Settings,
    db: sqlite3.Connection,
    andrew: Profile,
    emom: Routine,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def refuse(settings: MqttSettings, messages: list[Message]) -> None:
        raise ConnectionRefusedError("broker down")

    publisher = Publisher(BROKER, tmp_path_settings.database_path, send=refuse)

    publisher.announce(train(db, andrew, emom, day=9))

    assert "Could not publish profile 1 to MQTT" in caplog.text
    assert "broker down" in caplog.text


def test_discovery_is_one_device_per_profile_with_the_five_sensors(
    publisher: Publisher,
    sent: Sent,
    db: sqlite3.Connection,
    andrew: Profile,
    emom: Routine,
) -> None:
    publisher.announce(train(db, andrew, emom, day=9))

    [(_, [discovery, _])] = sent
    assert json.loads(discovery.payload) == {
        "device": {
            "identifiers": ["kettlebell_profile_1"],
            "name": "Kettlebell Andrew",
            "manufacturer": "Kettlebell Trainer",
            "model": "Training profile",
            "sw_version": __version__,
        },
        "origin": {
            "name": "Kettlebell Trainer",
            "sw_version": __version__,
            "support_url": "https://github.com/andyalexander/kettle-bell-workout",
        },
        "state_topic": "kettlebell/profile/1/state",
        "qos": 1,
        "components": {
            "last_workout": {
                "platform": "sensor",
                "name": "Last workout",
                "unique_id": "kettlebell_profile_1_last_workout",
                "device_class": "timestamp",
                "icon": "mdi:clock-start",
                "value_template": "{{ value_json.last_workout }}",
            },
            "last_routine": {
                "platform": "sensor",
                "name": "Last routine",
                "unique_id": "kettlebell_profile_1_last_routine",
                "icon": "mdi:kettlebell",
                "value_template": "{{ value_json.last_routine }}",
            },
            "last_duration": {
                "platform": "sensor",
                "name": "Last workout effort duration",
                "unique_id": "kettlebell_profile_1_last_duration",
                "device_class": "duration",
                "state_class": "measurement",
                "unit_of_measurement": "s",
                "suggested_display_precision": 0,
                "icon": "mdi:timer-outline",
                "value_template": "{{ value_json.last_duration }}",
            },
            "workouts": {
                "platform": "sensor",
                "name": "Workouts",
                "unique_id": "kettlebell_profile_1_workouts",
                "state_class": "total",
                "icon": "mdi:calendar-check",
                "value_template": "{{ value_json.workouts }}",
            },
            "training_time": {
                "platform": "sensor",
                "name": "Training time",
                "unique_id": "kettlebell_profile_1_training_time",
                "device_class": "duration",
                "state_class": "total",
                "unit_of_measurement": "s",
                "suggested_display_precision": 0,
                "icon": "mdi:arm-flex",
                "value_template": "{{ value_json.training_time }}",
            },
        },
    }
