from pathlib import Path

from kettlebell.config import Settings


def test_defaults_when_environment_is_empty() -> None:
    settings = Settings.from_env({})

    assert settings.database_path == Path("kettlebell.db")
    assert settings.mqtt is None


def test_reads_the_variables_run_sh_exports() -> None:
    settings = Settings.from_env(
        {
            "KB_DATABASE_PATH": "/data/kettlebell.db",
            "KB_LOG_LEVEL": "DEBUG",
            "KB_MQTT_HOST": "core-mosquitto",
            "KB_MQTT_PORT": "1883",
            "KB_MQTT_USERNAME": "addon",
            "KB_MQTT_PASSWORD": "secret",
            "KB_MQTT_DISCOVERY_PREFIX": "homeassistant",
        }
    )

    assert settings.database_path == Path("/data/kettlebell.db")
    assert settings.log_level == "debug"
    assert settings.mqtt is not None
    assert settings.mqtt.host == "core-mosquitto"
    assert settings.mqtt.port == 1883


def test_blank_credentials_become_none() -> None:
    settings = Settings.from_env(
        {"KB_MQTT_HOST": "core-mosquitto", "KB_MQTT_USERNAME": ""}
    )

    assert settings.mqtt is not None
    assert settings.mqtt.username is None
