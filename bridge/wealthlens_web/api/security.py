"""Phase-1 hardening for a local-first server (ADR-0004).

The threat this is actually built against is not a network attacker — the socket is on loopback. It is
**the browser**: any page the household visits can issue requests to 127.0.0.1, and without these checks a
random tab could read a family's net worth or start a rebuild.

Three layers, each closing a different door:

- **Host** must be the address we bound. This is what stops DNS rebinding, where an attacker's domain
  resolves to 127.0.0.1 and the browser then treats their page as same-origin with this app.
- **Origin**, when present, must be ours. A browser attaches it to cross-site requests, so a foreign value
  is proof of a cross-site call. It is absent on same-origin navigations, which is why it cannot be the
  only guard — hence the token.
- **A per-session token** on everything that changes state. The token is issued with the page, so a script
  on another origin cannot read it (that is what the same-origin policy protects), and cannot forge it.
"""
from __future__ import annotations

import hmac
import html
import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse

TOKEN_HEADER = "x-wlw-token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def new_token() -> str:
    return secrets.token_urlsafe(32)


def _refuse(reason: str, status: int = 403) -> JSONResponse:
    # Deliberately terse: an error page is not the place to teach an attacker which check they tripped.
    return JSONResponse({"error": "refused", "reason": reason}, status_code=status)


# The two loopback spellings are the SAME place — a browser cannot be made to resolve `localhost` anywhere
# else (RFC 6761), so accepting both weakens nothing and spares a household member who typed the other one.
_LOOPBACK = ("127.0.0.1", "localhost")


def accepted_hosts(host: str) -> frozenset[str]:
    """The Host values that mean "this instance": the configured one, plus its loopback twin when it is bound
    to loopback. A LAN name (`aipc.local:8765`) stays exact — that is the DNS-rebinding defence."""
    name, sep, port = host.rpartition(":")
    if not sep:
        name, port = host, ""
    if name in _LOOPBACK:
        return frozenset(f"{n}:{port}" if port else n for n in _LOOPBACK)
    return frozenset({host})


def wrong_address_page(origin: str, got: str) -> HTMLResponse:
    """The ONE refusal that explains itself.

    A household member who typed the LAN IP instead of the name, `localhost` for a name-bound instance, or
    started uvicorn without the launcher (so WLW_HOST was unset) used to get a blank page and a terse JSON
    body — for hours, in one case (adoption review 2026-09-05, item 1). The configured address is what the
    launcher already printed, so naming it here leaks nothing. Only for a SAFE navigation to the page itself;
    every API call keeps the terse `reason: host`."""
    o, g = html.escape(origin), html.escape(got) or "(no Host header)"
    return HTMLResponse(
        "<!doctype html><meta charset=\"utf-8\"><title>WealthLens — open it at the right address</title>"
        "<main style=\"font:16px/1.5 system-ui,sans-serif;max-width:38em;margin:4em auto;padding:0 1em\">"
        f"<h1>Open WealthLens at <a href=\"{o}/\">{o}</a></h1>"
        f"<p>You reached it as <code>{g}</code>. WealthLens answers only at the exact name and port it was "
        "started for, so other web pages on this network cannot talk to it.</p>"
        "<p>If that address is the wrong one, restart the server with <code>WLW_HOST</code> and "
        "<code>WLW_PORT</code> set to the name and port you want — the <code>wealthlens-serve</code> launcher "
        "sets both.</p></main>",
        status_code=403)


class LocalOnly(BaseHTTPMiddleware):
    """Host + Origin + token, in that order — cheapest and most decisive first."""

    def __init__(self, app, *, origin: str, token: str):
        super().__init__(app)
        self._origin = origin.rstrip("/")
        self._host = self._origin.split("//", 1)[-1]
        scheme = self._origin.split("//", 1)[0]
        self._hosts = accepted_hosts(self._host)
        self._origins = frozenset(f"{scheme}//{h}" for h in self._hosts)
        self._token = token

    async def dispatch(self, request: Request, call_next):
        host = (request.headers.get("host") or "").strip()
        if host not in self._hosts:                     # DNS rebinding, or a proxy we did not expect
            if request.method.upper() in SAFE_METHODS and request.url.path in ("/", "/index.html"):
                return wrong_address_page(self._origin, host)   # a person at the wrong URL, told the right one
            return _refuse("host")

        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in self._origins:
            return _refuse("origin")

        if request.method.upper() not in SAFE_METHODS:
            supplied = request.headers.get(TOKEN_HEADER, "")
            # Constant-time: a token check that leaks timing is a token check that can be walked.
            if not supplied or not hmac.compare_digest(supplied, self._token):
                return _refuse("token")

        return await call_next(request)
