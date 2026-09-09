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
uvicorn_args=(
  --host 0.0.0.0
  --port 8234
  --log-level "${KB_LOG_LEVEL}"
)

# TLS is a property of how the process is launched, so it lives here and never
# reaches the app. Off by default; on, it makes the page a secure context and
# the Screen Wake Lock API appears. See DOCS.md, "Keeping the screen awake".
if bashio::config.true 'ssl'; then
  certfile="/ssl/$(bashio::config 'certfile')"
  keyfile="/ssl/$(bashio::config 'keyfile')"

  # Refuse to start rather than quietly serving HTTP: a silent fallback would
  # leave the screen dimming mid-workout while the app looked healthy.
  for required in "${certfile}" "${keyfile}"; do
    if ! bashio::fs.file_exists "${required}"; then
      bashio::exit.nok \
        "SSL is on but ${required} was not found. Put the certificate and key in the /ssl folder and check the 'certfile' and 'keyfile' options, or turn 'ssl' off."
    fi
  done

  uvicorn_args+=(--ssl-certfile "${certfile}" --ssl-keyfile "${keyfile}")
  bashio::log.info "TLS enabled — serving https on port 8234."
fi

exec python -m uvicorn kettlebell.main:app "${uvicorn_args[@]}"
