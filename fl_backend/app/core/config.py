"""
CORE · backend configuration

Every environment variable the service reads, declared once as a pydantic-settings model, plus the one
thing that deliberately is NOT one. Anything absent from both is a hardcoded constant somewhere, which
is usually a defect.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Secrets are `SecretStr`, so they do not appear in a repr, a traceback or a log line. Reach the value
    only through `.get_secret_value()`, and only where it is actually used.
  • Fields without a default are REQUIRED at boot: the process refuses to start rather than running
    half-configured. The three API keys are among them, and none of them may ever gain a default --
    a default key is a key, and a service that starts with one is a service anyone can call.
  • `API_VERSION` is a CONSTANT, not a setting. See below.
  • Nothing constructs the settings at import time. `get_config()` is what builds them, so importing a
    module that merely *mentions* configuration cannot fail.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/ops/spec.md -- the environment section
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "Critical"]

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
    log_format: Literal["console", "json"] = Field(default="console", description="The default log format")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

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
