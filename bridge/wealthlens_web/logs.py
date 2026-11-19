"""The bridge's log: what happened, never whose money (structured-logs, ADR-0023).

A line may carry shape: route templates, methods, statuses, durations, job ids, verb names, outcomes, gate names,
exit codes, exception TYPES, trace ids. It never carries values: query strings, raw paths, entity ids, a verb's
message or narration, an exception's text or traceback, amounts, names, file names. The rule holds in both
formats and on every install. A lab that ships this log somewhere is shipping somebody's log file.

Standard library only. The bridge writes to standard error and nowhere else; shipping, rotation and retention
belong to whoever runs it (ADR-0003: no telemetry).
"""
from __future__ import annotations

import contextvars
import datetime as _dt
import json
import logging
import re
import secrets
import sys
import time
from typing import IO

FORMATS = ("text", "json")
LOGGER = logging.getLogger("wealthlens_web")

# The trace id of the request being served. A job copies it when it is submitted, so the job's result line
# joins the request (and, behind the TLS front, the front's span) that started it.
TRACE: contextvars.ContextVar[str | None] = contextvars.ContextVar("wlw_trace_id", default=None)

_TRACEPARENT = re.compile(r"00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}")


def new_trace_id() -> str:
    return secrets.token_hex(16)


def trace_from(header: str | None) -> str:
    """A W3C `traceparent`'s trace id, but only from a well-formed header with non-zero ids; otherwise a fresh
    one. The header is client input: it correlates lines and authorises nothing, and a bad one is never echoed."""
    m = _TRACEPARENT.fullmatch(header or "")
    if m and m.group(1) != "0" * 32 and m.group(2) != "0" * 16:
        return m.group(1)
    return new_trace_id()


def route_of(scope: dict) -> str:
    """The matched route's TEMPLATE, or a fixed bucket. Never the raw path: it holds entity ids, and on a
    document route the query would hold file names."""
    route = scope.get("route")
    template = getattr(route, "path", None)
    if template == "/" or (template is None and str(scope.get("path", "")).startswith("/assets/")):
        return "static"
    return template or "unmatched"


def event(level: int, msg: str, **fields) -> None:
    """One log line from the bridge. `msg` must already obey the rule above: compose it from fields only."""
    LOGGER.log(level, msg, extra={"wlw": fields})


# ── formats ────────────────────────────────────────────────────────────────────────────────────────────

class _Json(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line = {"time": _dt.datetime.fromtimestamp(record.created, _dt.UTC).isoformat(timespec="milliseconds")
                        .replace("+00:00", "Z"),
                "level": record.levelname.lower(), "msg": record.getMessage()}
        line.update(getattr(record, "wlw", {}))
        trace = line.get("trace_id") or TRACE.get()
        if trace:
            line["trace_id"] = trace
        if record.exc_info and record.exc_info[0]:
            line.setdefault("error", record.exc_info[0].__name__)    # the type; never the text or traceback
        return json.dumps(line, ensure_ascii=False, default=str)


class _Text(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created))
        line = f"{stamp} {record.levelname:<7} {record.getMessage()}"
        if record.exc_info and record.exc_info[0]:
            line += f" ({record.exc_info[0].__name__})"
        return line


def configure(fmt: str, stream: IO[str] | None = None) -> None:
    """Point the bridge's and uvicorn's loggers at one stream, in one format, and silence uvicorn's access log
    (the bridge writes its own). Called once by `serve`, after uvicorn has set up its own logging."""
    handler = logging.StreamHandler(stream or sys.stderr)
    handler.setFormatter(_Json() if fmt == "json" else _Text())
    for name in ("wealthlens_web", "uvicorn"):
        lg = logging.getLogger(name)
        lg.handlers = [handler]
        lg.setLevel(logging.INFO)
        lg.propagate = False
    err = logging.getLogger("uvicorn.error")
    err.handlers, err.propagate = [], True                         # into "uvicorn"'s handler
    silence_uvicorn_access()


def silence_uvicorn_access() -> None:
    access = logging.getLogger("uvicorn.access")
    access.handlers, access.propagate, access.disabled = [], False, True


# ── the access line ────────────────────────────────────────────────────────────────────────────────────

_FALLBACK_500 = b"Internal Server Error"


class AccessLog:
    """Pure ASGI middleware, outermost, so refusals by the security guard are logged too. One line per
    request, written after the response. An unhandled error is logged by type and answered with a plain 500
    here, rather than travelling on to a server that would print its text and traceback."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        header = next((v for k, v in scope.get("headers", ()) if k == b"traceparent"), None)
        token = TRACE.set(trace_from(header.decode("latin-1") if header is not None else None))
        started = time.perf_counter()
        state = {"status": 500, "sent": False}

        async def watch(message):
            if message["type"] == "http.response.start":
                state["status"], state["sent"] = message["status"], True
            await send(message)

        try:
            try:
                await self.app(scope, receive, watch)
            except Exception as e:                   # a fault is data: its type, never its words
                state["status"] = 500
                event(logging.ERROR, f"unhandled {type(e).__name__} in {route_of(scope)}",
                      route=route_of(scope), error=type(e).__name__)
                if not state["sent"]:
                    await send({"type": "http.response.start", "status": 500,
                                "headers": [(b"content-type", b"text/plain; charset=utf-8"),
                                            (b"content-length", str(len(_FALLBACK_500)).encode())]})
                    await send({"type": "http.response.body", "body": _FALLBACK_500})
            ms = round((time.perf_counter() - started) * 1000, 1)
            route, method, status = route_of(scope), scope.get("method", ""), state["status"]
            event(logging.ERROR if status >= 500 else logging.INFO, f"{method} {route} {status} {ms:g}ms",
                  method=method, route=route, status=status, duration_ms=ms)
        finally:
            TRACE.reset(token)


# ── the job line ───────────────────────────────────────────────────────────────────────────────────────

_LEVEL = {"ok": logging.INFO, "attention": logging.WARNING, "refused": logging.WARNING}


def job_result(*, verb: str, job_id: str, outcome: str | None, gate: str | None, exit_code: int | None,
               duration_s: float, trace_id: str | None) -> None:
    """One line when a job finishes, by any path. Never the job's message, narration, result or entity."""
    outcome = outcome or "failed"
    detail = ", ".join(x for x in (f"gate {gate}" if gate else "", f"exit {exit_code}" if exit_code is not None
                                   else "") if x)
    msg = f"job {verb} {outcome}" + (f" ({detail})" if detail else "") + f" {duration_s:g}s [{job_id}]"
    event(_LEVEL.get(outcome, logging.ERROR), msg, event="job_result", job=verb, job_id=job_id,
          outcome=outcome, gate=gate, exit_code=exit_code, duration_s=duration_s, trace_id=trace_id)
