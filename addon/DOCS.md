# Kettlebell Trainer

EMOM and interval kettlebell workouts, run from an iPhone or iPad on the home
network. Results are published to Home Assistant over MQTT.

## Installation

Add this repository to the app store
(`https://github.com/andyalexander/kettle-bell-workout`), then install **Kettlebell
Trainer**. The first install builds the image on the device and takes a few minutes.

## Configuration

| Option | Meaning |
| --- | --- |
| `log_level` | `debug`, `info`, `warning` or `error`. |
| `mqtt_discovery_prefix` | Discovery topic prefix. Leave as `homeassistant` unless you have changed it in the MQTT integration. |

Broker host, port and credentials are supplied by the Supervisor — there is nothing
to configure, but an MQTT broker must be installed.

## Using it

Open the web interface on port `8234`, e.g. `http://homeassistant.local:8234/`.

## Your data

Everything — profiles, routines and training history — lives in a single SQLite
database at `/data/kettlebell.db`, which is included in Home Assistant backups.

**Uninstalling the app deletes `/data`, and with it your entire training history.**
Updates, rebuilds and restarts all preserve it; only uninstall destroys it.
