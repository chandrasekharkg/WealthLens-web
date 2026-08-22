"""Changing a workspace's configuration without destroying it.

The load-bearing test here is the comment-preservation one. WLC's config.toml is ~70 lines of guidance a
household reads to understand their own setup, and a plain parse-and-rewrite would delete all of it the
first time somebody changed a single setting — silently, with the change looking successful.
"""
from __future__ import annotations

import pathlib

import pytest

from wealthlens_web.core import settings

REAL_ISH_CONFIG = '''# ============================================================================
#  WealthLens — your personal config.
#
#  LOCAL-ONLY: this folder never leaves your machine.
#
#  VALUE SYNTAX:
#    @file:NAME   read the file NAME in this folder
#    @a.b.c       reuse another value here
# ============================================================================

# ── Tidy the inbox (on by default) ──────────────────────────────────────────
[organize]
enabled = true

[identity]
# Your name as it prints on statements.
holder_names = ["Kolluri"]
pan = "@file:PAN"

# ── Statement passwords ─────────────────────────────────────────────────────
[secrets]
hdfc = "@file:hdfc.pass"
# icici = "@file:icici.pass"

[parser.cas]
password = "@identity.pan"
'''


@pytest.fixture()
def workspace(tmp_path) -> pathlib.Path:
    ws = tmp_path / "cfg-WealthLens-data"
    ws.mkdir()
    (ws / settings.CONFIG).write_text(REAL_ISH_CONFIG)
    return ws


def test_reading_reports_what_is_set_without_any_value(workspace):
    got = settings.read(workspace)
    assert got.holder_names == ("Kolluri",)
    assert got.organize is True
    assert got.secret_names == ("hdfc",)
    assert got.pan_set is False, "no PAN file exists yet"
    assert "PAN" not in str(got.as_dict()), "a read must not carry the secret anywhere"


# ── the file survives being edited ───────────────────────────────────────────────────────────────────

def test_a_save_touches_one_line_and_keeps_every_comment(workspace):
    before = (workspace / settings.CONFIG).read_text()
    settings.set_holder_names(workspace, ["Kolluri", "K G"])
    after = (workspace / settings.CONFIG).read_text()

    # Every comment the household reads is still there.
    for comment in ("your personal config", "VALUE SYNTAX", "Tidy the inbox", "Statement passwords"):
        assert comment in after, f"editing destroyed the guidance around {comment!r}"

    changed = [
        (a, b) for a, b in zip(before.splitlines(), after.splitlines(), strict=False) if a != b
    ]
    assert len(changed) == 1, f"a single setting changed {len(changed)} lines"
    assert "holder_names" in changed[0][1]


def test_a_reference_is_preserved_not_inlined(workspace):
    settings.set_organize(workspace, False)
    after = (workspace / settings.CONFIG).read_text()
    assert 'pan = "@file:PAN"' in after
    assert 'password = "@identity.pan"' in after, "the parser's reference must survive an unrelated edit"


def test_unrelated_sections_are_untouched(workspace):
    settings.set_organize(workspace, False)
    after = (workspace / settings.CONFIG).read_text()
    assert "[parser.cas]" in after and 'hdfc = "@file:hdfc.pass"' in after
    assert '# icici = "@file:icici.pass"' in after, "a commented-out example is guidance too"


# ── the PAN is a secret, not a display field ─────────────────────────────────────────────────────────

def test_a_pan_is_written_to_its_own_file_with_its_own_permissions(workspace):
    settings.set_pan(workspace, "abcde1234f")            # pii-ok — a shaped placeholder, not a PAN
    path = workspace / settings.PAN_FILE
    assert path.read_text() == "ABCDE1234F"              # pii-ok — same placeholder, normalised
    assert path.stat().st_mode & 0o777 == 0o600, "a secret is not world-readable"


def test_the_config_references_the_pan_rather_than_containing_it(workspace):
    settings.set_pan(workspace, "abcde1234f")            # pii-ok — a shaped placeholder
    text = (workspace / settings.CONFIG).read_text()
    assert 'pan = "@file:PAN"' in text
    assert "ABCDE1234F" not in text, (                   # pii-ok — asserting ABSENCE
        "inlining would put a secret in the file most likely to be shared when asking for help")


def test_reading_reports_the_pan_as_set_and_nothing_more(workspace):
    settings.set_pan(workspace, "abcde1234f")            # pii-ok — a shaped placeholder
    got = settings.read(workspace)
    assert got.pan_set is True
    assert "ABCDE1234F" not in str(got.as_dict())        # pii-ok — asserting ABSENCE


def test_a_malformed_pan_is_refused_before_anything_is_written(workspace):
    with pytest.raises(settings.SettingsError) as e:
        settings.set_pan(workspace, "not-a-pan")
    assert e.value.field == "pan"
    assert not (workspace / settings.PAN_FILE).exists()


# ── the password ring ────────────────────────────────────────────────────────────────────────────────

def test_a_named_password_lands_in_its_own_file_and_is_referenced(workspace):
    settings.add_secret(workspace, "sbi", "a-statement-password")
    assert (workspace / "sbi.pass").read_text() == "a-statement-password"
    assert (workspace / "sbi.pass").stat().st_mode & 0o777 == 0o600
    text = (workspace / settings.CONFIG).read_text()
    assert 'sbi = "@file:sbi.pass"' in text
    assert "a-statement-password" not in text
    assert "sbi" in settings.read(workspace).secret_names


def test_an_existing_name_is_never_silently_replaced(workspace):
    """WLC allows several values under one name, so combining is a decision a person makes."""
    before = (workspace / settings.CONFIG).read_text()
    with pytest.raises(settings.SettingsError) as e:
        settings.add_secret(workspace, "hdfc", "another-one")
    assert e.value.field == "name"
    assert "already names a password" in str(e.value)
    # A refused change writes NOTHING — not the config, and not a stray .pass file.
    assert (workspace / settings.CONFIG).read_text() == before
    assert not (workspace / "hdfc.pass").exists()


def test_an_empty_password_is_refused(workspace):
    with pytest.raises(settings.SettingsError):
        settings.add_secret(workspace, "x", "")


def test_a_workspace_with_no_config_yet_still_reads(tmp_path):
    ws = tmp_path / "bare-WealthLens-data"
    ws.mkdir()
    got = settings.read(ws)
    assert got.holder_names == () and got.pan_set is False and got.organize is True


# ── revealing a re-obtainable secret (ADR-0019) ──────────────────────────────────────────────────────

def test_a_named_password_can_be_revealed_by_name(workspace):
    settings.add_secret(workspace, "sbi", "a-statement-password")
    assert settings.reveal(workspace, "sbi") == "a-statement-password"


def test_a_pan_can_be_revealed(workspace):
    settings.set_pan(workspace, "abcde1234f")             # pii-ok — a shaped placeholder
    assert settings.reveal(workspace, "pan") == "ABCDE1234F"   # pii-ok — same placeholder


def test_only_a_name_this_workspace_declares_can_be_revealed(workspace):
    """Resolved through the CONFIGURED ring, never by joining a caller's string to the workspace."""
    (workspace / "sneaky.pass").write_text("not in the ring")
    with pytest.raises(settings.SettingsError) as e:
        settings.reveal(workspace, "sneaky")
    assert e.value.field == "name"


@pytest.mark.parametrize("what", ["../store.key", "store.key", "PAN.pass", "..", "/etc/passwd"])
def test_a_path_cannot_be_smuggled_through_the_name(workspace, what):
    with pytest.raises(settings.SettingsError):
        settings.reveal(workspace, what)


def test_the_store_key_has_no_path_to_reveal_at_all(workspace):
    """The line ADR-0019 draws: a key cannot be re-obtained, so revealing it risks the whole store."""
    (workspace / "store.key").write_text("the-actual-store-key")
    for attempt in ("store.key", "store", "key", "storekey"):
        with pytest.raises(settings.SettingsError):
            settings.reveal(workspace, attempt)


def test_an_unset_secret_says_so_rather_than_returning_nothing(workspace):
    with pytest.raises(settings.SettingsError, match="nothing is stored"):
        settings.reveal(workspace, "pan")
