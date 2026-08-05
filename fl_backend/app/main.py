"""
APP · the application factory

Builds the FastAPI application: logging, exception handlers, three middlewares, fifteen routers --
`system`, then a read and a write router for each of the seven resources (ADR-0034).

**This module creates no application when imported.** `create_app()` is a function so that the
composition root is a choice rather than an import side effect: the process entry point is
`app/asgi.py`, and a test builds its own app with its own settings. Importing this module therefore
needs no environment at all.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Middleware order is significant. Starlette applies them in reverse registration order, so
    CorrelationIdMiddleware -- registered last -- runs first and a correlation id exists before
    anything else can log.
  • `setup_custom_logger` runs BEFORE the app is constructed, so a failure during construction is
    itself logged in the right format.
  • Every router is registered here. A router that is written but not included serves nothing and
    fails silently -- there is no error for a route that was never mounted.

 KNOWN GAP ────────────────────────────────────────────────────────────────────────────────────────────────

  The app declares no `title` or `description`, so /openapi.json carries no service-level prose. The
  Swagger UI is also not publicly routed -- nginx sends /api here, but FastAPI's own /docs sits at the
  app root, which nginx sends to Next.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  app/asgi.py -- the process entry point
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
from app.core.config import BackendConfig, get_config
from app.core.db import lifespan
from app.core.exception_handlers import register_exception_handlers
from app.core.logging import setup_custom_logger
from app.core.middlewares import CorrelationIdMiddleware

# Reads under `verify_access_base`, writes under `verify_access_admin`. Order between the two groups is
# NOT significant: the `objectid` convertor keeps `/spiele/action_required` from being captured by
# `/spiele/{spiel_id}` (app/core/routing.py, ADR-0034).
READ_ROUTERS = (spiele_router, teams_router, spieltage_router, spieler_router, saisons_router, spielorte_router, schiedsrichter_router)
WRITE_ROUTERS = (
    spiele_admin_router,
    teams_admin_router,
    spieltage_admin_router,
    spieler_admin_router,
    saisons_admin_router,
    spielorte_admin_router,
    schiedsrichter_admin_router,
)


def create_app(config: BackendConfig | None = None) -> FastAPI:
    """
    Build the application.

    `config` is injectable so a test can supply its own settings object rather than arranging the
    environment and hoping about import order. Passing one also substitutes it for the request-scoped
    `Depends(get_config)`, so the guards in `core/security.py` and the database name in `core/db.py`
    all agree with what this app was built from.
    """
    injected = config is not None
    config = config or get_config()

    # Before the app exists, so a failure while constructing it is logged in the right format.
    setup_custom_logger(config)

    app = FastAPI(lifespan=lifespan)

    register_exception_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.api_cors_allowed_origins_list,
        allow_credentials=True,
        # Every method the routers actually serve. No impact today -- the only client calls
        # server-side, where CORS does not apply -- but a list that omits a served method is a
        # preflight rejection waiting for the first browser call.
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.api_trusted_hosts_list)
    app.add_middleware(CorrelationIdMiddleware)

    app.include_router(system_router)
    for router in (*READ_ROUTERS, *WRITE_ROUTERS):
        app.include_router(router)

    @app.get("/")
    def root():
        return "Hello World"

    # ONLY when a caller supplied settings. `dependency_overrides` is FastAPI's substitution seam for
    # tests, so installing it unconditionally would spend it in production to replace `get_config`
    # with a function returning exactly what `get_config` returns -- and would leave a test unable to
    # tell its own override from the factory's.
    if injected:
        app.dependency_overrides[get_config] = lambda: config

    return app
