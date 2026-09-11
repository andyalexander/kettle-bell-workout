# Changelog

## 0.3.1

- "Last workout duration" is now **Last workout effort duration**: it was always
  time under load, work only, so a 15-minute workout reads 10 minutes, not 15.
- Both durations show whole seconds (`600 s`, not `600.00 s`). Home Assistant's
  MQTT sensors ignore a suggested unit, so choose minutes or hours in each
  sensor's settings if you prefer them.
- Workouts shows a bare count (`1`, not `1 workouts`).

## 0.3.0

- Workout results reach Home Assistant over MQTT. Each profile becomes its own
  device, **Kettlebell _name_**, from its first recorded workout, with five
  sensors: Last workout, Last routine, Last workout duration, Workouts and
  Training time. Every value is retained at the broker, so it survives a Home
  Assistant restart, and the lifetime totals feed long-term statistics.
- Training time is time under load — work only; rest and prep are excluded.
- Publishing is best effort: a broker that is down or slow never stops a workout
  being recorded, and the next workout publishes everything again.
- Broker TLS follows the Supervisor's MQTT service; nothing to configure.

## 0.2.0

- Optional TLS, off by default: `ssl`, `certfile` and `keyfile` options, with the
  certificate and key read from the shared `/ssl` folder. `webui` and the watchdog
  follow the option automatically. Turning it on makes the page a secure context,
  which is what the Screen Wake Lock API needs to stop the iPad dimming mid-workout.
- The app refuses to start if `ssl` is on and the certificate or key is missing,
  rather than quietly serving HTTP.
- `DOCS.md` gains "Keeping the screen awake" — why the screen dims, why HTTPS on
  Home Assistant Core does not cover this app, and how to issue a local certificate.

## 0.1.0

- Skeleton: FastAPI backend with a health endpoint, a Vite/React/Tailwind front end
  built into the image, and the add-on packaging agreed in the packaging research.
