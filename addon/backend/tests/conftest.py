from pathlib import Path

import pytest

from kettlebell.config import Settings


@pytest.fixture
def tmp_path_settings(tmp_path: Path) -> Settings:
    """Point at a scratch database, with no front end built and no broker."""
    return Settings(
        database_path=tmp_path / "kettlebell.db",
        static_dir=tmp_path / "static",
        log_level="info",
        mqtt=None,
    )


@pytest.fixture
def anyio_backend() -> str:
    """Run async tests on asyncio only; trio is not a deployment target."""
    return "asyncio"
