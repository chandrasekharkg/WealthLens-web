"""Running a WealthLens-core verb — the only way this app changes anything.

Every mutation is a subprocess of the real CLI, so every gate the engine has (oracles, provenance, footing,
promote's eight refusals) applies unchanged and none of it is reimplemented here (ADR-0005).

Three things make that safe rather than merely convenient:

**Serialisation per workspace.** DuckDB read and write attaches conflict, so at most one verb runs against
a workspace at a time and a second request **queues** rather than being refused — refusal would make an
ordinary "import, then rebuild" into an error the user has to sequence by hand. Different workspaces are
untouched by each other's locks, which is the whole point of one store per person.

**Read handles are not held across a verb.** `core` opens a store, answers, and closes, so there is no
long-lived handle to release. That is a design property rather than a discipline: the context manager in
`workspace.open()` cannot outlive the request that used it.

**The result is read from the contract, never the exit code.** `import` exits non-zero when a file merely
needs attention. A runner treating non-zero as failure would call every ordinary import an error; one
treating it as success would hide real breakage. So `outcome` decides, and the exit code is recorded but
never interpreted.

Job state is in memory (ADR-0002). A restart forgets what ran — and says so — while the store itself is
never at risk, because rebuild is non-destructive and promotion is atomic.
"""
from __future__ import annotations

import dataclasses
import enum
import json
import os
import pathlib
import subprocess
import sys
import threading
import uuid

DEFAULT_TIMEOUT = 60 * 60          # a full rebuild over a real corpus runs for many minutes


class JobState(enum.StrEnum):
    QUEUED = "queued"              # waiting for this workspace to be free
    RUNNING = "running"
    FINISHED = "finished"


class Outcome(enum.StrEnum):
    """WLC's own vocabulary, mirrored so callers never see a raw exit code."""

    OK = "ok"
    ATTENTION = "attention"
    REFUSED = "refused"
    FAILED = "failed"


@dataclasses.dataclass
class Job:
    id: str
    verb: str
    entity_id: str
    workspace: pathlib.Path
    state: JobState = JobState.QUEUED
    outcome: Outcome | None = None
    gate: str | None = None
    message: str | None = None
    result: dict = dataclasses.field(default_factory=dict)
    exit_code: int | None = None
    # The verb's narration, line by line as it arrives. A list rather than a string because a viewer
    # watching the stream needs to ask "what is new since line N?" without re-reading the whole thing.
    log_lines: list[str] = dataclasses.field(default_factory=list)

    @property
    def log(self) -> str:
        return "\n".join(self.log_lines)

    @property
    def is_finished(self) -> bool:
        return self.state is JobState.FINISHED

    @property
    def changed_something(self) -> bool:
        """A refusal changes nothing — a fact the UI must be able to state without reading prose."""
        return self.outcome in (Outcome.OK, Outcome.ATTENTION)


class VerbNotAllowed(ValueError):
    """The requested verb is not in the sanctioned set. The list is the contract (bridge-api)."""


class PromotionNotReviewed(ValueError):
    """Promotion was requested without the review it must follow.

    This is enforced HERE, on the server, not merely by a disabled button. The bridge has to pass `--yes`
    to promote — stdin is closed, so the engine's own eighth gate (show the tally, type the store's name)
    cannot run — which means the bridge OWNS that gate. A guard that only exists in the UI would be
    bypassable by anything that can reach the endpoint, and this is the one irreversible act in the
    product.
    """


# The closed set this app may drive. Anything outside it is a defect, not a configuration option.
ALLOWED_VERBS = frozenset({"import", "rebuild", "verify", "promote", "diagnose", "raw-parse",
                           "fetch-prices", "fetch-fx", "fetch-instruments"})


class Runner:
    """Runs verbs, one at a time per workspace, and remembers what happened until the process ends."""

    def __init__(self, *, python: str | None = None, timeout: int = DEFAULT_TIMEOUT):
        self._python = python or sys.executable
        self._timeout = timeout
        self._jobs: dict[str, Job] = {}
        self._locks: dict[pathlib.Path, threading.Lock] = {}
        self._guard = threading.Lock()
        self._pids: set[int] = set()

    # ── introspection the UI needs ───────────────────────────────────────────────────────────────────

    @property
    def our_pids(self) -> frozenset[int]:
        """Processes this app started — the only basis on which a lock holder may be called ours."""
        with self._guard:
            return frozenset(self._pids)

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def jobs(self) -> list[Job]:
        return list(self._jobs.values())

    def is_busy(self, workspace: pathlib.Path) -> bool:
        lock = self._locks.get(pathlib.Path(workspace).resolve())
        return bool(lock and lock.locked())

    # ── running ──────────────────────────────────────────────────────────────────────────────────────

    def reviewed_rebuild(self, workspace: pathlib.Path) -> Job | None:
        """The most recent completed rebuild for this workspace, if there is one this session."""
        target = pathlib.Path(workspace).resolve()
        candidates = [
            job for job in self._jobs.values()
            if job.verb == "rebuild" and job.workspace == target and job.state is JobState.FINISHED
            and job.outcome in (Outcome.OK, Outcome.ATTENTION)
        ]
        return candidates[-1] if candidates else None

    def check_promotion(self, workspace: pathlib.Path, *, after: str | None, confirm: str,
                        expected: str) -> Job:
        """The gate the bridge owns. Returns the rebuild being promoted, or refuses."""
        if confirm != expected:
            raise PromotionNotReviewed(
                f"type {expected!r} to confirm you are replacing that store. Promotion is the one act "
                "here that cannot be undone.")
        rebuild = self.reviewed_rebuild(workspace)
        if rebuild is None:
            raise PromotionNotReviewed(
                "nothing has been rebuilt for this workspace in this session, so there is no tally to "
                "have reviewed. Run a rebuild, read the differences, then promote.")
        if after and after != rebuild.id:
            # The client is echoing a rebuild that is no longer the latest — so the tally on screen is not
            # the one that would be installed. Refuse rather than promote something unreviewed.
            raise PromotionNotReviewed(
                "a newer rebuild has finished since the tally you reviewed. Look at that one, then promote.")
        return rebuild

    def submit(self, verb: str, *, entity_id: str, workspace: pathlib.Path,
               args: list[str] | None = None) -> Job:
        """Register a job and run it on a worker thread. Returns immediately with the job in QUEUED."""
        job = self._new(verb, entity_id, workspace)
        threading.Thread(target=self._run, args=(job, args or []), daemon=True).start()
        return job

    def run(self, verb: str, *, entity_id: str, workspace: pathlib.Path,
            args: list[str] | None = None) -> Job:
        """Run to completion on the calling thread — the shape a test wants."""
        job = self._new(verb, entity_id, workspace)
        self._run(job, args or [])
        return job

    def _new(self, verb: str, entity_id: str, workspace: pathlib.Path) -> Job:
        if verb not in ALLOWED_VERBS:
            raise VerbNotAllowed(
                f"{verb!r} is not a verb this app may run. Allowed: {', '.join(sorted(ALLOWED_VERBS))}.")
        job = Job(id=uuid.uuid4().hex[:12], verb=verb, entity_id=entity_id,
                  workspace=pathlib.Path(workspace).resolve())
        self._jobs[job.id] = job
        return job

    def _lock_for(self, workspace: pathlib.Path) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(workspace, threading.Lock())

    def _run(self, job: Job, args: list[str]) -> None:
        lock = self._lock_for(job.workspace)
        with lock:                                   # queued until this workspace is free
            job.state = JobState.RUNNING
            try:
                self._invoke(job, args)
            except subprocess.TimeoutExpired:
                job.outcome = Outcome.FAILED
                job.message = (f"{job.verb} exceeded {self._timeout}s and was stopped. Nothing was "
                               "promoted; a rebuild leaves the live store untouched.")
            except Exception as e:                   # a job's failure is data, not a crash
                job.outcome = Outcome.FAILED
                job.message = f"could not run {job.verb}: {e}"
            finally:
                job.state = JobState.FINISHED

    def _invoke(self, job: Job, args: list[str]) -> None:
        cmd = [self._python, "-m", "wealthlens.cli", job.verb, *args, "--json"]
        # The workspace is passed by ENVIRONMENT, not by argument, and secrets are never passed at all:
        # anything on a command line is visible in the process table to every user on the machine.
        env = {**os.environ, "WEALTHLENS_DATA": str(job.workspace)}
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, bufsize=1, env=env)
        with self._guard:
            self._pids.add(proc.pid)

        # stdout is drained on its own thread so a chatty verb cannot fill the pipe and deadlock while we
        # are reading stderr — the classic subprocess hang, and a rebuild narrates for minutes.
        collected: list[str] = []
        pump = threading.Thread(target=lambda: collected.append(proc.stdout.read()), daemon=True)
        pump.start()
        try:
            for line in proc.stderr:                  # narration, live, in the order it happened
                job.log_lines.append(line.rstrip("\n"))
            proc.wait(timeout=self._timeout)
        finally:
            with self._guard:
                self._pids.discard(proc.pid)
        pump.join(timeout=10)
        out = collected[0] if collected else ""

        job.exit_code = proc.returncode
        try:
            envelope = json.loads(out)
        except json.JSONDecodeError:
            # stdout is contractually the envelope alone. If it is not parseable the engine is not the one
            # we think it is, and guessing from the exit code is exactly what this design refuses to do.
            job.outcome = Outcome.FAILED
            job.message = (f"{job.verb} did not return a readable result. This usually means the installed "
                           "WealthLens-core is older than this app supports.")
            return
        job.outcome = Outcome(envelope.get("outcome", Outcome.FAILED))
        job.gate = envelope.get("gate")
        job.message = envelope.get("message")
        job.result = {k: v for k, v in envelope.items()
                      if k not in {"verb", "outcome", "exit_code", "gate", "message"}}
