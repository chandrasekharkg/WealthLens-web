"""The app an ASGI server runs.

Kept apart from `create_app` so the factory stays a pure function a test can call with a temp manifest,
while this module handles the one piece of environment reading: where the family manifest lives.
"""
from __future__ import annotations

import os
import pathlib

from wealthlens_web.api.app import DEFAULT_HOST, DEFAULT_PORT, create_app

MANIFEST_ENV = "WLW_MANIFEST"
HOST_ENV = "WLW_HOST"
PORT_ENV = "WLW_PORT"


def manifest_path() -> pathlib.Path:
    """`WLW_MANIFEST`, else `family.toml` — the file the household owns (ADR-0002). The default tries the repo
    root (dev checkout) AND its parent (the installed `$WEALTHLENS_ROOT` layout, where the manifest sits beside
    the two repos), so a raw `uvicorn wealthlens_web.serve:app` without the launcher still finds the demo."""
    declared = os.environ.get(MANIFEST_ENV)
    if declared:
        return pathlib.Path(declared).expanduser()
    here = pathlib.Path(__file__).resolve()
    for cand in (here.parents[2] / "family.toml", here.parents[3] / "family.toml"):
        if cand.exists():
            return cand
    return here.parents[2] / "family.toml"   # historical default (drives the "no manifest" message)


def bound_to() -> tuple[str, int]:
    """Where this process is actually served.

    The Host check compares against the address the app believes it is on, so if that belief and the
    address uvicorn binds ever disagree, EVERY request is refused with `reason: host` and nothing says
    why. They must come from one place — hence the environment, read by both the launcher and here.
    """
    return os.environ.get(HOST_ENV, DEFAULT_HOST), int(os.environ.get(PORT_ENV, DEFAULT_PORT))


_host, _port = bound_to()
app = create_app(manifest_path(), host=_host, port=_port)
