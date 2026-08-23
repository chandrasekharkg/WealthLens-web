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

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from wealthlens_web import engine as _engine
from wealthlens_web.api import models
from wealthlens_web.api.security import LocalOnly, new_token
from wealthlens_web.core import (
    aggregate,
    collateral,
    inbox,
    lens_api,
    manifest,
    provenance,
    reports,
    settings,
    verbs,
    workspaces,
)

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

    @app.get("/api/version", response_model=models.Version)
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

    @app.get("/api/networth", response_model=models.NetWorth)
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
            "stale_count": got.stale_count,
            "entities": [_entity_total(e, got.as_of) for e in got.entities],
            "provenance": provenance.for_net_worth(got).as_dict(),
        }

    @app.get("/api/reports", response_model=list[models.ReportSummary])
    def report_list() -> list[dict]:
        """What reports exist. Static — no store is opened, so the nav renders before any data loads."""
        return reports.catalogue()

    @app.get("/api/reports/{report_id}", response_model=models.Report)
    def report(report_id: str, on: str | None = Query(default=None)) -> dict:
        try:
            built = reports.build(_manifest(), report_id, on=on,
                                  our_pids=app.state.runner.our_pids)
        except KeyError:
            known = ", ".join(r["id"] for r in reports.catalogue())
            raise HTTPException(status_code=404, detail={"error": "report", "reason":
                                f"no report {report_id!r} — there is {known}"}) from None
        return {**built, "sections": [
            {**section,
             "rows": [_row(r) for r in section["rows"]],
             "total": section["total"].as_dict() if section["total"] else None}
            for section in built["sections"]]}

    @app.get("/api/positions", response_model=models.Positions)
    def positions(on: str | None = Query(default=None)) -> dict:
        return _rows(aggregate.positions(_manifest(), on=on, our_pids=app.state.runner.our_pids),
                     filters=(f"as of {on}",) if on else ())

    @app.get("/api/transactions", response_model=models.Transactions)
    def transactions(since: str | None = Query(default=None),
                     until: str | None = Query(default=None)) -> dict:
        window = tuple(f for f in (f"from {since}" if since else None,
                                   f"to {until}" if until else None) if f)
        return _rows(aggregate.transactions(_manifest(), since=since, until=until,
                                            our_pids=app.state.runner.our_pids), filters=window)

    # ── credit cards: the picker, then one statement drilled into ─────────────────────────────────────

    @app.get("/api/cards", response_model=models.Cards)
    def cards() -> dict:
        return _rows(aggregate.cards(_manifest(), our_pids=app.state.runner.our_pids))

    @app.get("/api/card-bill-payments", response_model=models.CardBillPayments)
    def card_bill_payments() -> dict:
        return _rows(aggregate.card_bill_payments(_manifest(), our_pids=app.state.runner.our_pids))

    @app.get("/api/family", response_model=models.Family)
    def family() -> dict:
        return _rows(aggregate.family_transfers(_manifest(), our_pids=app.state.runner.our_pids))

    @app.get("/api/family/{entity_id}/{person}/transfers", response_model=models.FamilyTransfers)
    def family_transfers(entity_id: str, person: str, named: str | None = Query(default=None)) -> dict:
        m = _manifest()
        path = _target_workspace(m, entity_id, named)
        from wealthlens import workspace as wl_workspace
        with wl_workspace.resolve(path).open() as con:
            transfers = lens_api.transfers_to(con, person=person, currency=m.reporting_currency)
        return {"entity_id": entity_id, "person": person, "transfers": [_row(t) for t in transfers],
                "provenance": provenance.for_drilldown(
                    title=f"Transfers to {person}", scope=m.entity(entity_id).label,
                    reporting_currency=m.reporting_currency, row_count=len(transfers)).as_dict()}

    @app.get("/api/performance", response_model=models.Performance)
    def performance() -> dict:
        got = aggregate.performance(_manifest(), our_pids=app.state.runner.our_pids)
        return {
            "reporting_currency": got["reporting_currency"],
            "total": got["total"].as_dict() if got["total"] else None,
            "breakup": [_row(b) for b in got["breakup"]],
            "series": [_row(p) for p in got["series"]],
            "axis_max": got["axis_max"].as_dict() if got["axis_max"] else None,
            "axis_ticks": [t.as_dict() for t in got["axis_ticks"]],
        }

    @app.get("/api/cards/{entity_id}/{issuer}/statements", response_model=models.CardStatements)
    def card_statements(entity_id: str, issuer: str, named: str | None = Query(default=None)) -> dict:
        m = _manifest()
        path = _target_workspace(m, entity_id, named)
        from wealthlens import workspace as wl_workspace
        with wl_workspace.resolve(path).open() as con:
            stmts = lens_api.card_statements(con, issuer=issuer, currency=m.reporting_currency)
        return {"entity_id": entity_id, "issuer": issuer, "statements": [_row(s) for s in stmts]}

    @app.get("/api/cards/{entity_id}/{issuer}/statement", response_model=models.CardStatement)
    def card_statement(entity_id: str, issuer: str, period: str | None = Query(default=None),
                       named: str | None = Query(default=None)) -> dict:
        m = _manifest()
        path = _target_workspace(m, entity_id, named)
        from wealthlens import workspace as wl_workspace
        with wl_workspace.resolve(path).open() as con:
            st = lens_api.card_statement(con, issuer=issuer, period=period, currency=m.reporting_currency)
        st["entity_id"] = entity_id
        st["transactions"] = [_row(t) for t in st["transactions"]]
        st["provenance"] = provenance.for_drilldown(
            title=f"{issuer} statement", scope=m.entity(entity_id).label, as_of=st.get("statement_date"),
            reporting_currency=m.reporting_currency, row_count=len(st["transactions"])).as_dict()
        return _row(st)

    @app.get("/api/holdings/{entity_id}/{instrument_id}/diary", response_model=models.HoldingDiary)
    def holding_diary(entity_id: str, instrument_id: str, named: str | None = Query(default=None)) -> dict:
        m = _manifest()
        path = _target_workspace(m, entity_id, named)
        from wealthlens import workspace as wl_workspace
        with wl_workspace.resolve(path).open() as con:
            diary = lens_api.holding_diary(con, instrument=instrument_id, currency=m.reporting_currency)
        if diary.get("performance"):
            diary["performance"] = _row(diary["performance"])   # its ₹ figures are Money → serialise them
        return {"entity_id": entity_id, **diary,
                "provenance": provenance.for_drilldown(
                    title=diary.get("name") or instrument_id, scope=m.entity(entity_id).label,
                    reporting_currency=m.reporting_currency, row_count=len(diary.get("lines", []))).as_dict()}

    # ── the custodian, made legible ──────────────────────────────────────────────────────────────────

    @app.get("/api/workspace/{entity_id}", response_model=models.WorkspaceDetail)
    def workspace_detail(entity_id: str) -> dict:
        """Where an entity's money physically lives, what state it is in, and what built it."""
        m = _manifest()
        target = _target_workspace(m, entity_id, None)
        status = workspaces.check(target, our_pids=app.state.runner.our_pids)

        documents: list[dict] = []
        if status.is_readable:
            from wealthlens import workspace as wl_workspace
            with wl_workspace.resolve(target).open() as con:
                documents = [d.as_dict() for d in collateral.documents(con, target)]

        return {
            "entity_id": entity_id,
            "path": str(target),
            "workspace": _workspace(status),
            "settings": settings.read(target).as_dict(),
            "documents": documents,
        }

    @app.post("/api/workspace/{entity_id}/settings", response_model=models.SettingsInfo)
    def change_settings(entity_id: str, body: dict) -> dict:
        """Change one setting. Everything bootstrap asks is editable here (identity-and-settings)."""
        target = _target_workspace(_manifest(), entity_id, None)
        try:
            if "holder_names" in body:
                got = settings.set_holder_names(target, list(body["holder_names"]))
            elif "pan" in body:
                got = settings.set_pan(target, str(body["pan"]))
            elif "organize" in body:
                got = settings.set_organize(target, bool(body["organize"]))
            elif "secret" in body:
                secret = body["secret"]
                got = settings.add_secret(target, str(secret.get("name", "")), str(secret.get("value", "")))
            else:
                raise HTTPException(status_code=400, detail={"error": "field", "reason":
                                    "name a setting to change"})
        except settings.SettingsError as e:
            raise HTTPException(status_code=400,
                                detail={"error": "settings", "reason": str(e), "field": e.field}) from None
        return got.as_dict()

    @app.post("/api/workspace/{entity_id}/reveal", response_model=models.Revealed)
    def reveal_secret(entity_id: str, body: dict) -> dict:
        """Release ONE re-obtainable secret, on an explicit request (ADR-0019).

        Its own endpoint, deliberately: a value must never be reachable by asking for a list. There is no
        equivalent for the store key, and there will not be — it cannot be re-obtained.
        """
        target = _target_workspace(_manifest(), entity_id, None)
        what = str(body.get("what", ""))
        try:
            value = settings.reveal(target, what)
        except settings.SettingsError as e:
            raise HTTPException(status_code=404,
                                detail={"error": "secret", "reason": str(e), "field": e.field}) from None
        return {"what": what, "value": value}

    @app.post("/api/workspace/{entity_id}/open", response_model=models.Opened)
    def open_document(entity_id: str, body: dict) -> dict:
        """Ask the OS to open ONE collateral file. WLW never reads a statement (ADR-0001) — this hands the
        file to the platform's opener. The path is never trusted: `collateral.resolve_document_path` refuses
        anything that escapes the workspace, so even a tampered filename cannot reach outside it."""
        target = _target_workspace(_manifest(), entity_id, None)
        try:
            real = collateral.open_document(
                target, payload_ref=body.get("payload_ref"),
                provider=body.get("provider"), filename=body.get("filename"))
        except collateral.DocumentNotFound as e:
            raise HTTPException(status_code=404, detail={"error": "document", "reason": str(e)}) from None
        return {"path": str(real)}

    @app.get("/api/jobs", response_model=list[models.Job])
    def list_jobs() -> list[dict]:
        """Everything this session has run. In memory by design (ADR-0002) — the UI says so."""
        return [_job(job) for job in reversed(app.state.runner.jobs())]

    # ── the one side-effecting surface ───────────────────────────────────────────────────────────────

    def _target_workspace(m: manifest.Manifest, entity_id: str, named: str | None) -> pathlib.Path:
        """The one workspace a side effect may touch, checked against what the manifest declared."""
        try:
            entity = m.entity(entity_id)
        except manifest.ManifestError as e:
            # Naming an entity the household has not declared is the caller's mistake, not a server fault —
            # and the manifest already knows which ids WOULD have worked, so the answer says so.
            raise HTTPException(status_code=404, detail={"error": "entity", "reason": str(e)}) from None
        if entity.has_several_workspaces and not named:
            raise HTTPException(status_code=400, detail={"error": "workspace", "reason":
                                f"{entity_id} declares several workspaces; name which one"})
        target = pathlib.Path(named) if named else entity.workspaces[0]
        if target.resolve() not in {p.resolve() for p in entity.workspaces}:
            raise HTTPException(status_code=400, detail={"error": "workspace", "reason":
                                "that workspace is not declared for this entity"})
        return target

    @app.post("/api/upload", response_model=models.Deposit, status_code=201)
    async def upload(entity: str = Form(...), file: UploadFile = File(...),
                     workspace: str | None = Form(default=None)) -> dict:
        """Deposit a statement into one entity's inbox — and do nothing else with it.

        No parsing, no store write, no look inside. Importing is a separate, explicit act with WLC's gates
        in front of it (ADR-0005).
        """
        target = _target_workspace(_manifest(), entity, workspace)
        try:
            landed = inbox.deposit(target, file.filename or "", await file.read())
        except inbox.RejectedUpload as e:
            raise HTTPException(status_code=400,
                                detail={"error": "upload", "reason": str(e), "rule": e.reason}) from None
        return {"filename": landed.name, "renamed_from": landed.renamed_from,
                "entity_id": entity, "inbox": inbox.INBOX}

    @app.post("/api/jobs", response_model=models.Job, status_code=202)
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
        target = _target_workspace(m, entity_id, body.get("workspace"))

        args: list[str] = []
        if verb == "promote":
            # stdin is closed, so the engine's own final gate — show the tally, type the store's name —
            # cannot run and this bridge owns it instead. Enforced server-side: a disabled button is not a
            # guard for the one irreversible act in the product.
            try:
                app.state.runner.check_promotion(
                    target, after=body.get("after"), confirm=str(body.get("confirm", "")),
                    expected=entity_id)
            except verbs.PromotionNotReviewed as e:
                raise HTTPException(status_code=409,
                                    detail={"error": "unreviewed", "reason": str(e)}) from None
            args = ["--yes"]

        try:
            job = app.state.runner.submit(verb, entity_id=entity_id, workspace=target, args=args)
        except verbs.VerbNotAllowed as e:
            raise HTTPException(status_code=400, detail={"error": "verb", "reason": str(e)}) from None
        return JSONResponse(_job(job), status_code=202)

    @app.get("/api/jobs/{job_id}/stream")
    def job_stream(job_id: str) -> StreamingResponse:
        """Watch a running verb as server-sent events.

        The stream carries the verb's own narration as OPAQUE lines. Only `import` publishes structure
        mid-run, so parsing prose into a progress bar would mean inventing a contract that does not exist
        and breaking it on the next copy edit upstream. Lines now, structure when the engine offers it.

        The stream is a convenience, never the record: the outcome stays retrievable from the job endpoint
        after the stream closes, so a viewer who navigates away or reconnects still learns what happened.
        """
        job = app.state.runner.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail={"error": "unknown_job", "reason": _FORGOTTEN})
        return StreamingResponse(_events(job), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/api/jobs/{job_id}", response_model=models.Job)
    def job_status(job_id: str) -> dict:
        job = app.state.runner.get(job_id)
        if job is None:
            # In-memory by design (ADR-0002), so say which it is: forgotten, not never-existed.
            raise HTTPException(status_code=404, detail={"error": "unknown_job", "reason": _FORGOTTEN})
        return _job(job)

    # ── the page itself ──────────────────────────────────────────────────────────────────────────────
    # Serving the built SPA is what lets the token be "issued with the page": it is written into the HTML
    # at serve time, so a script on another origin cannot read it (ADR-0004). A dev server running Vite
    # separately simply has no dist/ and this is skipped.
    dist = pathlib.Path(__file__).resolve().parents[3] / "frontend" / "dist"
    index = dist / "index.html"
    if index.exists():
        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        def page() -> HTMLResponse:
            return HTMLResponse(index.read_text().replace("__WLW_TOKEN__", app.state.token))

        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    return app


_FORGOTTEN = ("no such job in this session — a restart forgets what ran, and the store is unaffected. "
              "Run `verify` or `rebuild --check` to see where it stands.")


def _events(job: verbs.Job):
    """Yield narration as it arrives, then one final event carrying the outcome."""
    import json as _json
    import time

    sent = 0
    while True:
        lines = job.log_lines[sent:]
        for line in lines:
            yield f"event: log\ndata: {_json.dumps(line)}\n\n"
        sent += len(lines)
        if job.is_finished and sent >= len(job.log_lines):
            break
        time.sleep(0.05)
    yield f"event: done\ndata: {_json.dumps(_job(job))}\n\n"


# ── serialisation ────────────────────────────────────────────────────────────────────────────────────

def _entity_total(e: aggregate.EntityView, as_of: str | None = None) -> dict:
    return {
        "entity_id": e.entity_id,
        "label": e.label,
        "owner": e.owner,
        "total": e.total.as_dict() if e.total else None,
        "evidence_as_of": e.evidence_as_of,
        "contributes": e.contributes,
        "status": e.status(as_of),
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


def _rows(got: aggregate.FamilyRows, *, filters: tuple[str, ...] = ()) -> dict:
    return {
        "provenance": provenance.for_rows(got, filters=filters).as_dict(),
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
