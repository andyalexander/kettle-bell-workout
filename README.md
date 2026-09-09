# Kettlebell Trainer

A Home Assistant app (formerly "add-on") for running EMOM and interval kettlebell
workouts on an iPhone or iPad at home, publishing results to Home Assistant over
MQTT.

- `CONTEXT.md` — the domain glossary. Code, issues and docs use these words.
- `docs/adr/` — decisions with consequences.
- `addon/` — the app: packaging plus the two source trees it builds from.
- `addon/DOCS.md` — the user documentation shown in Home Assistant, including why
  the iPad screen dims mid-workout and the optional TLS route that fixes it.

## Layout

```text
repository.yaml        # makes this repo a Home Assistant app store repository
addon/
  config.yaml          # the app manifest
  Dockerfile           # multi-stage: builds the front end, then the runtime image
  run.sh               # bashio entrypoint; reads MQTT credentials from Supervisor
  backend/             # FastAPI + SQLite  (uv project)
  frontend/            # Vite + React + TypeScript + Tailwind
```

The backend and front end live *inside* `addon/` because Supervisor builds with the
app folder as the Docker build context — a `Dockerfile` there cannot reach outside it.

## Working on it

```bash
# Backend
cd addon/backend
uv sync
uv run pytest
uv run ruff check .
uv run pyright
uv run uvicorn kettlebell.main:app --reload --port 8234

# Front end (proxies /api to the backend above)
cd addon/frontend
npm install
npm run dev
npm run build
```

## Building the image locally

```bash
cd addon
docker build --platform linux/arm64 -t local/kettlebell .
docker run --rm -v /tmp/kb_data:/data -p 8234:8234 local/kettlebell
```

Home Assistant's `aarch64` is Docker's `linux/arm64`. Without the Supervisor there is
no MQTT service to query, which the guard in `run.sh` handles.
