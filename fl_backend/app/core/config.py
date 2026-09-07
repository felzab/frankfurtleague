import re
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]

# A property of THIS CODE, never a deployment's: an environment able to set it could serve
# `/api/v2/` from code implementing v0.
API_VERSION = 0

# A bare `*` and a leading `*.` are the only wildcards `TrustedHostMiddleware` reads; every other
# entry it compares literally, so a shape it cannot match takes the whole API to 400.
HOSTNAME = re.compile(r"\*|(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*")

# Scheme, host and optional port, and nothing after them: `CORSMiddleware` compares this against an
# `Origin` header, which carries no path, so a trailing slash matches no browser's request.
ORIGIN = re.compile(r"https?://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?")


class EnvironmentValidationError(Exception):
    """The environment refused, naming the variables and nothing else.

    Its own type rather than pydantic's: a `ValidationError` renders `input_value=`, so one reaching
    the container log publishes the value that was rejected.
    """


def _entries(value: str) -> list[str]:
    """One splitter for both list variables, so the validators below and the accessors on the model agree on what an entry is."""
    return [entry.strip() for entry in value.split(",")]


def _failing_names(error: ValidationError) -> str:
    """The failing variables in their environment spelling, and nothing else.

    An issue's own message and its `input_value` each quote what was rejected, so neither is read.
    """
    # `model_config` sets no alias and no `env_prefix`, so a field's environment spelling is its
    # name upper-cased. `<unknown>` mirrors the frontend gate's answer for a locationless issue.
    names = {str(issue["loc"][0]).upper() if issue["loc"] else "<unknown>" for issue in error.errors()}
    return ", ".join(sorted(names))


class BackendConfig(BaseSettings):
    api_trusted_hosts: str = Field(description="The trusted hosts for this API")
    api_cors_allowed_origins: str = Field(description="The allowed CORS origins for this API")

    @property
    def api_trusted_hosts_list(self) -> list[str]:
        return _entries(self.api_trusted_hosts)

    @property
    def api_cors_allowed_origins_list(self) -> list[str]:
        return _entries(self.api_cors_allowed_origins)

    mongodb_uri: SecretStr = Field(description="MongoDB Connection URI")
    # The characters MongoDB accepts in a database name: a value carrying a separator or a space
    # would otherwise open a namespace no other tool on this host can name.
    db_base_name: str = Field(pattern=r"^[A-Za-z0-9_-]+$", description="Base DB name")
    # Milliseconds. Zero fails every operation before the driver has looked at anything, and the
    # ceiling keeps a failed ping inside the window `scripts/ops/deploy.sh` waits for health in, so
    # the reason reaches the log excerpt it prints.
    db_server_selection_timeout: int = Field(default=15000, gt=0, le=60_000, description="MongoDB server-selection timeout in ms")
    db_min_connections: int = Field(default=5, ge=0, description="Min pool size")
    # At least one: pymongo refuses a zero maximum at construction, which is a stack trace during
    # the lifespan rather than a named variable at the gate.
    db_max_connections: int = Field(default=100, ge=1, description="Max pool size")

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
    # Defaults to the production format: a `.env` omitting the variable must not log ANSI-colourised
    # output into the container's json-file stream.
    log_format: Literal["console", "json"] = Field(default="json", description="The log format; json unless explicitly set to console")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("log_level_app", "log_level_db", "log_format", mode="before")
    def normalize_logging_case(cls, value: object) -> object:
        # `LOG_FORMAT=JSON` or `LOG_LEVEL_APP=info` must select the intended branch rather than fail
        # the boot over casing.
        if isinstance(value, str):
            return value.lower() if value.lower() in ("console", "json") else value.upper()
        return value

    @field_validator("mongodb_uri")
    def validate_mongodb_uri(cls, value: SecretStr) -> SecretStr:
        uri = value.get_secret_value()
        if not (uri.startswith("mongodb://") or uri.startswith("mongodb+srv://")):
            raise ValueError("MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'")
        return value

    @field_validator("api_trusted_hosts")
    def validate_api_trusted_hosts(cls, value: str) -> str:
        # Per entry rather than over the whole string: a trailing comma yields an empty host, which
        # matches no request and reads in the middleware as a list that simply trusts less.
        for entry in _entries(value):
            if HOSTNAME.fullmatch(entry) is None:
                raise ValueError("every entry must be a hostname, a bare '*', or a '*.' wildcard")
        return value

    @field_validator("api_cors_allowed_origins")
    def validate_api_cors_allowed_origins(cls, value: str) -> str:
        for entry in _entries(value):
            if ORIGIN.fullmatch(entry) is None:
                raise ValueError("every entry must be an http:// or https:// origin carrying no path")
        return value


@lru_cache
def get_config() -> BackendConfig:
    """The settings, built once and reused.

    A FUNCTION rather than a module-level instance, which would make importing any module touching
    configuration read the environment as a side effect.
    """
    try:
        return BackendConfig()  # type: ignore[call-arg]
    except ValidationError as error:
        # `from None`, or pydantic's own rendering reaches the traceback uvicorn prints. The
        # sentence is the frontend gate's (`fl_frontend/src/core/config.ts :: frontend_config`), so
        # one hint in `scripts/ops/deploy.sh` covers both.
        raise EnvironmentValidationError(f"Invalid environment variables: {_failing_names(error)}") from None
