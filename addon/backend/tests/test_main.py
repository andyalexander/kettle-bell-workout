"""What the app tells Home Assistant on its own, when it starts (#15)."""

import json
import sqlite3
import threading
from dataclasses import replace
from datetime import UTC, datetime

import anyio
import pytest

from kettlebell import workouts
from kettlebell.config import MqttSettings, Settings
from kettlebell.main import create_app
from kettlebell.models import Profile, Routine
from kettlebell.mqtt import Message

pytestmark = pytest.mark.anyio

BROKER = MqttSettings(
    host="core-mosquitto",
    port=1883,
    username=None,
    password=None,
    discovery_prefix="homeassistant",
    ssl=False,
)


async def test_startup_announces_every_profile_that_has_trained(
    tmp_path_settings: Settings,
    db: sqlite3.Connection,
    andrew: Profile,
    emom: Routine,
) -> None:
    workout = workouts.fix_workout(db, andrew.id, emom.id)
    _ = workouts.record_workout(
        db,
        andrew.id,
        workout,
        datetime(2026, 9, 9, 7, 0, tzinfo=UTC),
        datetime(2026, 9, 9, 7, 8, tzinfo=UTC),
    )
    sent: list[Message] = []
    delivered = threading.Event()

    def send(settings: MqttSettings, messages: list[Message]) -> None:
        sent.extend(messages)
        delivered.set()

    app = create_app(replace(tmp_path_settings, mqtt=BROKER), send=send)

    async with app.router.lifespan_context(app):
        # Waited for off the event loop, which has to be free to run the publish.
        assert await anyio.to_thread.run_sync(delivered.wait, 5)

    assert [message.topic for message in sent] == [
        "homeassistant/device/kettlebell_profile_1/config",
        "kettlebell/profile/1/state",
    ]
    # The device page in Home Assistant shows the version the image was built for.
    assert json.loads(sent[0].payload)["device"]["sw_version"] == "9.9.9"


async def test_with_no_broker_nothing_is_sent(tmp_path_settings: Settings) -> None:
    def send(settings: MqttSettings, messages: list[Message]) -> None:
        pytest.fail("no broker is configured, so nothing may be sent")

    app = create_app(tmp_path_settings, send=send)

    async with app.router.lifespan_context(app):
        await anyio.sleep(0.05)
