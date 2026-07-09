from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.api.admin.router import router as admin_router
from app.api.saisons.router import router as saisons_router
from app.api.schiedsrichter.router import router as schiedsrichter_router
from app.api.spiele.router import router as spiele_router
from app.api.spieler.router import router as spieler_router
from app.api.spielorte.router import router as spielorte_router
from app.api.spieltage.router import router as spieltage_router
from app.api.system.router import router as system_router
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
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=backend_config.api_trusted_hosts_list
)
app.add_middleware(CorrelationIdMiddleware)

app.include_router(admin_router)
app.include_router(spiele_router)
app.include_router(system_router)
app.include_router(teams_router)
app.include_router(spieltage_router)
app.include_router(spieler_router)
app.include_router(saisons_router)
app.include_router(spielorte_router)
app.include_router(schiedsrichter_router)


@app.get("/")
def root():
    return "Hello World"
