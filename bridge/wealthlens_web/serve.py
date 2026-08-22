"""The app an ASGI server runs.

Kept apart from `create_app` so the factory stays a pure function a test can call with a temp manifest,
while this module handles the one piece of environment reading: where the family manifest lives.
"""
from __future__ import annotations

import os
import pathlib

from wealthlens_web.api.app import create_app

MANIFEST_ENV = "WLW_MANIFEST"


def manifest_path() -> pathlib.Path:
    """`WLW_MANIFEST`, else `family.toml` beside the repo — the file the household owns (ADR-0002)."""
    declared = os.environ.get(MANIFEST_ENV)
    if declared:
        return pathlib.Path(declared).expanduser()
    return pathlib.Path(__file__).resolve().parents[2] / "family.toml"


app = create_app(manifest_path())
