"""
APP · FastAPI application

Wires the whole service together: logging, exception handlers, three middlewares, fifteen routers --
`system`, then a read and a write router for each of the seven resources (ADR-0034).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Middleware order is significant. Starlette applies them in reverse registration order, so
    CorrelationIdMiddleware -- registered last -- runs first and a trace id exists before anything
    else can log.
  • `setup_custom_logger()` runs at import time, before the app exists, so startup failures are
    themselves logged in the right format.
  • Every router is registered here. A router that is written but not included serves nothing and
    fails silently -- there is no error for a route that was never mounted.

 KNOWN GAP ────────────────────────────────────────────────────────────────────────────────────────────────

  The app declares no `title` or `description`, so /openapi.json carries no service-level prose. The
  Swagger UI is also not publicly routed -- nginx sends /api here, but FastAPI's own /docs sits at the
  app root, which nginx sends to Next.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/overview.md
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.api.saisons.admin_router import router as saisons_admin_router
from app.api.saisons.router import router as saisons_router
from app.api.schiedsrichter.admin_router import router as schiedsrichter_admin_router
from app.api.schiedsrichter.router import router as schiedsrichter_router
from app.api.spiele.admin_router import router as spiele_admin_router
from app.api.spiele.router import router as spiele_router
from app.api.spieler.admin_router import router as spieler_admin_router
from app.api.spieler.router import router as spieler_router
from app.api.spielorte.admin_router import router as spielorte_admin_router
from app.api.spielorte.router import router as spielorte_router
from app.api.spieltage.admin_router import router as spieltage_admin_router
from app.api.spieltage.router import router as spieltage_router
from app.api.system.router import router as system_router
from app.api.teams.admin_router import router as teams_admin_router
from app.api.teams.router import router as teams_router
from app.core.config import backend_config
from app.core.db import lifespan
from app.core.exception_handlers import register_exception_handlers
from app.core.logging import setup_custom_logger
from app.core.middlewares import CorrelationIdMiddleware

setup_custom_logger()

app = FastAPI(lifespan=lifespan)

register_exception_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=backend_config.api_cors_allowed_origins_list,
    allow_credentials=True,
    # Every method the routers actually serve. No impact today -- the only client calls server-side,
    # where CORS does not apply -- but a list that omits a served method is a preflight rejection
    # waiting for the first browser call.
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=backend_config.api_trusted_hosts_list)
app.add_middleware(CorrelationIdMiddleware)

app.include_router(system_router)

# Reads, under `verify_access_base`.
app.include_router(spiele_router)
app.include_router(teams_router)
app.include_router(spieltage_router)
app.include_router(spieler_router)
app.include_router(saisons_router)
app.include_router(spielorte_router)
app.include_router(schiedsrichter_router)

# Writes, under `verify_access_admin`. A separate router per slice rather than one admin router, so the
# guard stays attached at router level and an endpoint reaches the wrong authorization only by being
# written in the wrong FILE (ADR-0034). Order relative to the reads above is NOT significant: the
# `objectid` convertor keeps `/spiele/action_required` from being captured by `/spiele/{spiel_id}`
# (app/core/routing.py).
app.include_router(spiele_admin_router)
app.include_router(teams_admin_router)
app.include_router(spieltage_admin_router)
app.include_router(spieler_admin_router)
app.include_router(saisons_admin_router)
app.include_router(spielorte_admin_router)
app.include_router(schiedsrichter_admin_router)


@app.get("/")
def root():
    return "Hello World"
