"""Write the API's OpenAPI document to the frontend, where its types are generated from.

Run after changing an endpoint or a response model:

    python bridge/scripts/export_schema.py

The committed document is the contract. A pytest asserts the live app still matches it, so an endpoint
that changes without regenerating fails a test rather than surprising the UI at runtime.
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "bridge"))

from wealthlens_web.api.app import (  # noqa: E402 — must follow the sys.path insert above (the bridge is imported from the repo, not site-packages)
    create_app,
)

SCHEMA_PATH = ROOT / "frontend" / "src" / "api" / "openapi.json"


def schema() -> dict:
    """The document, built from a throwaway app — no manifest is read and no store is opened."""
    return create_app(ROOT / "family.example.toml", token="schema-export").openapi()


def main() -> None:
    SCHEMA_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_PATH.write_text(json.dumps(schema(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {SCHEMA_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
