"""The bridge's HTTP surface.

A thin shell: every endpoint resolves the manifest, calls one `core/` function, and serialises the answer.
No endpoint computes a figure, and no endpoint writes a store — the side-effecting set is closed and
enumerated (bridge-api), and every one of them is a hand-off to a WealthLens-core verb.

Responses carry the honesty fields at the top level rather than tucked inside a data block, because a
client that has to go looking for "is this partial?" is a client that will forget to.
"""
from __future__ import annotations

import dataclasses
import pathlib

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from wealthlens_web import engine as _engine
from wealthlens_web.api.security import LocalOnly, new_token
from wealthlens_web.core import aggregate, manifest, verbs, workspaces

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 7788


def create_app(manifest_path: str | pathlib.Path, *, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT,
               token: str | None = None, runner: verbs.Runner | None = None) -> FastAPI:
    app = FastAPI(title="WealthLens", docs_url=None, redoc_url=None)
    app.state.manifest_path = pathlib.Path(manifest_path)
    app.state.token = token or new_token()
    app.state.runner = runner or verbs.Runner()
    origin = f"http://{host}:{port}"
    app.add_middleware(LocalOnly, origin=origin, token=app.state.token)

    def _manifest() -> manifest.Manifest:
        try:
            return manifest.load(app.state.manifest_path)
        except manifest.ManifestError as e:
            # A broken manifest is a configuration problem with a fix, not a server fault.
            raise HTTPException(status_code=422, detail={"error": "manifest", "reason": str(e)}) from None

    # ── what is installed, and what each store is at ─────────────────────────────────────────────────

    @app.get("/api/version")
    def version() -> dict:
        """Engine presence and per-store versions, read at request time — never remembered (ADR-0017)."""
        eng = _engine.preflight()
        stores = []
        if eng.usable:
            try:
                m = _manifest()
            except HTTPException:
                m = None
            for entity in (m.entities if m else ()):
                for status in workspaces.check_entity(entity, our_pids=app.state.runner.our_pids):
                    stores.append({"entity_id": entity.id, "workspace": status.label,
                                   "schema_version": status.schema_version,
                                   "availability": status.availability})
        return {"engine": {"present": eng.present, "schema_version": eng.schema_version,
                           "detail": eng.detail},
                "stores": stores}

    # ── reads, at a stated granularity ───────────────────────────────────────────────────────────────

    @app.get("/api/networth")
    def networth(on: str | None = Query(default=None)) -> dict:
        m = _manifest()
        try:
            got = aggregate.net_worth(m, on=on, our_pids=app.state.runner.our_pids)
        except aggregate.UnsupportedReportingCurrency as e:
            raise HTTPException(status_code=422, detail={"error": "currency", "reason": str(e)}) from None
        return {
            "granularity": aggregate.Granularity.AGGREGATE,
            "as_of": got.as_of,
            "reporting_currency": got.reporting_currency,
            "total": got.total.as_dict() if got.total else None,
            "is_partial": got.is_partial,
            "entities": [_entity_total(e) for e in got.entities],
        }

    @app.get("/api/positions")
    def positions(on: str | None = Query(default=None)) -> dict:
        return _rows(aggregate.positions(_manifest(), on=on, our_pids=app.state.runner.our_pids))

    @app.get("/api/transactions")
    def transactions(since: str | None = Query(default=None),
                     until: str | None = Query(default=None)) -> dict:
        return _rows(aggregate.transactions(_manifest(), since=since, until=until,
                                            our_pids=app.state.runner.our_pids))

    # ── the one side-effecting surface ───────────────────────────────────────────────────────────────

    @app.post("/api/jobs")
    def start_job(body: dict) -> JSONResponse:
        """Run a WLC verb against exactly one named, manifest-declared workspace.

        There is no "run against all": each store has its own gates, its own key and its own lock, and a
        fan-out would hide which one refused.
        """
        m = _manifest()
        verb = str(body.get("verb", ""))
        entity_id = str(body.get("entity", ""))
        if not entity_id:
            raise HTTPException(status_code=400, detail={"error": "entity", "reason":
                                "name exactly one entity — there is no import-into-all"})
        entity = m.entity(entity_id)
        if entity.has_several_workspaces and not body.get("workspace"):
            raise HTTPException(status_code=400, detail={"error": "workspace", "reason":
                                f"{entity_id} declares several workspaces; name which one"})
        target = pathlib.Path(body["workspace"]) if body.get("workspace") else entity.workspaces[0]
        if target.resolve() not in {p.resolve() for p in entity.workspaces}:
            raise HTTPException(status_code=400, detail={"error": "workspace", "reason":
                                "that workspace is not declared for this entity"})
        try:
            job = app.state.runner.submit(verb, entity_id=entity_id, workspace=target)
        except verbs.VerbNotAllowed as e:
            raise HTTPException(status_code=400, detail={"error": "verb", "reason": str(e)}) from None
        return JSONResponse(_job(job), status_code=202)

    @app.get("/api/jobs/{job_id}")
    def job_status(job_id: str) -> dict:
        job = app.state.runner.get(job_id)
        if job is None:
            # In-memory by design (ADR-0002), so say which it is: forgotten, not never-existed.
            raise HTTPException(status_code=404, detail={"error": "unknown_job", "reason":
                                "no such job in this session — a restart forgets what ran, and the store "
                                "is unaffected. Run `verify` or `rebuild --check` to see where it stands."})
        return _job(job)

    return app


# ── serialisation ────────────────────────────────────────────────────────────────────────────────────

def _entity_total(e: aggregate.EntityView) -> dict:
    return {
        "entity_id": e.entity_id,
        "label": e.label,
        "owner": e.owner,
        "total": e.total.as_dict() if e.total else None,
        "evidence_as_of": e.evidence_as_of,
        "contributes": e.contributes,
        "excluded_reason": e.excluded_reason,
        "owner_warning": e.owner_warning,
        "workspaces": [_workspace(w) for w in e.workspaces],
        "by_class": [{"asset_class": r["asset_class"], "value": r["value"].as_dict(),
                      "basis": r.get("basis")} for r in e.by_class],
    }


def _workspace(w: workspaces.WorkspaceStatus) -> dict:
    return {
        "label": w.label,
        "availability": w.availability,
        "detail": w.detail,
        "schema_version": w.schema_version,
        "holder": dataclasses.asdict(w.holder) if w.holder else None,
    }


def _rows(got: aggregate.FamilyRows) -> dict:
    return {
        "granularity": got.granularity,
        "as_of": got.as_of,
        "reporting_currency": got.reporting_currency,
        "is_partial": got.is_partial,
        "excluded": [{"entity_id": e.entity_id, "label": e.label, "reason": e.excluded_reason,
                      "owner_warning": e.owner_warning} for e in got.excluded],
        "rows": [_row(r) for r in got.rows()],
    }


def _row(r: dict) -> dict:
    """Money is serialised as amount + currency, never as a bare number (data-conventions)."""
    from wealthlens_web.core.money import Money
    return {k: (v.as_dict() if isinstance(v, Money) else v) for k, v in r.items()}


def _job(job: verbs.Job) -> dict:
    return {
        "id": job.id,
        "verb": job.verb,
        "entity_id": job.entity_id,
        "state": job.state,
        "outcome": job.outcome,
        "gate": job.gate,
        "message": job.message,
        "changed_something": job.changed_something,
        "result": job.result,
        # Recorded, never interpreted: `outcome` is the authority (WLC's job contract).
        "exit_code": job.exit_code,
    }
