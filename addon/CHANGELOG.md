# Changelog

## 0.5.2

- **Pause sits in the middle** of the workout screen, the same size as before.
  The sound button is smaller and moves to the bottom right, out of the way.

## 0.5.1

- **HTTPS works.** With `ssl` on, the app refused to start saying the
  certificate was not found, even with it sitting in the `ssl` folder: the
  folder was never actually made available to the app. It is now. If you had
  turned `ssl` on and the app stopped, update and it starts.

## 0.5.0

- **Locking the phone pauses the workout.** It used to run on with the screen
  off, so a turn could change without you seeing it. Now the workout freezes at
  the second the screen locks or you leave the app, and waits on the Paused
  screen for you.
- **Every resume counts you back in**: tap Resume and a silent 3-2-1 gives you
  time to get back to the bell, then the workout carries on from exactly where
  it stopped. The "Away for" screen is gone.

## 0.4.4

- More room at the top: the title on the picker, routine list and New profile
  screens sits lower, clear of the clock and the Dynamic Island, with a little
  more space between it and what's below.

## 0.4.3

- **Add it to your Home Screen and it opens like an app**: full screen, no
  address bar or toolbar, with the status bar over the dark background. In
  Safari or Chrome on iPhone or iPad, tap Share → Add to Home Screen.

## 0.4.2

- `http://homeassistant.local:8234/` works on iPhone and iPad. The app only
  listened on IPv4, and iOS reaches `homeassistant.local` over IPv6, so the
  connection was closed before the page loaded. Opening it by IP was unaffected.

## 0.4.1

- The app now reports the version you installed. `/api/health` and each
  profile's device page in Home Assistant said `0.1.0` whatever was running;
  both now read the version shown in the app store.

## 0.4.0

- **You can train with it.** Open the app, pick who's training (or add yourself
  with **+** — a name is all it needs), choose a routine, and the workout runs
  from a 10-second prep to a summary. Finishing records the workout; aborting
  records nothing.
- The workout screen: the countdown fills the screen, with the exercise and its
  weight above it and the round below. Green is work, red is rest, amber is prep,
  and a white flash marks each new turn. Pause and abort are the only controls.
- Sound is off by default; the speaker button turns on 3-2-1 beeps and remembers
  the choice per person.
- A workout that couldn't be saved — the Pi out of reach — is kept on the device
  and retried until it is, including the next time the app opens.

## 0.3.2

- Consistent names for the two durations: **Last workout duration** and **Total
  workout duration** (was Last workout effort duration and Training time). Both
  still count work only, whole seconds; the sensors and their history carry over.

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
