import io
import sqlite3

import pytest
from PIL import Image

from kettlebell import store
from kettlebell.avatars import AVATAR_MAX_EDGE, AVATAR_MIME, downscale_avatar
from kettlebell.models import Profile


def _photo(width: int, height: int, mode: str = "RGB") -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, (width, height), "red").save(buffer, format="PNG")
    return buffer.getvalue()


def test_a_phone_photo_is_shrunk_to_a_picker_tile() -> None:
    data, mime = downscale_avatar(_photo(3024, 4032))

    assert mime == AVATAR_MIME
    with Image.open(io.BytesIO(data)) as image:
        assert max(image.size) == AVATAR_MAX_EDGE
        assert image.size == (192, 256)  # aspect ratio preserved
    assert len(data) < 40_000


def test_a_small_image_is_not_blown_up() -> None:
    data, _ = downscale_avatar(_photo(64, 64))
    with Image.open(io.BytesIO(data)) as image:
        assert image.size == (64, 64)


def test_transparency_is_kept() -> None:
    source = io.BytesIO()
    cutout = Image.new("RGBA", (300, 300), (255, 0, 0, 255))
    cutout.putpixel((0, 0), (0, 0, 0, 0))
    cutout.save(source, format="PNG")

    data, _ = downscale_avatar(source.getvalue())
    with Image.open(io.BytesIO(data)) as image:
        assert image.mode in ("RGBA", "P")


def test_a_non_image_upload_is_refused() -> None:
    with pytest.raises(ValueError):
        _ = downscale_avatar(b"this is not an image")


def test_downscaled_bytes_go_into_the_profile_row(
    db: sqlite3.Connection, andrew: Profile
) -> None:
    data, mime = downscale_avatar(_photo(800, 800))
    store.set_avatar(db, andrew.id, data, mime)

    assert store.get_avatar(db, andrew.id) == (data, mime)
    stored = store.get_profile(db, andrew.id)
    assert stored is not None and stored.avatar_mime == AVATAR_MIME
