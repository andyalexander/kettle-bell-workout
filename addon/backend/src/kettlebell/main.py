"""Application factory: the API, and the built front end mounted beside it."""

from __future__ import annotations

from typing import Literal, TypedDict

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from kettlebell import __version__
from kettlebell.config import Settings

__all__ = ["app", "create_app"]


class Health(TypedDict):
    """Body of the watchdog endpoint Supervisor polls."""

    status: Literal["ok"]
    version: str


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the ASGI app, serving the front end when it has been built."""
    resolved = Settings.from_env() if settings is None else settings
    app = FastAPI(title="Kettlebell Trainer", version=__version__)

    @app.get("/api/health")
    async def health() -> Health:
        """Report liveness; wired to `watchdog` in the app's `config.yaml`."""
        return {"status": "ok", "version": __version__}

    if resolved.static_dir.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=resolved.static_dir, html=True),
            name="static",
        )

    return app


app = create_app()
