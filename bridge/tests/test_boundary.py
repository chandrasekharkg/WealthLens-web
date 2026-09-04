"""Custodian/presenter boundary (constitution #10) — the presenter never writes the store.

Question: is a store opened the way the bridge opens it read-only?
Why: the bridge is a presenter, not a custodian (WLW principle #1). A write from it would violate the split —
and nothing but this test stops a future endpoint from opening a store writable "just this once".
Fix: keep every bridge open() at the default read_only=True.
"""
from __future__ import annotations

import pathlib

import pytest


def test_the_bridge_never_opens_a_store_raw(make_workspace):
    """The read-only-open test below only proves the SANCTIONED path is read-only; a future endpoint could
    bypass it entirely with a raw `duckdb.connect(...)`. This grep-guard forbids that in the bridge runtime, so
    the only way in stays `wl_workspace.resolve(...).open()` — the one place read-only + key handling live
    (2026-08 review, P2-4)."""
    runtime = pathlib.Path(__file__).resolve().parent.parent / "wealthlens_web"
    offenders = [f"{p.relative_to(runtime)}:{i}"
                 for p in runtime.rglob("*.py")
                 for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
                 if "duckdb.connect(" in line]
    assert not offenders, ("bridge runtime opens a store raw — go through wl_workspace.resolve(...).open() "
                           f"instead: {offenders}")


def test_the_bridge_opens_stores_read_only(make_workspace):
    # engine-less CI (the `bridge` job) has neither the engine nor duckdb: import lazily so the grep-guard above
    # still runs there and only THIS test skips (a module-level `import duckdb` broke collection, 2026-09-05)
    duckdb = pytest.importorskip("duckdb", reason="engine-less run: no duckdb, nothing to open")
    from wealthlens import workspace as wl_workspace

    ws = make_workspace("alpha", {"A Share": 100})
    with wl_workspace.resolve(ws).open() as con:            # the bridge's own open path (default read_only)
        with pytest.raises(duckdb.Error) as excinfo:
            con.execute("INSERT INTO sources (source_id, source_type, adapter, provider) "
                        "VALUES ('x', 'file', 't', 't')")   # a valid write — so the ONLY reason it fails is read-only
    assert "read-only" in str(excinfo.value).lower() or "read only" in str(excinfo.value).lower()
