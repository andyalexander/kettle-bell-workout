"""Runtime settings, read from the environment `run.sh` prepares."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

__all__ = ["MqttSettings", "Settings"]


@dataclass(frozen=True, slots=True)
class MqttSettings:
    """Broker connection details handed to us by the Supervisor.

    Absent when no MQTT service is registered, in which case publishing is skipped.
    """

    host: str
    port: int
    username: str | None
    password: str | None
    discovery_prefix: str
    ssl: bool


@dataclass(frozen=True, slots=True)
class Settings:
    """Everything the app needs to know about its environment."""

    database_path: Path
    static_dir: Path
    log_level: str
    mqtt: MqttSettings | None
    # The app's one version is `config.yaml`'s. Supervisor builds the image with
    # it, and the Dockerfile carries it in as `KB_VERSION`; outside the image, "dev".
    version: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        """Build settings from `KB_*` variables, falling back to dev defaults."""
        source = os.environ if env is None else env
        return cls(
            database_path=Path(source.get("KB_DATABASE_PATH", "kettlebell.db")),
            static_dir=Path(source.get("KB_STATIC_DIR", "static")),
            log_level=source.get("KB_LOG_LEVEL", "info").lower(),
            mqtt=_mqtt_from_env(source),
            version=source.get("KB_VERSION", "dev"),
        )


def _mqtt_from_env(source: Mapping[str, str]) -> MqttSettings | None:
    """Read broker settings, returning None when no broker was advertised."""
    host = source.get("KB_MQTT_HOST")
    if not host:
        return None
    return MqttSettings(
        host=host,
        port=int(source.get("KB_MQTT_PORT", "1883")),
        username=source.get("KB_MQTT_USERNAME") or None,
        password=source.get("KB_MQTT_PASSWORD") or None,
        discovery_prefix=source.get("KB_MQTT_DISCOVERY_PREFIX", "homeassistant"),
        # bashio renders the service's boolean as the string "true" or "false".
        ssl=source.get("KB_MQTT_SSL", "false").lower() == "true",
    )
