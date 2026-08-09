"""
CORE · backend configuration

Every environment variable the service reads, declared once as a pydantic-settings model, plus
the one thing that deliberately is not one — `API_VERSION` is a constant, not a setting.
Anything absent from both is a hardcoded constant somewhere, which is usually a defect.

Invariants:
- Secrets are `SecretStr`; reach a value only through `.get_secret_value()`, where it is used.
- Fields without a default are required at boot, and the three API keys never gain one.
- Nothing constructs the settings at import time — `get_config()` builds them.

See:
- docs/backend/spec.md — the environment section
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]

# The version every router prefixes itself with, and it is a property of THIS CODE rather than of a
# deployment. As an environment variable it was a footgun with three warnings around it: the container
# healthcheck in docker-compose.yml hardcodes `/api/v0/`, so the two could disagree and a service would
# then answer nothing on the path its own healthcheck probes. Worse, a deployment could set `2` and
# serve `/api/v2/` from code implementing v0 -- announcing a contract it does not honour.
#
# Bumping it is a code change, made here, in the same commit as the compose healthcheck it must match.
# The FRONTEND keeps its own `API_VERSION` env var, and that one is legitimate: a client genuinely does
# choose which version of an API to call.
API_VERSION = 0


class BackendConfig(BaseSettings):
    # API config
    api_trusted_hosts: str = Field(description="The trusted hosts for this API")
    api_cors_allowed_origins: str = Field(description="The allowed CORS origins for this API")

    @property
    def api_trusted_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.api_trusted_hosts.split(",")]

    @property
    def api_cors_allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.api_cors_allowed_origins.split(",")]

    # MongoDB Configuration
    mongodb_uri: SecretStr = Field(description="MongoDB Connection URI")
    db_base_name: str = Field(description="Base DB name")
    db_server_selection_timeout: int = Field(default=15000, description="MongoDB server-selection timeout in ms")
    db_min_connections: int = Field(default=5, description="Min pool size")
    db_max_connections: int = Field(default=100, description="Max pool size")

    # Security Configuration
    internal_api_key_base: SecretStr = Field(description="Base internal API-key")
    internal_api_key_system: SecretStr = Field(description="Internal API-key for the system router")
    internal_api_key_admin: SecretStr = Field(description="Internal API-key for the admin router")

    # Logging
    log_level_app: LogLevel = Field(
        default="INFO",
        description="The minimal level a log has to reach to be processed",
    )
    log_level_db: LogLevel = Field(
        default="WARNING",
        description="The minimal level a database related log has to reach to be processed",
    )
    # Defaults to the PRODUCTION format on purpose: a production `.env` that omits the variable must
    # not silently log ANSI-colourised development output into the container's json-file stream.
    # Development opts into the readable format explicitly (docs/logging.md).
    log_format: Literal["console", "json"] = Field(default="json", description="The log format; json unless explicitly set to console")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("log_level_app", "log_level_db", "log_format", mode="before")
    def normalize_logging_case(cls, value: object) -> object:
        # `LOG_FORMAT=JSON` or `LOG_LEVEL_APP=info` must select the intended branch, not fail the
        # boot over casing -- a hand-restored `.env` (OPS-2) is exactly where that typo happens.
        # Anything that is not one of the allowed words still fails loudly via the Literal.
        if isinstance(value, str):
            return value.lower() if value.lower() in ("console", "json") else value.upper()
        return value

    @field_validator("mongodb_uri")
    def validate_mongodb_uri(cls, value: SecretStr) -> SecretStr:
        uri = value.get_secret_value()
        if not (uri.startswith("mongodb://") or uri.startswith("mongodb+srv://")):
            raise ValueError("MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'")
        return value


@lru_cache
def get_config() -> BackendConfig:
    """
    The settings, built once and reused — FastAPI's documented pattern for configuration.

    A FUNCTION rather than a module-level instance, and that is the whole point. Building it at import
    time meant that importing any module which touches configuration read the environment as a side
    effect: the test suite could not import a router without a fully populated `.env`, and it failed
    during COLLECTION, naming eight missing fields instead of anything to do with the test.

    `lru_cache` makes it a singleton without making it a global. Endpoints take it as
    `Depends(get_config)`, so a test can replace it through `app.dependency_overrides` rather than by
    mutating `os.environ` and hoping about import order.
    """
    return BackendConfig()  # type: ignore[call-arg]
