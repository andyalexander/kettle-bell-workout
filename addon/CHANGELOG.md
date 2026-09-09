# Changelog

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
