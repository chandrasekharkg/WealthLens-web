"""The shared PII/secret scanner (`.githooks/pii-scan`) — the bash hook that guards this PUBLIC repo.

That hook had no test at all, so a regex edit that quietly stopped matching (or a shell-quoting slip that made
it always exit 0) would go unnoticed until a real value slipped through. These drive the actual script against a
throwaway git repo and pin both directions: a planted PAN / grouped amount is BLOCKED, and clean or explicitly
suppressed content PASSES — the same contract the Python scanner in WealthLens-core is tested against.

The planted identifiers are assembled from fragments so THIS test file carries no contiguous PII shape of its
own (it is scanned by the very hook it tests, on every commit). Only the temp repo's files hold the whole value.
"""
from __future__ import annotations

import pathlib
import subprocess

import pytest

_HOOK = pathlib.Path(__file__).resolve().parents[2] / ".githooks" / "pii-scan"
# a real-shaped PAN and an Indian-grouped amount, kept non-contiguous in this file's own source
_PAN = "ZXCVB" + "9876K"
_AMOUNT = "12," + "34," + "567.89"


def _repo(tmp_path):
    def git(*a):
        subprocess.run(["git", *a], cwd=tmp_path, check=True, capture_output=True)
    git("init", "-q")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "tester")
    return git


def _scan_staged(tmp_path):
    """Run the hook over the staged index of the temp repo (its `--staged` mode). Returns (returncode, stderr)."""
    r = subprocess.run(["bash", str(_HOOK), "--staged"], cwd=tmp_path, capture_output=True, text=True)
    return r.returncode, r.stderr


@pytest.mark.skipif(not _HOOK.exists(), reason=".githooks/pii-scan not present")
def test_hook_blocks_a_planted_pan_and_grouped_amount(tmp_path):
    git = _repo(tmp_path)
    (tmp_path / "leak.md").write_text(f"PAN {_PAN} and balance {_AMOUNT} here\n")
    git("add", "leak.md")
    rc, err = _scan_staged(tmp_path)
    assert rc == 1                               # the added line is blocked
    assert "[PAN]" in err                        # …by name — both patterns are reported
    assert "indian-grouped-amount" in err
    assert _PAN not in err and _AMOUNT not in err  # the matched VALUE is never echoed into the terminal


@pytest.mark.skipif(not _HOOK.exists(), reason=".githooks/pii-scan not present")
def test_hook_passes_clean_synthetic_content(tmp_path):
    git = _repo(tmp_path)
    # a round western-grouped figure (50,000 does NOT match the lakh/crore grouping) and no identifier
    (tmp_path / "ok.md").write_text("a round total of 50,000 rupees, no identifier\n")
    git("add", "ok.md")
    rc, _err = _scan_staged(tmp_path)
    assert rc == 0


@pytest.mark.skipif(not _HOOK.exists(), reason=".githooks/pii-scan not present")
def test_hook_honours_the_suppression_marker(tmp_path):
    git = _repo(tmp_path)
    marker = "pii-" "ok"                          # the hook's escape hatch, assembled so this file stays clean
    (tmp_path / "sample.md").write_text(f"deliberately synthetic PAN {_PAN} {_AMOUNT}  {marker}\n")
    git("add", "sample.md")
    rc, _err = _scan_staged(tmp_path)
    assert rc == 0                               # a line carrying the marker is skipped, PII shape and all


@pytest.mark.skipif(not _HOOK.exists(), reason=".githooks/pii-scan not present")
def test_hook_blocks_a_forbidden_file_type(tmp_path):
    git = _repo(tmp_path)
    (tmp_path / "statement.pdf").write_text("%PDF-1.4 not a real document\n")
    git("add", "statement.pdf")
    rc, err = _scan_staged(tmp_path)
    assert rc == 1 and "forbidden file type" in err   # a source document must never be committed
