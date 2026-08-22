"""Preflight is a pure-ish function over the import system, so it is testable with no server and no store."""
from __future__ import annotations

import builtins

import pytest

from wealthlens_web import engine


def test_reports_the_installed_engine():
    got = engine.preflight()
    if got.present:
        assert got.usable and got.schema_version, "an installed engine must report its schema version"
    else:
        assert got.detail, "an absent engine must say so in words a screen can show"


def test_a_missing_engine_is_a_state_not_a_crash(monkeypatch):
    """The one outcome cold-start forbids is a blank page — so preflight must never raise."""
    real_import = builtins.__import__

    def no_wealthlens(name, *a, **k):
        if name == "wealthlens" or name.startswith("wealthlens."):
            raise ImportError("no module named 'wealthlens'")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", no_wealthlens)
    monkeypatch.delitem(__import__("sys").modules, "wealthlens", raising=False)
    monkeypatch.delitem(__import__("sys").modules, "wealthlens.schema", raising=False)

    got = engine.preflight()
    assert not got.present and not got.usable
    assert "not installed" in (got.detail or "")


def test_an_engine_without_a_version_is_not_usable(monkeypatch):
    class Stub:
        SCHEMA_VERSION = ""

    monkeypatch.setitem(__import__("sys").modules, "wealthlens", type("m", (), {"schema": Stub})())
    monkeypatch.setitem(__import__("sys").modules, "wealthlens.schema", Stub)
    got = engine.preflight()
    assert got.present and not got.usable and got.detail
