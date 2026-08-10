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

# A property of THIS CODE, not a deployment's: an environment able to set it could serve `/api/v2/`
# from code implementing v0, so bumping it is a code change (docs/ops/spec.md). The frontend's own
# env var is legitimate -- a client chooses a version.
API_VERSION = 0


class BackendConfig(BaseSettings):
    api_trusted_hosts: str = Field(description="The trusted hosts for this API")
    api_cors_allowed_origins: str = Field(description="The allowed CORS origins for this API")

    @property
    def api_trusted_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.api_trusted_hosts.split(",")]

    @property
    def api_cors_allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.api_cors_allowed_origins.split(",")]

    mongodb_uri: SecretStr = Field(description="MongoDB Connection URI")
    db_base_name: str = Field(description="Base DB name")
    db_server_selection_timeout: int = Field(default=15000, description="MongoDB server-selection timeout in ms")
    db_min_connections: int = Field(default=5, description="Min pool size")
    db_max_connections: int = Field(default=100, description="Max pool size")

    internal_api_key_base: SecretStr = Field(description="Base internal API-key")
    internal_api_key_system: SecretStr = Field(description="Internal API-key for the system router")
    internal_api_key_admin: SecretStr = Field(description="Internal API-key for the admin router")

    log_level_app: LogLevel = Field(
        default="INFO",
        description="The minimal level a log has to reach to be processed",
    )
    log_level_db: LogLevel = Field(
        default="WARNING",
        description="The minimal level a database related log has to reach to be processed",
    )
    # Defaults to the production format on purpose: a production `.env` omitting the variable must not
    # log ANSI-colourised output into the container's json-file stream. Development opts in explicitly
    # (docs/logging/spec.md).
    log_format: Literal["console", "json"] = Field(default="json", description="The log format; json unless explicitly set to console")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("log_level_app", "log_level_db", "log_format", mode="before")
    def normalize_logging_case(cls, value: object) -> object:
        # `LOG_FORMAT=JSON` or `LOG_LEVEL_APP=info` must select the intended branch rather than fail
        # the boot over casing -- a hand-restored `.env` is where that typo happens. Anything else
        # still fails loudly via the Literal.
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

    A FUNCTION rather than a module-level instance, and that is the whole point: a module-level one
    would make importing any module that touches configuration read the environment as a side effect
    (`app/asgi.py`, which holds the one deliberate instance of that).

    `lru_cache` makes it a singleton without making it a global. Endpoints take it as
    `Depends(get_config)`, so a test can replace it through `app.dependency_overrides` rather than by
    mutating `os.environ` and hoping about import order.
    """
    return BackendConfig()  # type: ignore[call-arg]
