"""Build a throwaway workspace and manifest for the end-to-end run.

A real encrypted store at the engine's real schema, created through WealthLens-core's own `init` — not a
hand-assembled fake, because the flow under test is the one a household performs and a fake store would
prove something else.

No PAN is supplied: `init` degrades to an empty one non-interactively, which is exactly what we want. A
test fixture has no business carrying anything PAN-shaped.
"""
from __future__ import annotations

import contextlib
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]      # frontend/
TMP = ROOT / "e2e" / ".tmp"


def main() -> None:
    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)

    sys.path.insert(0, str(ROOT.parent / "bridge"))
    from wealthlens import cli

    # Narration to stderr, the answer to stdout — the same one-channel-per-kind rule the job contract
    # uses, so the caller can read the path without parsing a page of prose around it.
    with contextlib.redirect_stdout(sys.stderr):
        cli.main(["init", "--name", "e2e", "--home", str(TMP), "--holder", "Test", "--pan", "NOT-SET"])
    workspace = TMP / "e2e-WealthLens-data"

    (TMP / "family.toml").write_text(
        '[family]\nlabel = "End to end"\nreporting_currency = "INR"\n\n'
        '[[entity]]\nid = "e2e"\nlabel = "Test Member"\n'
        f'workspace = "{workspace}"\n'
    )
    print(workspace)


if __name__ == "__main__":
    main()
