"""Downscaling profile avatars before they go into the database.

Avatars live as BLOBs in the profile row so `/data/kettlebell.db` is the entire
application state (rule 6). That only stays true if the bytes stay small, so an
upload is re-encoded here rather than trusted: the picker tiles are a few hundred
pixels across on an iPad, and a phone photo is several megabytes.
"""

from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

__all__ = ["AVATAR_MAX_EDGE", "AVATAR_MIME", "downscale_avatar"]

AVATAR_MAX_EDGE = 256
"""Longest edge, in pixels, after downscaling — ample for a picker tile."""

AVATAR_MIME = "image/webp"
"""What we store, whatever was uploaded. WebP is fine on every iOS we target."""

_QUALITY = 85


def downscale_avatar(
    image_bytes: bytes, *, max_edge: int = AVATAR_MAX_EDGE
) -> tuple[bytes, str]:
    """Re-encode an uploaded image as a small WebP, preserving aspect ratio.

    Returns the bytes and their mime type, ready for `store.set_avatar`. Raises
    `ValueError` when the upload is not an image we can decode.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            image = source.convert("RGBA" if _has_alpha(source) else "RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("uploaded file is not a readable image") from error

    image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=_QUALITY, method=6)
    return buffer.getvalue(), AVATAR_MIME


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
