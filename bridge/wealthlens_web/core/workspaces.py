"""Resolving a declared workspace into something readable — or saying precisely why not.

Every view in this app can be blocked by one of a handful of conditions, and they are **not**
interchangeable: a store nobody has created, a store held by a running verb, and a store built by a
different engine all render as "no data" if you let them, and a household reading "no holdings" when their
store was merely locked has been told something false about their money.

So the reasons are an enumeration, defined once here, and every layer above renders from it. This is the
error taxonomy the design review found missing — a generated-types contract needs it to exist before the
frontend can branch on it.

Reading is delegated to WLC's `wealthlens.workspace`, which opens a *named* store read-only with that
workspace's own key. Nothing here reaches around it: no `ATTACH`, no key handling, no store paths beyond
the one the manifest declared.
"""
from __future__ import annotations

import dataclasses
import enum
import pathlib

from wealthlens_web import engine as _engine
from wealthlens_web.core.manifest import Entity


class Availability(enum.StrEnum):
    """Why a workspace can or cannot be read right now. The order is the order a caller should check."""

    OK = "ok"
    NO_ENGINE = "no_engine"          # WealthLens-core isn't installed, so nothing can be read at all
    MISSING = "missing"              # the declared path, or its store, isn't there
    BUSY = "busy"                    # another process holds it; it will free up on its own, or it won't
    SCHEMA_SKEW = "schema_skew"      # built by a different engine — readable, but not aggregatable
    UNREADABLE = "unreadable"        # it exists and is not busy, and still would not open

    @property
    def is_readable(self) -> bool:
        return self is Availability.OK


@dataclasses.dataclass(frozen=True)
class Holder:
    """The process holding a store, as the database reported it — never as a guess.

    `ours` is the only classification made, because it is the only one that can be *known*: a WealthLens
    verb and a Jupyter kernel are both "python", so identity cannot be inferred from the executable. A
    caller that launched the process knows its pid; anything else says it does not know.
    """

    process: str
    pid: int
    ours: bool = False


@dataclasses.dataclass(frozen=True)
class WorkspaceStatus:
    """One declared workspace, and whether it can be read."""

    path: pathlib.Path
    availability: Availability
    detail: str | None = None
    schema_version: str | None = None
    engine_version: str | None = None
    holder: Holder | None = None

    @property
    def is_readable(self) -> bool:
        return self.availability.is_readable

    @property
    def label(self) -> str:
        """A short, human-meaningful name for this store — the workspace folder's own name."""
        return self.path.name


def check(path: pathlib.Path, *, our_pids: frozenset[int] = frozenset()) -> WorkspaceStatus:
    """Establish whether one workspace can be read, and if not, exactly why.

    `our_pids` are processes this app started. It is the only basis on which a lock holder is called ours.
    """
    eng = _engine.preflight()
    if not eng.usable:
        return WorkspaceStatus(path, Availability.NO_ENGINE, detail=eng.detail)

    from wealthlens import workspace as wl_workspace

    try:
        ws = wl_workspace.resolve(path)
    except wl_workspace.WorkspaceError as e:
        return WorkspaceStatus(path, Availability.MISSING, detail=str(e), engine_version=eng.schema_version)

    if not ws.store_path.exists():
        return WorkspaceStatus(
            path, Availability.MISSING, engine_version=eng.schema_version,
            detail=f"no store in {path.name} — it may never have been initialised")

    try:
        version = ws.schema_version()
    except wl_workspace.StoreLocked as e:
        holder = None
        if e.holder is not None:
            holder = Holder(process=e.holder.process, pid=e.holder.pid, ours=e.holder.pid in our_pids)
        return WorkspaceStatus(path, Availability.BUSY, detail=str(e), holder=holder,
                               engine_version=eng.schema_version)
    except wl_workspace.WorkspaceError as e:
        return WorkspaceStatus(path, Availability.UNREADABLE, detail=str(e),
                               engine_version=eng.schema_version)

    if version != eng.schema_version:
        return WorkspaceStatus(
            path, Availability.SCHEMA_SKEW, schema_version=version, engine_version=eng.schema_version,
            detail=(f"{path.name} is at schema {version or 'unversioned'} and this engine is "
                    f"{eng.schema_version}. Rebuild it with this engine and promote, then it rejoins "
                    "aggregate views."))

    return WorkspaceStatus(path, Availability.OK, schema_version=version, engine_version=eng.schema_version)


def check_entity(entity: Entity, *, our_pids: frozenset[int] = frozenset()) -> list[WorkspaceStatus]:
    """Every workspace an entity declares. An entity may legitimately span more than one."""
    return [check(p, our_pids=our_pids) for p in entity.workspaces]
