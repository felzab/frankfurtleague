import errno
import re
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Final

from fastapi import Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SecretsSettingsSource, SettingsConfigDict, SettingsError

# A property of THIS CODE, never a deployment's: an environment able to set it could serve
# `/api/v2/` from code implementing v0.
API_VERSION = 0

# The length `fl_frontend/src/core/config.ts` pins each internal key to (`length(64)`). An equality
# rather than a floor: the pair only works when the two values are identical, so a key one side
# alone would refuse is a deployment already broken.
INTERNAL_API_KEY_LENGTH: Final = 64

# RFC 9110's `VCHAR`, which a header carries as written: `security.py :: verify_api_key`'s
# `secrets.compare_digest` RAISES on a non-ASCII `str`. Pinned
# identically in `fl_frontend/src/core/config.ts :: INTERNAL_API_KEY`.
INTERNAL_API_KEY_CHARACTERS = re.compile(r"[\x21-\x7e]+")

# The ban list's key is never rotated, every stored hash having been taken under it and no address
# surviving to re-hash (`docs/ops/runbooks.md :: 5`), so the boot is the one place a weak one is
# still cheap to replace.
SPERRLISTE_KEY_MIN_LENGTH: Final = 64

# Where Compose mounts a file secret, which is where a container finds it with nothing set.
DEFAULT_SECRETS_DIR: Final = "/run/secrets"

# Prefixed because the frontend holds a different login under `frontend_mongodb_uri`, and one file
# name is spelled the same on the host, in the container and in development.
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


# The issue pydantic raises for a name the dotenv file holds and the class does not declare.
UNDECLARED: Final = "extra_forbidden"


def _failing_names(error: ValidationError) -> list[str]:
    """The declared fields that failed, spelled as their source spells them.

    An issue's own message and its `input_value` each quote what was rejected, so neither is read.
    An undeclared name is the file's own text, which a pasted key's line keeping the dotenv shape
    would be, so `_undeclared` counts it and nothing names it.
    """
    # `<unknown>` mirrors the frontend gate's answer for a locationless issue.
    return sorted({str(issue["loc"][0]) if issue["loc"] else "<unknown>" for issue in error.errors() if issue["type"] != UNDECLARED})


def _undeclared(error: ValidationError) -> int:
    return sum(issue["type"] == UNDECLARED for issue in error.errors())


class _EnvironmentFields(BaseModel):
    """What the environment configures, read by both the boot's environment half and `BackendConfig`."""

    # The characters MongoDB accepts in a database name: a value carrying a separator or a space
    # would otherwise open a namespace no other tool on this host can name.
    db_base_name: str = Field(pattern=r"^[A-Za-z0-9_-]+$", description="Base DB name")

    # The image's version from its build argument (`fl_backend/Dockerfile`), which the start-up line logs; absent from a
    # build handed none and from a run outside an image.
    app_version: str | None = Field(default=None, min_length=1, description="The image's version")


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
        min_length=SPERRLISTE_KEY_MIN_LENGTH, description="HMAC master key every keyed hash of an address derives its own sub-key from"
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
        # drops one carrying no value.
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
    variable left behind would win over its file in silence.
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
        failing, undeclared = _failing_names(error), _undeclared(error)
    except ValueError as error:
        # Below `ValidationError`'s arm, which is a `ValueError` too: both `SettingsError` and the
        # dotenv read's `UnicodeDecodeError` land here, both CHAIN what they wrapped, and neither
        # names a field -- so the type alone leaves.
        raise EnvironmentValidationError(f"The environment could not be read: {type(error).__name__}") from None
    # Outside the arm and `from None`, so nothing chains the `ValidationError`, whose own rendering
    # quotes each rejected value into the traceback uvicorn prints.
    raise _environment_refusal(failing, undeclared) from None


def _environment_refusal(failing: list[str], undeclared: int) -> EnvironmentValidationError:
    """Each declared name that failed, upper-cased as the environment spells it, and a count of the undeclared ones.

    The first sentence is the frontend gate's (`fl_frontend/src/core/config.ts :: frontend_config`),
    so one hint in `scripts/ops/deploy.sh` covers both.
    """
    sentences = [f"Invalid environment variables: {', '.join(name.upper() for name in failing)}"] if failing else []
    if undeclared:
        sentences.append(f"Undeclared environment variables: {undeclared}")
    return EnvironmentValidationError("; ".join(sentences))


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
