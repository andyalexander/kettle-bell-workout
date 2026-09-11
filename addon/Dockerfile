# ---------- front end ----------
FROM node:22-alpine AS frontend

WORKDIR /build

# Lockfile layer first, so `npm ci` is cached whenever dependencies are unchanged.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ---------- runtime ----------
# Pinned, because Supervisor always builds with --pull.
FROM ghcr.io/home-assistant/base-python:3.13-alpine3.24

# uv, per the project's Python rules — never pip. The base image already points
# UV_EXTRA_INDEX_URL at the Home Assistant musllinux wheel index.
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /uvx /usr/local/bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

# Dependency layer, keyed on the lockfile alone: editing backend source does not
# reinstall FastAPI.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY backend/ ./
RUN uv sync --locked --no-dev

# FastAPI mounts this directory at /.
COPY --from=frontend /build/dist /app/static

COPY run.sh /
RUN chmod a+x /run.sh

# Supervisor injects these when it builds; declared so plain `docker build` works.
ARG BUILD_VERSION="dev"
ARG BUILD_ARCH="aarch64"

# config.yaml's `version`, carried into the app for /api/health and the device
# page in Home Assistant. Declared this late so a bump rebuilds only the last layers.
ENV KB_VERSION="${BUILD_VERSION}"

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="aarch64|amd64" \
  org.opencontainers.image.title="Kettlebell Trainer" \
  org.opencontainers.image.source="https://github.com/andyalexander/kettle-bell-workout"

CMD [ "/run.sh" ]
