"""Publishing each profile's progress to Home Assistant over MQTT (#6).

One HA device per profile, announced by device-based discovery, fed by one
retained JSON state document. Every message is retained, so Home Assistant has
the values back after a restart without the app being asked.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC
from pathlib import Path
from typing import NamedTuple

from paho.mqtt.client import Client
from paho.mqtt.enums import CallbackAPIVersion

from kettlebell import __version__, store, workouts
from kettlebell.config import MqttSettings
from kettlebell.db import connect
from kettlebell.metrics import ProfileProgress, profile_progress
from kettlebell.models import Profile, RecordedWorkout

__all__ = ["Message", "Publisher", "Send", "send_to_broker"]

LOGGER = logging.getLogger(__name__)

APP_NAME = "Kettlebell Trainer"
SUPPORT_URL = "https://github.com/andyalexander/kettle-bell-workout"
KEEPALIVE_SECONDS = 15
ACK_TIMEOUT_SECONDS = 10.0

# The five sensors, keyed by discovery id — which is also the state document's key.
# No `default_entity_id`: HA names entities from device and sensor name, which gives
# the same ids and suffixes a collision the way it does for every integration.
SENSORS: Mapping[str, Mapping[str, str]] = {
    "last_workout": {
        "name": "Last workout",
        "device_class": "timestamp",
        "icon": "mdi:clock-start",
    },
    "last_routine": {"name": "Last routine", "icon": "mdi:kettlebell"},
    "last_duration": {
        "name": "Last workout duration",
        "device_class": "duration",
        "state_class": "measurement",
        "unit_of_measurement": "s",
        "suggested_unit_of_measurement": "min",
        "icon": "mdi:timer-outline",
    },
    "workouts": {
        "name": "Workouts",
        "state_class": "total",
        "unit_of_measurement": "workouts",
        "icon": "mdi:calendar-check",
    },
    "training_time": {
        "name": "Training time",
        "device_class": "duration",
        "state_class": "total",
        "unit_of_measurement": "s",
        "suggested_unit_of_measurement": "h",
        "icon": "mdi:arm-flex",
    },
}


class Message(NamedTuple):
    """One MQTT publish, its fields in the order `Client.publish` takes them."""

    topic: str
    payload: str
    qos: int
    retain: bool


type Send = Callable[[MqttSettings, list[Message]], None]
"""Deliver messages to the broker over one connection, raising on any failure."""


def send_to_broker(settings: MqttSettings, messages: list[Message]) -> None:
    """Connect, publish every message, disconnect. Blocking; raises on failure.

    Bounded, because it runs in the threadpool request handlers share: a publish
    that could hang would starve the API one workout at a time. So paho's connect
    gives up after its own 5 s, a dropped connection is never retried, and the
    broker has `ACK_TIMEOUT_SECONDS` to acknowledge everything.

    No held connection, so no LWT and no availability topic (#6). The client id
    is left empty so paho picks a random one: a startup announce and a workout's
    announce may overlap, and a shared id would have the broker drop one of them.
    """
    client = Client(CallbackAPIVersion.VERSION2, reconnect_on_failure=False)
    if settings.username is not None:
        client.username_pw_set(settings.username, settings.password)
    if settings.ssl:
        # Verified against the system's CA bundle, hostname included. paho imports
        # `ssl` conditionally, so strict pyright sees one parameter as Unknown.
        client.tls_set()  # pyright: ignore[reportUnknownMemberType]
    client.connect(settings.host, settings.port, keepalive=KEEPALIVE_SECONDS)
    client.loop_start()
    try:
        # Queued behind CONNECT on the same socket; MQTT allows it before CONNACK.
        sent = [client.publish(*message) for message in messages]
        deadline = time.monotonic() + ACK_TIMEOUT_SECONDS
        for info in sent:
            info.wait_for_publish(max(0.0, deadline - time.monotonic()))
        if not all(info.is_published() for info in sent):
            raise TimeoutError(f"{settings.host} did not acknowledge every message")
    finally:
        client.disconnect()
        client.loop_stop()


@dataclass(frozen=True, slots=True)
class Publisher:
    """Tells Home Assistant about profiles, reading them from the database.

    Neither method ever raises: both run after the fact, and a broker that is
    down, slow or misconfigured must never reach a workout being logged (#6).
    There is no retry — the next workout publishes everything again, and the
    broker keeps the last values meanwhile.
    """

    settings: MqttSettings
    database_path: Path
    send: Send

    def announce(self, recorded: RecordedWorkout) -> None:
        """Publish discovery and state for the profile that just trained."""
        try:
            self._publish(only=recorded.profile_id)
        except Exception:
            LOGGER.warning(
                "Could not publish profile %s to MQTT",
                recorded.profile_id,
                exc_info=True,
            )

    def announce_everyone(self) -> None:
        """Publish every profile that has trained, over one connection.

        Run at startup. Retention has already brought Home Assistant's values
        back; this ships discovery changes after an update, and heals a broker
        that lost its retained store. A profile that has never trained gets no
        device until it does, so no sensor ever has to read `unknown`.
        """
        try:
            self._publish(only=None)
        except Exception:
            LOGGER.warning("Could not publish profiles to MQTT", exc_info=True)

    def _publish(self, only: int | None) -> None:
        connection = connect(self.database_path)
        try:
            trained = [
                (profile, history)
                for profile in store.list_profiles(connection)
                if only in (None, profile.id)
                and (history := workouts.list_workouts(connection, profile.id))
            ]
        finally:
            connection.close()
        messages = [
            message
            for profile, history in trained
            for message in _messages(self.settings, profile, profile_progress(history))
        ]
        if messages:
            self.send(self.settings, messages)


def _messages(
    settings: MqttSettings, profile: Profile, progress: ProfileProgress
) -> list[Message]:
    """Build discovery, then state — both retained, so HA has them after a restart."""
    return [
        _retained(_discovery_topic(settings, profile.id), _discovery(profile)),
        _retained(_state_topic(profile.id), _state(progress)),
    ]


def _discovery(profile: Profile) -> dict[str, object]:
    """Describe one HA device carrying all five sensors."""
    device_id = f"kettlebell_profile_{profile.id}"
    return {
        "device": {
            "identifiers": [device_id],
            "name": f"Kettlebell {profile.name}",
            "manufacturer": APP_NAME,
            "model": "Training profile",
            "sw_version": __version__,
        },
        "origin": {
            "name": APP_NAME,
            "sw_version": __version__,
            "support_url": SUPPORT_URL,
        },
        "state_topic": _state_topic(profile.id),
        "qos": 1,
        "components": {
            key: {
                "platform": "sensor",
                "unique_id": f"{device_id}_{key}",
                "value_template": f"{{{{ value_json.{key} }}}}",
                **spec,
            }
            for key, spec in SENSORS.items()
        },
    }


def _state(progress: ProfileProgress) -> dict[str, object]:
    """Render the document every sensor reads its value from, keyed as `SENSORS`."""
    last = progress.last_workout
    return {
        # UTC to the millisecond: one instant, one spelling, offset explicit (#6).
        "last_workout": (
            None
            if last is None
            else last.astimezone(UTC).isoformat(timespec="milliseconds")
        ),
        "last_routine": progress.last_routine,
        "last_duration": progress.last_time_under_load,
        "workouts": progress.workouts,
        "training_time": progress.time_under_load,
    }


def _discovery_topic(settings: MqttSettings, profile_id: int) -> str:
    return f"{settings.discovery_prefix}/device/kettlebell_profile_{profile_id}/config"


def _state_topic(profile_id: int) -> str:
    return f"kettlebell/profile/{profile_id}/state"


def _retained(topic: str, payload: Mapping[str, object]) -> Message:
    return Message(topic=topic, payload=json.dumps(payload), qos=1, retain=True)
