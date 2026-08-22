# ADR-0009 — Distribution: native-first for a personal machine, container for the family server

**Status:** PROPOSED — recommendation below; confirm before it shapes onboarding docs

## Context

WLW must be runnable by a tired non-technical person (ADR-0006) *and* by a household that wants a
always-on family aggregator on a home server. Those are different deployments, and the honest finding is
that neither packaging wins both.

The dependency surface is real: WLC needs Python 3.11/3.12 plus duckdb/pandas/pyarrow/pdfplumber/pikepdf/
casparser; WLW adds fastapi/uvicorn/pydantic; and **two features need SYSTEM binaries, not pip packages** —
`tesseract` for OCR statements and `poppler` for rendering image-only PDFs. WLC's own `setup.sh` already
documents the Python-version roulette it fights ("Xcode's 3.9 is too old, 3.14 too new for some wheels").

## The decisive constraints

Containers are usually the "just download and run" answer. Here, three product features push back:

1. **Workspaces live at arbitrary user paths, and the UI adds them at runtime.** Family setup lets a user
   point at any workspace (a legacy folder, a mounted drive, a synced copy — ADR-0006 §2). A container
   sees only what was bind-mounted at start, so "add a family member" becomes "edit the compose file and
   restart" — breaking the flow the product exists for, unless the container mounts a broad root.
2. **Mounting a broad root is a poor look for a privacy tool.** `-v $HOME:/data` to make arbitrary paths
   reachable is a larger ask than a process that reads two directories.
3. **"Reveal in file manager" cannot cross the boundary.** The Workspace-detail pane (UX.md) opens the
   store's folder via the host's file manager — a container cannot, and browsers block `file://` links
   from an http page, so this must be a bridge-side `open`/`xdg-open`. In a container that feature is gone.

Against that, containers genuinely win on: the **system-binary problem** (tesseract/poppler installed
once, correctly, for everyone), Python-version immunity, a pinned WLC↔WLW pair, and headless
restart-safe operation on a server.

## Recommendation

**Support both, and let the deployment follow the use case. Native is the default.**

**A. Native (default) — "my laptop, my data."**
`python bootstrap.py` extends WLC's existing pattern: create a venv, install WLW + a pinned WLC, build or
unpack the frontend, start the bridge, open the browser. One command, full feature set, direct file
access, fast I/O over large corpora (the 131-PDF rebuild is a real workload), and reveal-in-file-manager
works. Optional extras (`[ocr]`, `[xls]`) install on demand, and where a **system** binary is missing the
UI says exactly that — naming the one `brew`/`apt` line — rather than failing obscurely.

**B. Container (first-class alternative) — "the family aggregator on the home server."**
An official image (Dockerfile in-repo, built from tagged source so anyone can rebuild it) for the
ADR-0006 host-accessibility model: one always-on host that can see the household's workspaces as files.
Ships tesseract + poppler preinstalled, so OCR "just works". Documented feature deltas, stated up front
rather than discovered: workspaces are limited to the mounted data root, and reveal-in-file-manager is
unavailable.

**Rejected:** a single-file bundled binary (PyInstaller/briefcase) — it hides the code boundary the
project's trust story depends on, and still doesn't solve tesseract/poppler. A desktop shell
(Electron/Tauri) — already rejected in ADR-0003 for adding a large runtime to a tool asking to be trusted.

## Consequences

- Two supported install paths to document and test; CI should build the image and smoke-test the native
  bootstrap on macOS + Linux.
- The container's feature deltas must be enforced in the product, not just documented: when running
  containerized, the UI hides reveal-in-file-manager and constrains the workspace picker to the mounted
  root, rather than offering an action that will fail.
- The bridge needs to know its own deployment mode (an env var set in the image) to do the above.
- **Source access is identical in both modes** — same repo, same code, the image built from it. "Work
  with the code" is never traded away for convenience.
- The system-binary UX (a clear, copyable install line when OCR is unavailable natively) becomes a
  small but real onboarding requirement.
