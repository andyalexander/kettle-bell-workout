"""The app manifest, `addon/config.yaml`, as Supervisor will read it.

Supervisor drops keys its schema doesn't know without a word, so a manifest
mistake only shows up on the Pi — as it did when `/ssl` was never mounted.
"""

from pathlib import Path
from typing import Any

import yaml

MANIFEST = Path(__file__).parents[2] / "config.yaml"


def load_manifest() -> dict[str, Any]:
    return yaml.safe_load(MANIFEST.read_text())


def mapped_folders(manifest: dict[str, Any]) -> set[str]:
    """Folder types in `map`, in either spelling: `ssl:rw` or `{type: ssl}`."""
    entries: list[str | dict[str, Any]] = manifest.get("map", [])
    return {
        entry.split(":")[0] if isinstance(entry, str) else entry["type"]
        for entry in entries
    }


def test_the_ssl_folder_is_mounted_through_map() -> None:
    # run.sh reads the certificate and key from /ssl; only a `map` entry mounts it.
    assert "ssl" in mapped_folders(load_manifest())


def test_no_top_level_ssl_key_pretends_to_mount_it() -> None:
    # Not in Supervisor's schema, so it is dropped: `ssl: true` mounted nothing.
    assert "ssl" not in load_manifest()
