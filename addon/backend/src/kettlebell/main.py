"""Application factory: the API, and the built front end mounted beside it."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Literal, TypedDict

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from kettlebell import __version__
from kettlebell.api import OnRecorded, router
from kettlebell.config import Settings
from kettlebell.db import open_database
from kettlebell.models import RecordedWorkout
from kettlebell.seed import seed

__all__ = ["app", "create_app"]


class Health(TypedDict):
    """Body of the watchdog endpoint Supervisor polls."""

    status: Literal["ok"]
    version: str


def create_app(
    settings: Settings | None = None, *, on_recorded: OnRecorded | None = None
) -> FastAPI:
    """Build the ASGI app, serving the front end when it has been built.

    `on_recorded` is told about each workout new to the database, after the
    commit and after the response — the seam MQTT publishing (#15) fills.
    """
    resolved = Settings.from_env() if settings is None else settings

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        """Create and migrate the database before the first request arrives.

        This is the only moment migrations run, so an add-on update that ships a
        new migration applies it on the restart that follows. How request handlers
        get a connection is the API surface's problem, not this one's.

        Seeding follows migration and is insert-if-absent, so a fresh `/data` on
        the Pi comes up with something trainable and an existing one is untouched.
        """
        connection = open_database(resolved.database_path)
        try:
            seed(connection)
        finally:
            connection.close()
        yield

    app = FastAPI(title="Kettlebell Trainer", version=__version__, lifespan=lifespan)

    @app.get("/api/health")
    async def health() -> Health:
        """Report liveness; wired to `watchdog` in the app's `config.yaml`."""
        return {"status": "ok", "version": __version__}

    app.state.database_path = resolved.database_path
    app.state.on_recorded = _publish_nothing if on_recorded is None else on_recorded
    app.include_router(router)

    # Mounted last: a mount at `/` swallows every path registered after it.
    if resolved.static_dir.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=resolved.static_dir, html=True),
            name="static",
        )

    return app


def _publish_nothing(_: RecordedWorkout) -> None:
    """Stand in for MQTT publishing until #15 lands."""


app = create_app()
