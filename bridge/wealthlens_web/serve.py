"""The app an ASGI server runs.

Kept apart from `create_app` so the factory stays a pure function a test can call with a temp manifest,
while this module handles the one piece of environment reading: where the family manifest lives.
"""
from __future__ import annotations

import os
import pathlib
import sys

from wealthlens_web.api.app import DEFAULT_HOST, DEFAULT_PORT, create_app
from wealthlens_web.api.security import parse_public_origin

MANIFEST_ENV = "WLW_MANIFEST"
HOST_ENV = "WLW_HOST"
PORT_ENV = "WLW_PORT"
PUBLIC_ORIGIN_ENV = "WLW_PUBLIC_ORIGIN"


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


def public_origin(host: str, port: int) -> str:
    """`WLW_PUBLIC_ORIGIN` — the address the BROWSER uses — else the bound `http://host:port` (ADR-0022).

    Distinct from the bind: behind a TLS front the browser talks to https://aipc.local:8444 while uvicorn binds
    127.0.0.1:8765. A malformed value refuses to start, naming what is wrong, rather than serving with a guess
    that would refuse every request (or accept the wrong ones)."""
    declared = os.environ.get(PUBLIC_ORIGIN_ENV)
    if not declared:
        return f"http://{host}:{port}"
    try:
        return parse_public_origin(declared)
    except ValueError as e:
        sys.exit(f"WealthLens web: {PUBLIC_ORIGIN_ENV} is not usable — {e}")


_host, _port = bound_to()
_origin = public_origin(_host, _port)
app = create_app(manifest_path(), host=_host, port=_port, origin=_origin)
# Said once, on the server's own console: the exact address to open. Any other name or port gets the
# wrong-address page (security.wrong_address_page) — this line is where the right one comes from.
print(f"WealthLens web: open {_origin}/ — exactly this address "
      f"(WLW_HOST / WLW_PORT change it, WLW_PUBLIC_ORIGIN when a TLS front serves it; the wealthlens-serve "
      f"launcher sets them)", file=sys.stderr)
