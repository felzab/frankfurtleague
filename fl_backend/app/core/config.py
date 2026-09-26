import re
from functools import lru_cache
from typing import Annotated, Final, Literal, Self

from fastapi import Request
from pydantic import AfterValidator, Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_core import PydanticCustomError
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.shared.folding import league_address, sign_in_identifier

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

# The length `fl_frontend/src/core/config.ts` pins each internal key to (`length(64)`). An equality
# rather than a floor: the pair only works when the two values are identical, so a key one side
# alone would refuse is a deployment already broken.
INTERNAL_API_KEY_LENGTH: Final = 64

# `security.py :: verify_api_key` compares a key with `secrets.compare_digest`, which RAISES for a
# non-ASCII `str`: a key the length alone admits answers every internal request 500 rather than 401.
# Pinned identically in `fl_frontend/src/core/config.ts :: INTERNAL_API_KEY` (`docs/ops/spec.md :: I11`).
INTERNAL_API_KEY_CHARACTERS = re.compile(r"[\x21-\x7e]+")

# The ban list's key is never rotated, every stored hash having been taken under it and no address
# surviving to re-hash (`docs/ops/runbooks.md :: 5`), so the boot is the one place a weak one is
# still cheap to replace.
SPERRLISTE_KEY_MIN_LENGTH: Final = 64


def _only_printable_ascii(key: SecretStr) -> SecretStr:
    """A validator rather than `Field(pattern=)`, which pydantic refuses to apply to a `SecretStr`."""
    if INTERNAL_API_KEY_CHARACTERS.fullmatch(key.get_secret_value()) is None:
        raise ValueError("every character must be printable ASCII, and none may be a space")
    return key


InternalAPIKey = Annotated[
    SecretStr,
    Field(min_length=INTERNAL_API_KEY_LENGTH, max_length=INTERNAL_API_KEY_LENGTH),
    AfterValidator(_only_printable_ascii),
]


class EnvironmentValidationError(Exception):
    """The environment refused, naming the variables it could not accept or a failure type, and nothing else.

    Its own type rather than pydantic's: a `ValidationError` renders `input_value=`, so one reaching
    the container log publishes the value that was rejected.
    """


def _entries(value: str) -> list[str]:
    """One splitter for every list variable, so the validators below and the accessors on the model agree on what an entry is."""
    return [entry.strip() for entry in value.split(",")]


# A model validator judges a PAIR, and pydantic gives its issue an empty `loc`, so the fields it
# read are recovered from the error type it raised rather than from the issue's own location.
POOL_BOUNDS_ERROR: Final = "db_pool_bounds"
MODEL_ERROR_FIELDS: Final = {POOL_BOUNDS_ERROR: ("db_min_connections", "db_max_connections")}


def _failing_names(error: ValidationError) -> str:
    """The failing variables in their environment spelling, and nothing else.

    An issue's own message and its `input_value` each quote what was rejected, so neither is read.
    A model-level issue's `input_value` is the WHOLE settings mapping, so this path never widens.
    """
    # `model_config` sets no alias and no `env_prefix`, so a field's environment spelling is its
    # name upper-cased. `<unknown>` mirrors the frontend gate's answer for a locationless issue.
    names: set[str] = set()
    for issue in error.errors():
        if issue["loc"]:
            names.add(str(issue["loc"][0]).upper())
        elif fields := MODEL_ERROR_FIELDS.get(issue["type"]):
            names.update(field.upper() for field in fields)
        else:
            names.add("<unknown>")
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

    # The frontend's own name for its copy (`fl_frontend/src/core/config.ts :: ADMIN_EMAIL_ALLOWLIST`):
    # an address granted in one process alone is an administrator the other refuses.
    allowed_admin_emails: str = Field(description="The administrators an admin-tier request may name as its actor")

    @property
    def allowed_admin_emails_list(self) -> list[str]:
        # Folded, as the header each is compared with is (`app/core/security.py :: verify_actor_is_admin`).
        return [sign_in_identifier(entry) for entry in _entries(self.allowed_admin_emails)]

    mongodb_uri: SecretStr = Field(description="MongoDB Connection URI")
    # The characters MongoDB accepts in a database name: a value carrying a separator or a space
    # would otherwise open a namespace no other tool on this host can name.
    db_base_name: str = Field(pattern=r"^[A-Za-z0-9_-]+$", description="Base DB name")
    db_server_selection_timeout: int = Field(
        # Wider than the frontend's (`fl_frontend/src/core/db.ts :: options`), which a visitor's first
        # request waits on. Here a request's shorter deadline governs, so only the boot waits this long,
        # and no visitor waits on the boot.
        default=15000,
        # Milliseconds. Zero fails every operation before the driver has looked at anything, and the
        # ceiling keeps a failed ping inside the window `scripts/ops/deploy.sh` waits for health in, so
        # the reason reaches the log excerpt it prints.
        gt=0,
        le=60_000,
        description="MongoDB server-selection timeout in ms",
    )
    db_min_connections: int = Field(default=5, ge=0, description="Min pool size")
    # At least one: pymongo refuses a zero maximum at construction, which is a stack trace during
    # the lifespan rather than a named variable at the gate.
    db_max_connections: int = Field(default=100, ge=1, description="Max pool size")

    internal_api_key_base: InternalAPIKey = Field(description="Base internal API-key")
    internal_api_key_system: InternalAPIKey = Field(description="Internal API-key for the system router")
    internal_api_key_admin: InternalAPIKey = Field(description="Internal API-key for the admin router")

    # The floor is HMAC-SHA256's own digest width in characters: shorter, and the ban list's rows
    # are cheaper to break than the addresses they were taken from
    # (`app/api/sperrliste/services.py :: adresse_hash`). No ceiling — HMAC takes a key of any length.
    sperrliste_schluessel: SecretStr = Field(
        min_length=SPERRLISTE_KEY_MIN_LENGTH, description="HMAC master key for the email ban list and the action log's pseudonyms"
    )

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

    # `forbid`, because a class that drops a key cannot tell a typo from an omission, and the shipped
    # default serves production. Only the dotenv source hands this class an undeclared name, and it
    # drops one carrying no value (`docs/backend/spec.md` §1.5).
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="forbid")

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

    @field_validator("allowed_admin_emails")
    def validate_allowed_admin_emails(cls, value: str) -> str:
        # The API's address rule over the folded entry, the half of the frontend's check
        # `isDeliverableAddress` mirrors. Its other half, the sign-in library's own `z.email()`, decides
        # whether a link can reach the address, and this process sends none.
        for entry in _entries(value):
            # Raises the refusal itself, the length ceiling among its rules, and quotes no address.
            league_address(sign_in_identifier(entry))
        return value

    @model_validator(mode="after")
    def validate_the_pool_bounds_against_each_other(self) -> Self:
        # Each bound alone admits a minimum above the maximum. pymongo refuses that pair while
        # CONSTRUCTING the client, and `db.py :: _refusal_for` reads its `ValueError` as an
        # unopenable URI -- blaming `MONGODB_URI` for these two.
        if self.db_min_connections > self.db_max_connections:
            # `PydanticCustomError` rather than a `ValueError`, whose issue type `value_error` every
            # field validator here shares: the token is what `_failing_names` recovers the pair from.
            raise PydanticCustomError(POOL_BOUNDS_ERROR, "the pool minimum must not exceed the maximum")
        return self


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
    except ValueError as error:
        # Below `ValidationError`'s arm, which is a `ValueError` too: both `SettingsError` and the
        # dotenv read's `UnicodeDecodeError` land here, both CHAIN what they wrapped, and neither
        # names a field -- so the type alone leaves.
        raise EnvironmentValidationError(f"The environment could not be read: {type(error).__name__}") from None


def get_app_config(request: Request) -> BackendConfig:
    """The settings the application was built with, read per request rather than from `get_config`.

    Held on the application (`app/main.py :: create_app`), so one built with other settings answers
    with them and no dependency is replaced to make it do so.
    """
    return request.app.state.config
