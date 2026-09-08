#!/usr/bin/with-contenv bashio

bashio::log.info "Starting Kettlebell Trainer..."

export KB_DATABASE_PATH="/data/kettlebell.db"
export KB_STATIC_DIR="/app/static"
KB_LOG_LEVEL="$(bashio::config 'log_level')"
export KB_LOG_LEVEL
KB_MQTT_DISCOVERY_PREFIX="$(bashio::config 'mqtt_discovery_prefix')"
export KB_MQTT_DISCOVERY_PREFIX

if bashio::services.available "mqtt"; then
  KB_MQTT_HOST="$(bashio::services mqtt 'host')"
  KB_MQTT_PORT="$(bashio::services mqtt 'port')"
  KB_MQTT_USERNAME="$(bashio::services mqtt 'username')"
  KB_MQTT_PASSWORD="$(bashio::services mqtt 'password')"
  export KB_MQTT_HOST KB_MQTT_PORT KB_MQTT_USERNAME KB_MQTT_PASSWORD
else
  bashio::log.warning "No MQTT service registered with the Supervisor."
fi

# 0.0.0.0, not 127.0.0.1: the container has its own network namespace, and the
# published port would otherwise be unreachable from the LAN.
exec python -m uvicorn kettlebell.main:app \
  --host 0.0.0.0 \
  --port 8234 \
  --log-level "${KB_LOG_LEVEL}"
