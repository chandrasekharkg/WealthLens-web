"""The family manifest: parsing, and the things it refuses.

`parse()` takes text, so every rule here is a function call — no temp directories, no fixtures, no
filesystem (ADR-0018). The refusals matter as much as the parsing: a manifest is hand-edited, and this
project keeps finding the same failure shape, a plausible input accepted and quietly dropped.
"""
from __future__ import annotations

import pathlib

import pytest

from wealthlens_web.core import manifest

MINIMAL = """
[family]
label = "A Household"

[[entity]]
id = "self"
label = "Me"
workspace = "~/WealthLens/me-WealthLens-data"
"""


def test_a_minimal_manifest_parses():
    m = manifest.parse(MINIMAL)
    assert m.label == "A Household"
    assert m.reporting_currency == "INR"
    assert m.default_view == "family"
    assert len(m.entities) == 1
    e = m.entities[0]
    assert e.id == "self" and e.label == "Me"
    assert not e.has_several_workspaces


def test_a_home_relative_path_is_expanded():
    e = manifest.parse(MINIMAL).entities[0]
    assert not str(e.workspaces[0]).startswith("~")
    assert str(e.workspaces[0]).endswith("me-WealthLens-data")


def test_owner_defaults_to_self_and_is_explicit_on_the_entity():
    """WLC weights every figure by this and contributes ZERO for an instrument owned by someone else —
    silently. The default has to be a value the code can show, not an absence."""
    assert manifest.parse(MINIMAL).entities[0].owner == "self"
    m = manifest.parse(MINIMAL.replace('label = "Me"', 'label = "Me"\nowner = "dad"'))
    assert m.entities[0].owner == "dad"


def test_a_label_falls_back_to_the_id():
    m = manifest.parse('[[entity]]\nid = "solo"\nworkspace = "/tmp/x"\n')
    assert m.entities[0].label == "solo"


def test_an_entity_may_span_several_workspaces():
    m = manifest.parse("""
[[entity]]
id = "parent"
workspaces = ["/tmp/current", "/tmp/legacy"]
""")
    e = m.entities[0]
    assert e.has_several_workspaces and len(e.workspaces) == 2


def test_declaring_both_workspace_and_workspaces_is_refused():
    """Ambiguity here reads the wrong store, so it is refused rather than resolved by a rule nobody knows."""
    with pytest.raises(manifest.ManifestError, match="both"):
        manifest.parse("""
[[entity]]
id = "x"
workspace = "/tmp/a"
workspaces = ["/tmp/b"]
""")


def test_currency_and_reporting_currency_are_normalised():
    m = manifest.parse("""
[family]
reporting_currency = "inr"

[[entity]]
id = "x"
workspace = "/tmp/a"
currency = "gbp"
""")
    assert m.reporting_currency == "INR"
    assert m.entities[0].currency == "GBP"


# ── refusals ─────────────────────────────────────────────────────────────────────────────────────────

def test_an_unrecognised_key_is_named_rather_than_ignored():
    """The failure this prevents: `reporting_curency = "USD"` silently doing nothing, and every figure
    reported under the wrong label with nothing to notice."""
    with pytest.raises(manifest.ManifestError) as e:
        manifest.parse('[family]\nreporting_curency = "USD"\n\n[[entity]]\nid="x"\nworkspace="/tmp/a"\n')
    assert "reporting_curency" in str(e.value)
    assert "reporting_currency" in str(e.value), "naming the typo is only half the help"


def test_an_unrecognised_entity_key_is_named():
    with pytest.raises(manifest.ManifestError, match="ownr"):
        manifest.parse('[[entity]]\nid="x"\nworkspace="/tmp/a"\nownr="dad"\n')


def test_a_duplicate_id_names_both_entries():
    with pytest.raises(manifest.ManifestError) as e:
        manifest.parse("""
[[entity]]
id = "self"
label = "Me"
workspace = "/tmp/a"

[[entity]]
id = "self"
label = "Also Me"
workspace = "/tmp/b"
""")
    assert "Me" in str(e.value) and "Also Me" in str(e.value)


def test_an_entity_without_an_id_is_refused():
    with pytest.raises(manifest.ManifestError, match="no id"):
        manifest.parse('[[entity]]\nworkspace = "/tmp/a"\n')


def test_an_entity_without_a_workspace_is_refused():
    with pytest.raises(manifest.ManifestError, match="no workspace"):
        manifest.parse('[[entity]]\nid = "x"\n')


def test_a_manifest_with_no_entities_is_refused():
    with pytest.raises(manifest.ManifestError, match="no entities"):
        manifest.parse('[family]\nlabel = "Empty"\n')


def test_invalid_toml_is_refused_with_the_reason():
    with pytest.raises(manifest.ManifestError, match="not valid TOML"):
        manifest.parse("[family\nlabel = broken")


def test_a_default_view_naming_nothing_is_refused():
    with pytest.raises(manifest.ManifestError) as e:
        manifest.parse(MINIMAL + '\n[view]\ndefault = "spouse"\n')
    assert "spouse" in str(e.value) and "self" in str(e.value), "say what WOULD have been valid"


def test_a_default_view_may_name_family_or_a_declared_entity():
    assert manifest.parse(MINIMAL + '\n[view]\ndefault = "self"\n').default_view == "self"
    assert manifest.parse(MINIMAL + '\n[view]\ndefault = "family"\n').default_view == "family"


# ── key backup state (ADR-0015) ──────────────────────────────────────────────────────────────────────

def test_key_backup_defaults_to_unconfirmed():
    """A workspace nobody has confirmed is UNCONFIRMED, not assumed safe — including one connected rather
    than created, where we genuinely do not know."""
    e = manifest.parse(MINIMAL).entities[0]
    assert e.key_backup.confirmed is False
    assert e.key_backup.on is None and e.key_backup.fingerprint is None


def test_key_backup_records_when_and_which_secret():
    m = manifest.parse(MINIMAL + """
[entity.key_backup]
confirmed = true
on = "2026-08-22"
fingerprint = "7f2ac4198b03"
""")
    b = m.entities[0].key_backup
    assert b.confirmed and b.on == "2026-08-22" and b.fingerprint == "7f2ac4198b03"


# ── lookup ───────────────────────────────────────────────────────────────────────────────────────────

def test_looking_up_an_entity_by_id():
    assert manifest.parse(MINIMAL).entity("self").label == "Me"


def test_an_unknown_entity_lists_the_ones_that_exist():
    with pytest.raises(manifest.ManifestError) as e:
        manifest.parse(MINIMAL).entity("nobody")
    assert "nobody" in str(e.value) and "self" in str(e.value)


# ── the shipped example is documentation, so it must stay true ───────────────────────────────────────

def test_the_shipped_example_manifest_parses():
    """family.example.toml is how the format is documented. If it stops parsing, the docs lie."""
    example = pathlib.Path(__file__).resolve().parents[2] / "family.example.toml"
    m = manifest.load(example)
    assert m.reporting_currency == "INR"
    assert [e.id for e in m.entities] == ["self", "spouse"]
    assert m.default_view == "family"


def test_load_reports_a_missing_file_in_words():
    with pytest.raises(manifest.ManifestError, match="can't read the manifest"):
        manifest.load("/nonexistent/family.toml")
