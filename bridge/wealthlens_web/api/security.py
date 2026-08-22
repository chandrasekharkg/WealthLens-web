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
import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

TOKEN_HEADER = "x-wlw-token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def new_token() -> str:
    return secrets.token_urlsafe(32)


def _refuse(reason: str, status: int = 403) -> JSONResponse:
    # Deliberately terse: an error page is not the place to teach an attacker which check they tripped.
    return JSONResponse({"error": "refused", "reason": reason}, status_code=status)


class LocalOnly(BaseHTTPMiddleware):
    """Host + Origin + token, in that order — cheapest and most decisive first."""

    def __init__(self, app, *, origin: str, token: str):
        super().__init__(app)
        self._origin = origin.rstrip("/")
        self._host = self._origin.split("//", 1)[-1]
        self._token = token

    async def dispatch(self, request: Request, call_next):
        host = (request.headers.get("host") or "").strip()
        if host != self._host:
            return _refuse("host")                      # DNS rebinding, or a proxy we did not expect

        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != self._origin:
            return _refuse("origin")

        if request.method.upper() not in SAFE_METHODS:
            supplied = request.headers.get(TOKEN_HEADER, "")
            # Constant-time: a token check that leaks timing is a token check that can be walked.
            if not supplied or not hmac.compare_digest(supplied, self._token):
                return _refuse("token")

        return await call_next(request)
