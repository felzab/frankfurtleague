from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.api.aktionen.admin_router import router as aktionen_admin_router
from app.api.bewerbungen.admin_router import router as bewerbungen_admin_router
from app.api.bewerbungen.router import router as bewerbungen_router
from app.api.kontakte.admin_router import router as kontakte_admin_router
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

# Reads in one group, writes in the other: `spielorte`, `schiedsrichter` and `bewerbungen` read under
# `verify_access_admin`, the rest under `verify_access_base`. Order between them carries nothing --
# the `objectid` convertor keeps a static path out of an id route.
READ_ROUTERS = (
    spiele_router,
    teams_router,
    spieltage_router,
    spieler_router,
    saisons_router,
    spielorte_router,
    schiedsrichter_router,
    bewerbungen_router,
)
WRITE_ROUTERS = (
    spiele_admin_router,
    teams_admin_router,
    spieltage_admin_router,
    spieler_admin_router,
    saisons_admin_router,
    spielorte_admin_router,
    schiedsrichter_admin_router,
    aktionen_admin_router,
    bewerbungen_admin_router,
    kontakte_admin_router,
)


def create_app(config: BackendConfig | None = None) -> FastAPI:
    """Build the application.

    A FUNCTION, so the composition root is a choice rather than an import side effect. Passing
    `config` also substitutes it for the request-scoped `Depends(get_config)`.
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
        # Every method the routers serve: one omitted is a preflight rejection waiting to happen.
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
        """Confirm the service is answering. The versioned API lives under `/api/v{API_VERSION}`; use `/system/is_live` for a probe."""
        return "Hello World"

    # Only when a caller supplied settings: installing this unconditionally would leave a test
    # unable to tell its own override from it.
    if injected:
        app.dependency_overrides[get_config] = lambda: config

    return app
