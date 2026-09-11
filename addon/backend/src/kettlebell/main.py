"""Application factory: the API, and the built front end mounted beside it."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from typing import Literal, TypedDict

import anyio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from kettlebell import __version__
from kettlebell.api import OnRecorded, router
from kettlebell.config import Settings
from kettlebell.db import open_database
from kettlebell.models import RecordedWorkout
from kettlebell.mqtt import Publisher, Send, send_to_broker
from kettlebell.seed import seed

__all__ = ["app", "create_app"]


class Health(TypedDict):
    """Body of the watchdog endpoint Supervisor polls."""

    status: Literal["ok"]
    version: str


def create_app(
    settings: Settings | None = None,
    *,
    on_recorded: OnRecorded | None = None,
    send: Send = send_to_broker,
) -> FastAPI:
    """Build the ASGI app, serving the front end when it has been built.

    With a broker configured, every profile that has trained is announced to
    Home Assistant at startup, and a profile again each time it records a
    workout. `on_recorded` replaces the latter, and `send` stands in for the
    broker — both seams for tests.
    """
    resolved = Settings.from_env() if settings is None else settings
    publisher = (
        None
        if resolved.mqtt is None
        else Publisher(resolved.mqtt, resolved.database_path, send)
    )
    if on_recorded is None:
        on_recorded = _publish_nothing if publisher is None else publisher.announce

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        """Create and migrate the database before the first request arrives.

        This is the only moment migrations run, so an add-on update that ships a
        new migration applies it on the restart that follows. How request handlers
        get a connection is the API surface's problem, not this one's.

        Seeding follows migration and is insert-if-absent, so a fresh `/data` on
        the Pi comes up with something trainable and an existing one is untouched.

        Announcing to Home Assistant runs in the background, so a slow broker can
        never delay uvicorn coming up and trip the Supervisor's watchdog.
        """
        connection = open_database(resolved.database_path)
        try:
            seed(connection)
        finally:
            connection.close()
        async with anyio.create_task_group() as tasks:
            if publisher is not None:
                tasks.start_soon(_in_thread, publisher.announce_everyone)
            yield
            tasks.cancel_scope.cancel()

    app = FastAPI(title="Kettlebell Trainer", version=__version__, lifespan=lifespan)

    @app.get("/api/health")
    async def health() -> Health:
        """Report liveness; wired to `watchdog` in the app's `config.yaml`."""
        return {"status": "ok", "version": __version__}

    app.state.database_path = resolved.database_path
    app.state.on_recorded = on_recorded
    app.include_router(router)

    # Mounted last: a mount at `/` swallows every path registered after it.
    if resolved.static_dir.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=resolved.static_dir, html=True),
            name="static",
        )

    return app


async def _in_thread(function: Callable[[], None]) -> None:
    """Run blocking work off the event loop, abandoned if the app shuts down."""
    await anyio.to_thread.run_sync(function, abandon_on_cancel=True)


def _publish_nothing(_: RecordedWorkout) -> None:
    """Stand in for publishing when no broker is configured."""


app = create_app()
