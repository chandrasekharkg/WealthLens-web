"""Custodian/presenter boundary (constitution #10) — the presenter never writes the store.

Question: is a store opened the way the bridge opens it read-only?
Why: the bridge is a presenter, not a custodian (WLW principle #1). A write from it would violate the split —
and nothing but this test stops a future endpoint from opening a store writable "just this once".
Fix: keep every bridge open() at the default read_only=True.
"""
from __future__ import annotations

import duckdb
import pytest


def test_the_bridge_opens_stores_read_only(make_workspace):
    from wealthlens import workspace as wl_workspace

    ws = make_workspace("alpha", {"A Share": 100})
    with wl_workspace.resolve(ws).open() as con:            # the bridge's own open path (default read_only)
        with pytest.raises(duckdb.Error) as excinfo:
            con.execute("INSERT INTO sources (source_id, source_type, adapter, provider) "
                        "VALUES ('x', 'file', 't', 't')")   # a valid write — so the ONLY reason it fails is read-only
    assert "read-only" in str(excinfo.value).lower() or "read only" in str(excinfo.value).lower()
