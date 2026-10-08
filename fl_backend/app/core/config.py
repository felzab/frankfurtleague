import errno
import re
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Final, Literal, Self

from fastapi import Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_core import PydanticCustomError
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SecretsSettingsSource, SettingsConfigDict, SettingsError  # noqa: TID251

from app.core.actor_token import ActorTokenKey

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

# RFC 9110's `VCHAR`, which a header carries as written: `security.py :: verify_api_key`'s
# `secrets.compare_digest` RAISES on a non-ASCII `str` (`docs/ops/spec.md :: I11`). Pinned
# identically in `fl_frontend/src/core/config.ts :: INTERNAL_API_KEY`.
INTERNAL_API_KEY_CHARACTERS = re.compile(r"[\x21-\x7e]+")

# The ban list's key is never rotated, every stored hash having been taken under it and no address
# surviving to re-hash (`docs/ops/runbooks.md :: 5`), so the boot is the one place a weak one is
# still cheap to replace.
SPERRLISTE_KEY_MIN_LENGTH: Final = 64

# Where Compose mounts a file secret, which is where a container finds it with nothing set.
DEFAULT_SECRETS_DIR: Final = "/run/secrets"

# Prefixed because the frontend holds a different login under `frontend_mongodb_uri`, and one file
# name is spelled the same on the host, in the container and in development (`docs/backend/spec.md` §1.5).
MONGODB_URI_FILE: Final = "backend_mongodb_uri"


def _only_key_characters(key: SecretStr) -> SecretStr:
    """A validator rather than `Field(pattern=)`, which pydantic refuses to apply to a `SecretStr`."""
    if INTERNAL_API_KEY_CHARACTERS.fullmatch(key.get_secret_value()) is None:
        raise ValueError("printable ASCII only, with no space")
    return key


InternalAPIKey = Annotated[
    SecretStr,
    Field(min_length=INTERNAL_API_KEY_LENGTH, max_length=INTERNAL_API_KEY_LENGTH),
    AfterValidator(_only_key_characters),
]


class EnvironmentValidationError(Exception):
    """The settings refused, naming variables, secret files or a failure type, and nothing else.

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


def _failing_names(error: ValidationError) -> list[str]:
    """The failing fields, spelled as their source spells them.

    An issue's own message and its `input_value` each quote what was rejected, so neither is read.
    A model-level issue's `input_value` is the WHOLE settings mapping, so this path never widens.
    """
    # `<unknown>` mirrors the frontend gate's answer for a locationless issue.
    names: set[str] = set()
    for issue in error.errors():
        if issue["loc"]:
            names.add(str(issue["loc"][0]))
        elif fields := MODEL_ERROR_FIELDS.get(issue["type"]):
            names.update(fields)
        else:
            names.add("<unknown>")
    return sorted(names)


class _EnvironmentFields(BaseModel):
    """What the environment configures, read by both the boot's environment half and `BackendConfig`."""

    api_trusted_hosts: str = Field(description="The trusted hosts for this API")
    api_cors_allowed_origins: str = Field(description="The allowed CORS origins for this API")

    @property
    def api_trusted_hosts_list(self) -> list[str]:
        return _entries(self.api_trusted_hosts)

    @property
    def api_cors_allowed_origins_list(self) -> list[str]:
        return _entries(self.api_cors_allowed_origins)

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

    # A plain `str`: the public half of the frontend's signing pair, which verifies and signs nothing.
    actor_token_public_key: str = Field(description="The Ed25519 public key an actor token is verified with, as RFC 8037's `x`")

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

    @field_validator("log_level_app", "log_level_db", "log_format", mode="before")
    def normalize_logging_case(cls, value: object) -> object:
        # `LOG_FORMAT=JSON` or `LOG_LEVEL_APP=info` must select the intended branch rather than fail
        # the boot over casing.
        if isinstance(value, str):
            return value.lower() if value.lower() in ("console", "json") else value.upper()
        return value

    @field_validator("actor_token_public_key")
    def validate_actor_token_public_key(cls, value: str) -> str:
        # The key built here is discarded: building it is the check, so a key that cannot verify
        # refuses the boot by name rather than every admin request at 401.
        ActorTokenKey.from_public_key(value)
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

    @model_validator(mode="after")
    def validate_the_pool_bounds_against_each_other(self) -> Self:
        # Each bound alone admits a minimum above the maximum. pymongo refuses that pair while
        # CONSTRUCTING the client, and `db.py :: _refusal_for` reads its `ValueError` as an
        # unopenable URI -- blaming the URI's file for these two.
        if self.db_min_connections > self.db_max_connections:
            # `PydanticCustomError` rather than a `ValueError`, whose issue type `value_error` every
            # field validator here shares: the token is what `_failing_names` recovers the pair from.
            raise PydanticCustomError(POOL_BOUNDS_ERROR, "the pool minimum must not exceed the maximum")
        return self


# Parsed rather than imported by `scripts/checks/check_compose_model.py :: backend_schema_files`, which
# holds the compose files to these fields: a file named by any shape but a string or a module constant
# refuses there.
class _SecretFields(BaseModel):
    """The credentials, read by `BackendSecrets` from one file each and by `BackendConfig` from it."""

    mongodb_uri: SecretStr = Field(validation_alias=MONGODB_URI_FILE, description="MongoDB Connection URI")

    internal_api_key_base: InternalAPIKey = Field(description="Base internal API-key")
    internal_api_key_system: InternalAPIKey = Field(description="Internal API-key for the system router")
    internal_api_key_admin: InternalAPIKey = Field(description="Internal API-key for the admin router")

    # The floor is HMAC-SHA256's own digest width in characters: shorter, and the ban list's rows
    # are cheaper to break than the addresses they were taken from
    # (`app/api/sperrliste/services.py :: adresse_hash`). No ceiling — HMAC takes a key of any length.
    sperrliste_schluessel: SecretStr = Field(
        min_length=SPERRLISTE_KEY_MIN_LENGTH, description="HMAC master key for the email ban list and the action log's pseudonyms"
    )

    @field_validator("mongodb_uri")
    def validate_mongodb_uri(cls, value: SecretStr) -> SecretStr:
        uri = value.get_secret_value()
        if not (uri.startswith("mongodb://") or uri.startswith("mongodb+srv://")):
            raise ValueError("MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'")
        return value


class BackendEnvironment(BaseSettings, _EnvironmentFields):
    """The environment half of the boot's settings: the process environment and the package's dotenv file, never a secret file."""

    # A path and never a secret: the directory the secret half reads each credential from.
    secrets_dir: str = Field(default=DEFAULT_SECRETS_DIR, description="The directory each secret file is read from")

    model_config = SettingsConfigDict(
        # The package's file, the one `docker-compose.yml` lists, so a run from `fl_backend/` reads what
        # compose hands the container. A container has no file: compose hands it the names as variables.
        env_file=".env",
        env_file_encoding="utf-8",
        # `forbid`, because a class that drops a key cannot tell a typo from an omission, and the shipped
        # default serves production. Only the dotenv source hands this class an undeclared name, and it
        # drops one carrying no value (`docs/backend/spec.md` §1.5).
        extra="forbid",
    )

    # Declared, or a type checker reads the fields as the constructor's arguments and demands the
    # required ones, which only the sources below supply.
    def __init__(self) -> None:
        super().__init__()

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return init_settings, env_settings, dotenv_settings


class BackendSecrets(BaseSettings, _SecretFields):
    """The secret half: one file per credential, and no other source at all.

    pydantic-settings ranks the environment and a dotenv file ABOVE a secrets directory, so a
    variable left behind would win over its file in silence (`docs/backend/spec.md` §1.5).
    """

    # No `env_prefix`: pydantic-settings puts it on a secret file's name too, and `SECRET_FILES`, the
    # preflight and the compose check name each file without one
    # (`fl_backend/tests/core/test_config.py :: TestTheSecretFiles`).
    model_config = SettingsConfigDict(extra="forbid")

    # The directory is the one argument, for `BackendEnvironment.__init__`'s reason; pydantic-settings
    # takes it as `_secrets_dir` (https://pydantic.dev/docs/validation/latest/concepts/pydantic_settings/).
    def __init__(self, directory: Path) -> None:
        super().__init__(_secrets_dir=directory)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (file_secret_settings,)


# The file each secret field is read from: its alias where one is set, its own name otherwise.
SECRET_FILES: Final = tuple(str(field.validation_alias or name) for name, field in BackendSecrets.model_fields.items())


class BackendConfig(_EnvironmentFields, _SecretFields):
    """The settings every consumer reads: both halves, as `get_config` built them, reading no source of its own."""

    # By name, because the secret fields carry their file's name as the alias the file source reads.
    model_config = ConfigDict(extra="forbid", validate_by_name=True)


def read_environment() -> BackendEnvironment:
    """The environment half, refused by the names it could not accept; the deploy's preflight reads this alone."""
    try:
        return BackendEnvironment()
    except ValidationError as error:
        # `from None`, or pydantic's own rendering reaches the traceback uvicorn prints. The
        # sentence is the frontend gate's (`fl_frontend/src/core/config.ts :: frontend_config`), so
        # one hint in `scripts/ops/deploy.sh` covers both. The environment spells a name upper-cased.
        names = ", ".join(name.upper() for name in _failing_names(error))
        raise EnvironmentValidationError(f"Invalid environment variables: {names}") from None
    except ValueError as error:
        # Below `ValidationError`'s arm, which is a `ValueError` too: both `SettingsError` and the
        # dotenv read's `UnicodeDecodeError` land here, both CHAIN what they wrapped, and neither
        # names a field -- so the type alone leaves.
        raise EnvironmentValidationError(f"The environment could not be read: {type(error).__name__}") from None


def _unusable_files(directory: Path) -> tuple[list[str], list[str]]:
    """Each unreadable file as `<path> (<errno>)`, and each required one missing or any one blank, by name.

    Asked before the build, which stops at its first failing read; never a decode error's text,
    which quotes the file.
    """
    if not directory.is_dir():
        return [f"{directory} ({'ENOTDIR' if directory.exists() else 'ENOENT'})"], []
    unreadable: list[str] = []
    absent: list[str] = []
    # The library's own setting rather than its default: a file it would not find must be missing here too.
    case_sensitive = bool(BackendSecrets.model_config.get("case_sensitive"))
    for name, field in zip(SECRET_FILES, BackendSecrets.model_fields.values(), strict=True):
        path = SecretsSettingsSource.find_case_path(directory, name, case_sensitive=case_sensitive)
        if path is None:
            # Counted here as well as by the build, whose lookup may find a stand-in for a missing file
            # (`fl_backend/tests/core/test_config.py :: TestTheSecretFiles`).
            if field.is_required():
                absent.append(name)
            continue
        # What Docker leaves where a bind mount's source file was missing; Windows would read it as EACCES.
        if path.is_dir():
            unreadable.append(f"{path} (EISDIR)")
            continue
        try:
            if path.read_text(encoding="utf-8").strip() == "":
                absent.append(name)
        except OSError as failure:
            unreadable.append(f"{path} ({errno.errorcode.get(failure.errno or 0, type(failure).__name__)})")
        except ValueError as failure:
            unreadable.append(f"{path} ({type(failure).__name__})")
    return unreadable, absent


def read_secrets(directory: Path) -> BackendSecrets:
    """The secret half, read from `directory` alone and refused by file name, never by value."""
    unreadable, absent = _unusable_files(directory)
    if unreadable:
        # The missing and the blank beside them, which the build would never reach.
        also = f"; Invalid secret files: {', '.join(sorted(absent))}" if absent else ""
        raise EnvironmentValidationError(f"Unreadable secret files: {', '.join(unreadable)}{also}") from None
    # Built even where a file is missing, so every present file's value is judged as well; a missing
    # one is refused whatever the library found to stand in for it.
    try:
        # Raised rather than printed: the source only WARNS for a missing directory and for a
        # directory at a file's path, and a warning leaves outside the log envelope.
        with warnings.catch_warnings(action="error"):
            secrets = BackendSecrets(directory)
    except ValidationError as error:
        invalid = {*absent, *_failing_names(error)}
    except Warning, SettingsError:
        # A file that became unreadable after the question above was asked: asked again.
        unreadable, _ = _unusable_files(directory)
        raise EnvironmentValidationError(f"Unreadable secret files: {', '.join(unreadable) or directory}") from None
    else:
        if not absent:
            return secrets
        invalid = set(absent)
    raise EnvironmentValidationError(f"Invalid secret files: {', '.join(sorted(invalid))}") from None


@lru_cache
def get_config() -> BackendConfig:
    """The settings, built once and reused: the environment half first, then the files its `SECRETS_DIR` names.

    A FUNCTION rather than a module-level instance, which would make importing any module touching
    configuration read the environment as a side effect.
    """
    environment = read_environment()
    secrets = read_secrets(Path(environment.secrets_dir))

    return BackendConfig(
        **environment.model_dump(include=set(_EnvironmentFields.model_fields)),
        **secrets.model_dump(),
    )


def get_app_config(request: Request) -> BackendConfig:
    """The settings the application was built with, read per request rather than from `get_config`.

    Held on the application (`app/main.py :: create_app`), so one built with other settings answers
    with them and no dependency is replaced to make it do so.
    """
    return request.app.state.config
