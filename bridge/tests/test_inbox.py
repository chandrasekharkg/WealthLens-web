"""Depositing a statement — and everything it refuses.

A deposit is the app's most exposed write: a browser supplies both the bytes and the name. These tests are
mostly about what cannot happen.
"""
from __future__ import annotations

import pathlib
import re

import pytest
from fastapi.testclient import TestClient

from wealthlens_web.api.app import create_app
from wealthlens_web.api.security import TOKEN_HEADER
from wealthlens_web.core import inbox

HOST = "127.0.0.1:7788"
PDF = b"%PDF-1.4 not really a pdf, but this endpoint never looks inside"


# ── the allowlist must not drift from the engine's ───────────────────────────────────────────────────

def test_the_allowlist_matches_what_the_engine_actually_reads():
    """Pinned rather than imported: `_inbox_files` is private upstream, and reaching into it would be the
    boundary violation this app exists to avoid. So the constant is duplicated ON PURPOSE and this test is
    the thing that stops the duplicate going stale — a format added upstream must not become
    un-uploadable here without somebody noticing."""
    import inspect

    from wealthlens import cli

    source = inspect.getsource(cli._inbox_files)
    for suffix in inbox.ALLOWED_SUFFIXES:
        assert f'"{suffix}"' in source, f"{suffix} is offered here but the engine no longer reads it"

    engine_suffixes = set(re.findall(r'"(\.[a-z]+)"', source))
    missing = engine_suffixes - inbox.ALLOWED_SUFFIXES
    assert not missing, (
        f"the engine now reads {sorted(missing)} but this app will not accept them — add them to "
        "ALLOWED_SUFFIXES so a format added upstream does not silently become un-uploadable")


# ── the unit ─────────────────────────────────────────────────────────────────────────────────────────

def test_a_file_lands_in_the_inbox_and_nowhere_else(tmp_path):
    got = inbox.deposit(tmp_path, "statement.pdf", PDF)
    assert got.path == tmp_path / "statements" / "statement.pdf"
    assert got.path.read_bytes() == PDF
    assert got.renamed_from is None


def test_a_colliding_name_keeps_both_files(tmp_path):
    """Two statements a bank gave the same filename are two different documents — a file is a duplicate
    only when its CONTENT matches."""
    first = inbox.deposit(tmp_path, "statement.pdf", b"first one here")
    second = inbox.deposit(tmp_path, "statement.pdf", b"a different document")

    assert second.path.name == "statement (2).pdf"
    assert second.renamed_from == "statement.pdf", "the UI must be able to say it was renamed"
    assert first.path.read_bytes() == b"first one here", "the first file is untouched"


def test_a_third_collision_keeps_counting(tmp_path):
    for _ in range(3):
        inbox.deposit(tmp_path, "s.pdf", b"x")
    names = sorted(p.name for p in (tmp_path / "statements").iterdir())
    assert names == ["s (2).pdf", "s (3).pdf", "s.pdf"]


@pytest.mark.parametrize("name", ["../escape.pdf", "/etc/passwd.pdf", "..\\\\windows.pdf", "sub/dir.pdf"])
def test_a_path_cannot_escape_the_inbox(tmp_path, name):
    """Reduced to a bare name, then re-joined. A traversal attempt lands harmlessly or is refused — it
    never writes outside."""
    try:
        got = inbox.deposit(tmp_path, name, PDF)
    except inbox.RejectedUpload:
        return
    assert got.path.parent == (tmp_path / "statements").resolve()


@pytest.mark.parametrize("name", ["", ".", "..", "weird\x00name.pdf", "sem;icolon.pdf", "$(whoami).pdf"])
def test_an_unusable_name_is_refused_rather_than_rewritten(tmp_path, name):
    """A silently rewritten name is a file a household cannot find again, and the rewrite is the only
    record that anything was wrong."""
    with pytest.raises(inbox.RejectedUpload) as e:
        inbox.deposit(tmp_path, name, PDF)
    assert e.value.reason in {"name", "type"}


def test_a_type_the_engine_cannot_read_is_refused_with_the_list(tmp_path):
    with pytest.raises(inbox.RejectedUpload) as e:
        inbox.deposit(tmp_path, "photo.png", PDF)
    assert e.value.reason == "type"
    assert ".pdf" in str(e.value), "say what IS accepted, not only what isn't"


def test_an_oversized_file_is_refused_before_it_is_written(tmp_path):
    with pytest.raises(inbox.RejectedUpload) as e:
        inbox.deposit(tmp_path, "huge.pdf", b"x" * (inbox.MAX_BYTES + 1))
    assert e.value.reason == "size"
    assert not (tmp_path / "statements").exists(), "nothing is created on the refusal path"


def test_an_empty_file_is_refused(tmp_path):
    with pytest.raises(inbox.RejectedUpload) as e:
        inbox.deposit(tmp_path, "empty.pdf", b"")
    assert e.value.reason == "empty"


def test_a_workspace_that_does_not_exist_is_refused_rather_than_created(tmp_path):
    """Found by clicking through the app: an unavailable member was selectable, and depositing would have
    built a folder tree at a path that is not a workspace — leaving the statement somewhere no engine
    reads, with nothing to say so."""
    absent = tmp_path / "absent-WealthLens-data"
    with pytest.raises(inbox.RejectedUpload) as e:
        inbox.deposit(absent, "s.pdf", PDF)
    assert e.value.reason == "workspace"
    assert not absent.exists(), "nothing may be created on the refusal path"


def test_nothing_is_parsed_and_no_store_is_written(tmp_path):
    """A deposit is not an import. The only thing that changes on disk is one file in one folder."""
    inbox.deposit(tmp_path, "statement.pdf", PDF)
    created = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*"))
    assert created == ["statements", "statements/statement.pdf"]


# ── listing and removing what is staged ────────────────────────────────────────────────────────────────

def test_listing_shows_staged_files_with_size(tmp_path):
    inbox.deposit(tmp_path, "a.pdf", PDF)
    inbox.deposit(tmp_path, "b.pdf", b"a different, longer document")
    got = inbox.listing(tmp_path)
    assert [f.name for f in got] == ["a.pdf", "b.pdf"]      # sorted, so the screen is stable
    assert got[0].size == len(PDF) and got[1].size == len(b"a different, longer document")


def test_listing_is_empty_when_the_inbox_does_not_exist(tmp_path):
    assert inbox.listing(tmp_path) == []                    # a blank slate, not an error


def test_remove_deletes_one_staged_file_and_leaves_the_rest(tmp_path):
    inbox.deposit(tmp_path, "a.pdf", PDF)
    inbox.deposit(tmp_path, "b.pdf", PDF)
    assert inbox.remove(tmp_path, "a.pdf") == "a.pdf"
    assert [f.name for f in inbox.listing(tmp_path)] == ["b.pdf"]


def test_remove_a_missing_file_is_refused_never_a_silent_success(tmp_path):
    inbox.deposit(tmp_path, "a.pdf", PDF)                   # the inbox exists, but 'ghost' is not in it
    with pytest.raises(inbox.RejectedUpload) as excinfo:
        inbox.remove(tmp_path, "ghost.pdf")
    assert excinfo.value.reason == "missing"


@pytest.mark.parametrize("name", ["../secret.pdf", "/etc/passwd", "..", "sub/../../x.pdf"])
def test_remove_can_never_reach_outside_the_inbox(tmp_path, name):
    keep = inbox.deposit(tmp_path, "keep.pdf", PDF)         # a real file the escape must never touch
    with pytest.raises(inbox.RejectedUpload):               # reduced to a bare name → missing, or refused outright
        inbox.remove(tmp_path, name)
    assert keep.path.exists()


# ── through the API ──────────────────────────────────────────────────────────────────────────────────

@pytest.fixture()
def client_and_ws(tmp_path, make_workspace):
    ws = make_workspace("alpha", {"A": 1000})
    mf = tmp_path / "family.toml"
    mf.write_text(f'[family]\nreporting_currency = "INR"\n\n[[entity]]\nid = "alpha"\nworkspace = "{ws}"\n')
    return TestClient(create_app(mf, token="t"), headers={"host": HOST}), pathlib.Path(ws)


def test_an_upload_needs_the_session_token(client_and_ws):
    client, _ = client_and_ws
    r = client.post("/api/upload", data={"entity": "alpha"},
                    files={"file": ("s.pdf", PDF, "application/pdf")})
    assert r.status_code == 403 and r.json()["reason"] == "token"


def test_an_upload_lands_and_reports_where(client_and_ws):
    client, ws = client_and_ws
    r = client.post("/api/upload", data={"entity": "alpha"},
                    files={"file": ("s.pdf", PDF, "application/pdf")},
                    headers={TOKEN_HEADER: "t"})
    assert r.status_code == 201
    assert r.json() == {"filename": "s.pdf", "renamed_from": None, "entity_id": "alpha",
                        "inbox": "statements"}
    assert (ws / "statements" / "s.pdf").read_bytes() == PDF


def test_a_rejected_upload_says_which_rule_it_broke(client_and_ws):
    client, _ = client_and_ws
    r = client.post("/api/upload", data={"entity": "alpha"},
                    files={"file": ("photo.png", PDF, "image/png")},
                    headers={TOKEN_HEADER: "t"})
    assert r.status_code == 400
    assert r.json()["detail"]["rule"] == "type", "a UI must explain, not say 'failed'"


def test_an_upload_for_an_undeclared_entity_is_refused_and_lists_the_real_ones(client_and_ws):
    """404, not 500: naming an entity the household has not declared is the caller's mistake — and the
    manifest already knows which ids would have worked."""
    client, _ = client_and_ws
    r = client.post("/api/upload", data={"entity": "nobody"},
                    files={"file": ("s.pdf", PDF, "application/pdf")},
                    headers={TOKEN_HEADER: "t"})
    assert r.status_code == 404
    reason = r.json()["detail"]["reason"]
    assert "nobody" in reason and "alpha" in reason


def _stage(client, name: str, content: bytes = PDF):
    return client.post("/api/upload", data={"entity": "alpha"},
                       files={"file": (name, content, "application/pdf")}, headers={TOKEN_HEADER: "t"})


def test_the_inbox_listing_shows_what_is_staged(client_and_ws):
    client, _ = client_and_ws
    _stage(client, "july.pdf")
    _stage(client, "august.pdf")
    r = client.get("/api/inbox/alpha")
    assert r.status_code == 200                             # a read: no token needed
    body = r.json()
    assert body["entity_id"] == "alpha" and body["inbox"] == "statements"
    assert [f["name"] for f in body["files"]] == ["august.pdf", "july.pdf"]   # sorted, size present
    assert all("size" in f and "modified" in f for f in body["files"])


def test_removing_a_staged_file_needs_the_session_token(client_and_ws):
    client, _ = client_and_ws
    _stage(client, "s.pdf")
    r = client.delete("/api/inbox/alpha", params={"name": "s.pdf"})   # no token → refused
    assert r.status_code == 403 and r.json()["reason"] == "token"


def test_removing_a_staged_file_deletes_it_so_it_can_be_re_filed(client_and_ws):
    client, ws = client_and_ws
    _stage(client, "s.pdf")
    r = client.delete("/api/inbox/alpha", params={"name": "s.pdf"}, headers={TOKEN_HEADER: "t"})
    assert r.status_code == 200 and r.json() == {"entity_id": "alpha", "removed": "s.pdf"}
    assert not (ws / "statements" / "s.pdf").exists()
    assert client.get("/api/inbox/alpha").json()["files"] == []


def test_removing_a_file_that_is_not_there_is_a_404_that_says_so(client_and_ws):
    client, _ = client_and_ws
    r = client.delete("/api/inbox/alpha", params={"name": "ghost.pdf"}, headers={TOKEN_HEADER: "t"})
    assert r.status_code == 404 and r.json()["detail"]["rule"] == "missing"
