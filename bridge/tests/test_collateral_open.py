"""Opening a collateral file — the one act that touches the filesystem — must never escape the workspace.

WLW does not read statements (ADR-0001); it only asks the OS to open one. The thing that must not be
trusted is a path, so these pin the containment guard: a real file inside the workspace opens, and every
way out — traversal, an absolute filename, a symlink escape, a missing file — is refused.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from wealthlens_web.core import collateral


def _ws(tmp_path):
    ws = tmp_path / "acme-WealthLens-data"
    (ws / "nsdl").mkdir(parents=True)
    (ws / "nsdl" / "statement.pdf").write_text("not read, only opened")
    return ws


def test_a_real_file_inside_the_workspace_opens(tmp_path):
    ws = _ws(tmp_path)
    opened: list = []
    real = collateral.open_document(ws, "nsdl", "statement.pdf", opener=opened.append)
    assert opened == [real]
    assert real == (ws / "nsdl" / "statement.pdf").resolve()


def test_a_traversal_filename_is_refused(tmp_path):
    ws = _ws(tmp_path)
    (tmp_path / "secret.txt").write_text("outside")
    with pytest.raises(collateral.DocumentNotFound):
        collateral.open_document(ws, "nsdl", "../../secret.txt", opener=lambda p: None)


def test_an_absolute_filename_cannot_escape(tmp_path):
    ws = _ws(tmp_path)
    with pytest.raises(collateral.DocumentNotFound):
        collateral.resolve_document_path(ws, "nsdl", "/etc/hosts")


def test_a_symlink_pointing_out_is_refused(tmp_path):
    ws = _ws(tmp_path)
    outside = tmp_path / "outside.pdf"
    outside.write_text("out")
    (ws / "nsdl" / "link.pdf").symlink_to(outside)
    with pytest.raises(collateral.DocumentNotFound):
        collateral.resolve_document_path(ws, "nsdl", "link.pdf")


def test_a_missing_file_is_refused_not_opened(tmp_path):
    ws = _ws(tmp_path)
    with pytest.raises(collateral.DocumentNotFound):
        collateral.open_document(ws, "nsdl", "nope.pdf", opener=lambda p: None)


def test_a_document_with_no_filename_is_refused(tmp_path):
    ws = _ws(tmp_path)
    with pytest.raises(collateral.DocumentNotFound):
        collateral.resolve_document_path(ws, "nsdl", None)
