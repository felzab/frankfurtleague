import errno
import os
import re
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Final

from fastapi import Request
from pydantic import AfterValidator, BaseModel, Field, SecretStr, ValidationError, field_validator
from pydantic_core import ErrorDetails
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


# Parsed rather than imported by `scripts/checks/check_compose_model.py :: backend_schema_files`, which
# holds the compose files to these fields: a file named by any shape but a string or a module constant
# refuses there.
class _SecretFields(BaseModel):
    """The credentials, each read from its own file under `SECRETS_DIR`."""

    mongodb_uri: SecretStr = Field(validation_alias=MONGODB_URI_FILE, description="MongoDB Connection URI")

    internal_api_key_base: InternalAPIKey = Field(description="Base internal API-key")
    internal_api_key_system: InternalAPIKey = Field(description="Internal API-key for the system router")
    internal_api_key_admin: InternalAPIKey = Field(description="Internal API-key for the admin router")

    # The floor is HMAC-SHA256's own digest width in characters: shorter, and the ban list's rows
    # are cheaper to break than the addresses they were taken from
    # (`app/api/sperrliste/services.py :: adresse_hash`). No ceiling — HMAC takes a key of any length.
    sperrliste_key: SecretStr = Field(
        min_length=SPERRLISTE_KEY_MIN_LENGTH, description="HMAC master key every keyed hash of an address derives its own sub-key from"
    )

    @field_validator("mongodb_uri")
    def validate_mongodb_uri(cls, value: SecretStr) -> SecretStr:
        uri = value.get_secret_value()
        if not (uri.startswith("mongodb://") or uri.startswith("mongodb+srv://")):
            raise ValueError("MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'")
        return value


# The file each secret field is read from: its alias where one is set, its own name otherwise.
SECRET_FILES: Final = tuple(str(field.validation_alias or name) for name, field in _SecretFields.model_fields.items())


class BackendConfig(BaseSettings, _SecretFields):
    """The settings: each credential from its own file, every other value from the environment or the package's dotenv file.

    Built without `_secrets_dir`, it opens no secret file: `get_config` hands it the directory `SECRETS_DIR` names.
    """

    # The characters MongoDB accepts in a database name: a value carrying a separator or a space
    # would otherwise open a namespace no other tool on this host can name.
    db_base_name: str = Field(pattern=r"^[A-Za-z0-9_-]+$", description="Base DB name")

    # The image's version from its build argument (`fl_backend/Dockerfile`), which the start-up line logs; unset in a run
    # outside an image, and empty, so read as unset, in a build handed none.
    app_version: str | None = Field(default=None, min_length=1, description="The image's version")

    model_config = SettingsConfigDict(
        # The package's file, the one `docker-compose.yml` lists, so a run from `fl_backend/` reads what
        # compose hands the container. A container has no file: compose hands it the names as variables.
        env_file=".env",
        env_file_encoding="utf-8",
        # `forbid`, because a class that drops a key cannot tell a typo from an omission, and the shipped
        # default serves production. Only the dotenv source hands this class an undeclared name, and it
        # drops one carrying no value.
        extra="forbid",
        # An empty variable reads as unset: an image built without an argument carries its `ENV` as the
        # empty string, which Docker cannot leave unset. A secret file is judged as written either way.
        env_ignore_empty=True,
    )

    # Declared, or a type checker reads the fields as the constructor's arguments and demands the
    # required ones, which the sources supply; `_secrets_dir` and `_env_file` are the library's own.
    def __init__(self, **values: Any) -> None:
        super().__init__(**values)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # The secret files above the environment, "the order of the returned callables decides the
        # priority of inputs" (https://pydantic.dev/docs/validation/latest/concepts/pydantic_settings/):
        # the default ranks a variable above its file, so one left behind would win in silence.
        return init_settings, file_secret_settings, env_settings, dotenv_settings


def _refusal(issues: list[ErrorDetails], *, files: set[str], files_read: bool) -> EnvironmentValidationError:
    """Each failing variable upper-cased as the environment spells it, a count of the undeclared, and each failing file by name.

    A failing credential is its file where the build read the files, and otherwise the variable or
    dotenv line that stood in for it. An issue's own message and its `input_value` each quote what
    was rejected, so neither is read. An undeclared name is the file's own text, which a pasted key's
    line keeping the dotenv shape would be, so it is counted and nothing names it. The first sentence
    is the frontend gate's (`fl_frontend/src/core/config.ts :: frontend_config`), so one hint in
    `scripts/ops/deploy.sh` covers both.
    """
    # `<unknown>` mirrors the frontend gate's answer for a locationless issue.
    failing = {str(issue["loc"][0]) if issue["loc"] else "<unknown>" for issue in issues if issue["type"] != UNDECLARED}
    read_from_files = failing & set(SECRET_FILES) if files_read else set()
    variables = sorted(failing - read_from_files)
    files = files | read_from_files
    undeclared = sum(issue["type"] == UNDECLARED for issue in issues)

    sentences = [f"Invalid environment variables: {', '.join(name.upper() for name in variables)}"] if variables else []
    if undeclared:
        sentences.append(f"Undeclared environment variables: {undeclared}")
    if files:
        sentences.append(f"Invalid secret files: {', '.join(sorted(files))}")
    return EnvironmentValidationError("; ".join(sentences))


def read_environment() -> None:
    """The deploy's preflight: the variables and the dotenv file, refused as the boot refuses them, opening no secret file.

    Its caller's uid reads none, so the class is built with no secrets directory, and the credentials
    that leaves missing are no question of this one.
    """
    try:
        BackendConfig()
    except ValidationError as error:
        issues = [issue for issue in error.errors() if not (issue["type"] == "missing" and issue["loc"] and issue["loc"][0] in SECRET_FILES)]
    except ValueError as error:
        # Below `ValidationError`'s arm, which is a `ValueError` too: both `SettingsError` and the
        # dotenv read's `UnicodeDecodeError` land here, both CHAIN what they wrapped, and neither
        # names a field -- so the type alone leaves.
        raise EnvironmentValidationError(f"The environment could not be read: {type(error).__name__}") from None
    else:
        return
    # Outside the arm and `from None`, so nothing chains the `ValidationError`, whose own rendering
    # quotes each rejected value into the traceback uvicorn prints.
    if issues:
        raise _refusal(issues, files=set(), files_read=False) from None


def _unusable_files(directory: Path) -> tuple[list[str], list[str]]:
    """Each unreadable file as `<path> (<errno>)`, and each required one missing or any one blank, by name.

    Asked before the build, which stops at its first failing read and takes a variable where a file is
    missing; never a decode error's text, which quotes the file.
    """
    if not directory.is_dir():
        return [f"{directory} ({'ENOTDIR' if directory.exists() else 'ENOENT'})"], []
    unreadable: list[str] = []
    absent: list[str] = []
    # The fields of the class the build constructs, which a default it declares spares a file.
    for name, field in zip(SECRET_FILES, [BackendConfig.model_fields[field] for field in _SecretFields.model_fields], strict=True):
        path = SecretsSettingsSource.find_case_path(directory, name, case_sensitive=False)
        if path is None:
            # Counted here as well as by the build, which a variable, or a file under the field's own
            # name, may stand in for.
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


@lru_cache
def get_config() -> BackendConfig:
    """The settings, built once and reused, the credentials read from the directory `SECRETS_DIR` names.

    A FUNCTION rather than a module-level instance, which would make importing any module touching
    configuration read the environment as a side effect.
    """
    # Read before the build, which takes the directory as an argument: the settings loader is the one
    # reader of the environment the ban permits.
    directory = Path(os.environ.get("SECRETS_DIR", DEFAULT_SECRETS_DIR))  # noqa: TID251
    unreadable, absent = _unusable_files(directory)
    if unreadable:
        # The missing and the blank beside them, which the build would never reach.
        also = f"; Invalid secret files: {', '.join(sorted(absent))}" if absent else ""
        raise EnvironmentValidationError(f"Unreadable secret files: {', '.join(unreadable)}{also}") from None
    # Built even where a file is missing, so every present value is judged as well; a missing one is
    # refused whatever the library found to stand in for it.
    try:
        # Raised rather than printed: the source only WARNS for a directory at a file's path, and a
        # warning leaves outside the log envelope.
        with warnings.catch_warnings(action="error"):
            config = BackendConfig(_secrets_dir=directory)
    except ValidationError as error:
        refused = _refusal(error.errors(), files=set(absent), files_read=True)
    except Warning, SettingsError:
        # A file that became unreadable after the question above was asked: asked again.
        unreadable, _ = _unusable_files(directory)
        raise EnvironmentValidationError(f"Unreadable secret files: {', '.join(unreadable) or directory}") from None
    except ValueError as error:
        # For `read_environment`'s reason.
        raise EnvironmentValidationError(f"The environment could not be read: {type(error).__name__}") from None
    else:
        if not absent:
            return config
        refused = EnvironmentValidationError(f"Invalid secret files: {', '.join(sorted(absent))}")
    raise refused from None


def get_app_config(request: Request) -> BackendConfig:
    """The settings the application was built with, read per request rather than from `get_config`.

    Held on the application (`app/main.py :: create_app`), so one built with other settings answers
    with them and no dependency is replaced to make it do so.
    """
    return request.app.state.config
