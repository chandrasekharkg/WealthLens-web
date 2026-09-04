"""Fixtures for tests that need a real WealthLens-core store.

WLC is an optional dependency (it is not on PyPI and CI runs without it deliberately, so the missing-engine
path is exercised rather than assumed). Everything here therefore skips cleanly when it is absent, and the
pure-logic tests — the bulk of the suite — never touch it.

The stores built here are real: a real encrypted DuckDB file at the engine's real schema, written through
WLC's own SQL. Synthetic figures, no personal data, and small enough that a whole family is built per test.
"""
from __future__ import annotations

import pathlib
import secrets

import pytest

# NOTE: no module-level importorskip here — inside a conftest a Skipped at import time is FATAL to pytest
# (the engine-less `bridge` CI job died at startup). Fixtures that need the engine importorskip it themselves.


@pytest.fixture()
def make_workspace(tmp_path):
    """Build a workspace on disk and return its path. `holdings` is {name: value} in the store's currency."""
    pytest.importorskip("wealthlens", reason="WealthLens-core is not installed")   # engine-backed fixture
    import duckdb
    from wealthlens import cli

    def _build(name: str, holdings: dict[str, float] | None = None, *,
               owner: str | None = None, as_of: str = "2026-06-30",
               classes: dict[str, str] | None = None,
               cards: dict | None = None) -> pathlib.Path:
        ws = tmp_path / f"{name}-WealthLens-data"
        ws.mkdir(parents=True)
        key = secrets.token_hex(16)
        (ws / "store.key").write_text(key)

        con = duckdb.connect(":memory:")
        cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
        con.execute("USE wl")
        con.execute(cli._SCHEMA_SQL)
        con.execute("INSERT INTO sources (source_id, source_type, adapter, provider) "
                    "VALUES ('src:test', 'file', 'test', 'test')")
        for i, (label, value) in enumerate((holdings or {}).items()):
            iid = f"inst:{name}:{i}"
            asset_class = (classes or {}).get(label, "listed_equity")   # per-holding class; equity by default
            con.execute("INSERT INTO instruments (instrument_id, name, asset_class, source_id) "
                        "VALUES (?, ?, ?, 'src:test')", [iid, label, asset_class])
            con.execute("INSERT INTO position_snapshots "
                        "(instrument_id, account_id, as_of, value_inr, source, source_id) "
                        "VALUES (?, ?, CAST(? AS DATE), ?, 'stmt', 'src:test')",
                        [iid, f"demat:{name}", as_of, value])
            # a document-dated fact, so freshness has something real to report
            con.execute("INSERT INTO bank_transactions (row_id, source_id, value_date, bank) "
                        "VALUES (?, 'src:test', CAST(? AS DATE), ?)", [f"{name}-{i}", as_of, name])
            if owner:
                con.execute("INSERT INTO entities (entity_id, name, entity_type) VALUES (?, ?, 'person') "
                            "ON CONFLICT DO NOTHING", [owner, owner])
                con.execute("INSERT INTO ownership "
                            "(instrument_id, owner_entity_id, share, capacity, valid_from) "
                            "VALUES (?, ?, 1.0, 'beneficial', DATE '2000-01-01')", [iid, owner])
        # Optional credit cards: {issuer: [(period_end, prev, new, [(date, narration, signed), ...]), ...]}.
        # Each statement is one card_spec source; its transactions load to the card:<issuer> subledger.
        for issuer, statements in (cards or {}).items():
            acct = f"card:{issuer}"
            con.execute("INSERT INTO accounts (account_id, account_group, type, institution, currency) "
                        "SELECT ?, 'card', 'credit_card', ?, 'INR' "
                        "WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE account_id = ?)",
                        [acct, issuer.upper(), acct])
            for si, (period_end, prev, new, txns) in enumerate(statements):
                sid = f"card:{name}:{issuer}:{si}"
                con.execute("INSERT INTO sources (source_id, source_type, adapter, provider, accounts, "
                            "period_end, detail, row_count) VALUES (?, 'file', 'card_spec', ?, ?, "
                            "CAST(? AS DATE), ?, ?)",
                            [sid, issuer, [acct], period_end,
                             f'{{"previous_balance": {prev}, "new_balance": {new}}}', len(txns)])
                for ti, (date, narr, signed) in enumerate(txns):
                    con.execute("INSERT INTO bank_transactions (row_id, account_id, bank, narration, amount, "
                                "signed_amount, value_date, transacted_at, source, source_id) "
                                "VALUES (?, ?, ?, ?, ?, ?, CAST(? AS DATE), CAST(? AS TIMESTAMP), ?, ?)",
                                [f"{sid}-{ti}", acct, issuer, narr, abs(signed), signed, date, date, acct, sid])

        con.execute("CHECKPOINT wl")
        con.close()
        return ws

    return _build


@pytest.fixture()
def downgrade_schema():
    """Make a store claim an older schema version — the skew an aggregate must refuse to mix."""
    import duckdb
    from wealthlens import cli

    def _downgrade(ws: pathlib.Path, version: str = "3.7") -> None:
        key = (ws / "store.key").read_text().strip()
        con = duckdb.connect(":memory:")
        cli._attach(con, "wl", ws / "wealth_v3.duckdb", key)
        con.execute("USE wl")
        con.execute("DELETE FROM schema_migrations")
        con.execute("INSERT INTO schema_migrations (version, name) VALUES (?, 'downgraded')", [version])
        con.execute("CHECKPOINT wl")
        con.close()

    return _downgrade
