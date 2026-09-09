import pytest
from httpx import ASGITransport, AsyncClient

from kettlebell import __version__
from kettlebell.config import Settings
from kettlebell.db import MIGRATIONS, connect
from kettlebell.main import create_app


@pytest.mark.anyio
async def test_health_reports_ok(tmp_path_settings: Settings) -> None:
    app = create_app(tmp_path_settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


@pytest.mark.anyio
async def test_startup_creates_and_migrates_the_database(
    tmp_path_settings: Settings,
) -> None:
    app = create_app(tmp_path_settings)
    assert not tmp_path_settings.database_path.exists()

    async with app.router.lifespan_context(app):
        pass

    connection = connect(tmp_path_settings.database_path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
    connection.close()
